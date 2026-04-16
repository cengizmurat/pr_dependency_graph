import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import { useQueryClient } from "@tanstack/react-query";
import type { GraphData, PRNode, Orientation, EdgeFlags } from "../types";
import { mergeAndCascade, updatePRBranch } from "../github";
import { collectDescendantPRs, isPR } from "../utils";
import { PR_WIDTH, PR_HEIGHT, SPACING, COLORS } from "../constants";
import {
  buildTrees,
  layoutTree,
  flattenTree,
  flattenEdges,
  nodeWidth,
  nodeHeight,
  edgePath,
  strokeColor,
  bgColor,
} from "../graphLayout";
import PRCard from "./PRCard";
import BranchCard from "./BranchCard";
import Legend from "./Legend";

export type { Orientation };

interface Props {
  data: GraphData;
  orientation: Orientation;
  token: string;
}

export default function GraphView({ data, orientation, token }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const queryClient = useQueryClient();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [merging, setMerging] = useState<number | null>(null);
  const [updatingPRs, setUpdatingPRs] = useState<Set<number>>(new Set());
  const [currentlyUpdating, setCurrentlyUpdating] = useState<number | null>(null);

  const handleMerge = useCallback(
    async (prNumber: number, prTitle: string) => {
      const prNode = data.nodes.find(
        (n): n is PRNode => n.type === "pr" && n.number === prNumber,
      );
      const dependents = prNode
        ? data.nodes.filter(
            (n): n is PRNode =>
              n.type === "pr" && n.baseBranch === prNode.headBranch,
          )
        : [];

      let msg = `Merge PR #${prNumber} "${prTitle}"?`;
      if (dependents.length > 0) {
        const list = dependents
          .map((d) => `  #${d.number} ${d.title}`)
          .join("\n");
        msg += `\n\nThe following dependent PRs will be retargeted to "${prNode!.baseBranch}" and updated:\n${list}`;
      }

      if (!window.confirm(msg)) return;

      setMerging(prNumber);
      try {
        const result = await mergeAndCascade(
          token,
          data.owner,
          data.repo,
          prNumber,
          data.nodes,
        );
        if (result.errors.length > 0) {
          const errList = result.errors
            .map((e) => `  #${e.number}: ${e.message}`)
            .join("\n");
          alert(`Merged PR #${prNumber}, but some updates failed:\n${errList}`);
        }
        window.location.reload();
      } catch (err) {
        alert(`Merge failed: ${(err as Error).message}`);
        setMerging(null);
      }
    },
    [token, data],
  );

  const handleUpdateBranch = useCallback(
    async (prNumber: number) => {
      const allToUpdate = collectDescendantPRs(prNumber, data.nodes);

      let msg = `Update PR #${prNumber} with latest changes from base branch?`;
      if (allToUpdate.length > 1) {
        const descendantNums = allToUpdate.slice(1).map((n) => `#${n}`).join(", ");
        msg += `\n\nThe following descending PRs will also be updated: ${descendantNums}`;
      }
      if (!window.confirm(msg)) return;

      setUpdatingPRs(new Set(allToUpdate));

      const errors: { number: number; message: string }[] = [];
      for (const num of allToUpdate) {
        setCurrentlyUpdating(num);
        const pr = data.nodes.find((n): n is PRNode => n.type === "pr" && n.number === num);
        try {
          await updatePRBranch(token, data.owner, data.repo, num);
          if (pr) {
            queryClient.removeQueries({ queryKey: ["compare", data.owner, data.repo, pr.baseBranch, pr.headBranch] });
          }
        } catch (err) {
          errors.push({ number: num, message: (err as Error).message });
        }
      }
      setCurrentlyUpdating(null);

      queryClient.removeQueries({ queryKey: ["behindBy", data.owner, data.repo] });

      if (errors.length > 0) {
        const errList = errors.map((e) => `  #${e.number}: ${e.message}`).join("\n");
        alert(`Some branch updates failed:\n${errList}`);
      }

      window.location.reload();
    },
    [token, data, queryClient],
  );

  const { allNodes, allEdges, nodeFlags, totalWidth, totalHeight } =
    useMemo(() => {
      const { roots: trees, edgeFlagsMap } = buildTrees(data);
      const gap = SPACING[orientation].sibling;
      let nextSecondary = gap;
      for (const tree of trees) {
        nextSecondary = layoutTree(tree, nextSecondary, orientation) + gap;
      }
      const nodes = trees.flatMap(flattenTree);
      const edges = trees.flatMap((t) => flattenEdges(t, edgeFlagsMap));

      const nf = new Map<string, EdgeFlags>();
      for (const e of edges) {
        if (e.hasConflict || e.isMergeable) {
          nf.set(e.target.data.id, {
            hasConflict: e.hasConflict,
            isMergeable: e.isMergeable,
            reviewStatus: e.reviewStatus,
          });
        }
      }

      if (orientation === "horizontal") {
        const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
        return {
          allNodes: nodes,
          allEdges: edges,
          nodeFlags: nf,
          totalWidth: maxX + PR_WIDTH + 80,
          totalHeight: nextSecondary,
        };
      }
      const maxY = nodes.reduce((m, n) => Math.max(m, n.y), 0);
      return {
        allNodes: nodes,
        allEdges: edges,
        nodeFlags: nf,
        totalWidth: nextSecondary,
        totalHeight: maxY + PR_HEIGHT + 80,
      };
    }, [data, orientation]);

  const fitView = useCallback(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g) return;

    const width = svg.clientWidth;
    const height = svg.clientHeight;
    const padding = 40;
    const scaleX = (width - padding * 2) / totalWidth;
    const scaleY = (height - padding * 2) / totalHeight;
    const scale = Math.min(scaleX, scaleY);
    const tx = (width - totalWidth * scale) / 2;
    const ty = (height - totalHeight * scale) / 2;

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 3])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        d3.select(g).attr("transform", event.transform.toString());
      });

    const sel = d3.select(svg);
    sel.call(zoom);
    sel.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }, [totalWidth, totalHeight]);

  useEffect(() => {
    fitView();
  }, [fitView]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--color-page-bg)",
      }}
    >
      <Legend />
      <svg ref={svgRef} width="100%" height="100%">
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 -5 10 10"
            refX={10}
            refY={0}
            markerWidth={8}
            markerHeight={8}
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill={COLORS.edge} />
          </marker>
          <marker
            id="arrowhead-approved"
            viewBox="0 -5 10 10"
            refX={10}
            refY={0}
            markerWidth={8}
            markerHeight={8}
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill={COLORS.ready} />
          </marker>
          <marker
            id="arrowhead-changes-requested"
            viewBox="0 -5 10 10"
            refX={10}
            refY={0}
            markerWidth={8}
            markerHeight={8}
            orient="auto"
          >
            <path d="M0,-5L10,0L0,5" fill={COLORS.conflict} />
          </marker>
        </defs>

        <g ref={gRef}>
          {allEdges.map((e, i) => {
            let edgeColor = COLORS.edge;
            let marker = "url(#arrowhead)";
            if (e.reviewStatus === "changes_requested") {
              edgeColor = COLORS.conflict;
              marker = "url(#arrowhead-changes-requested)";
            } else if (e.reviewStatus === "approved") {
              edgeColor = COLORS.ready;
              marker = "url(#arrowhead-approved)";
            }
            return (
              <path
                key={i}
                d={edgePath(e, orientation)}
                fill="none"
                stroke={edgeColor}
                strokeWidth={2}
                markerEnd={marker}
              />
            );
          })}

          {allNodes.map((n) => {
            const w = nodeWidth(n.data);
            const h = nodeHeight(n.data);
            const isHovered = hoveredId === n.data.id;
            const stroke = isHovered ? COLORS.hover : strokeColor(n.data);
            const needsAttention =
              isPR(n.data) &&
              !!data.viewerLogin &&
              n.data.reviewers.some(
                (r) => r.login === data.viewerLogin && r.state === "REQUESTED",
              );

            return (
              <g
                key={n.data.id}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredId(n.data.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => window.open(n.data.url, "_blank", "noopener")}
              >
                <title>Open PR</title>
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={8}
                  ry={8}
                  fill={bgColor(n.data)}
                  stroke={stroke}
                  strokeWidth={needsAttention ? 5 : 1.5}
                />
                <foreignObject
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  style={{ overflow: "visible" }}
                >
                  {isPR(n.data) ? (
                    <PRCard
                      pr={n.data}
                      mergeStatus={nodeFlags.get(n.data.id)}
                      isMerging={merging === n.data.number}
                      isUpdating={updatingPRs.has(n.data.number)}
                      isCurrentlyUpdating={currentlyUpdating === n.data.number}
                      onMerge={handleMerge}
                      onUpdateBranch={handleUpdateBranch}
                      orientation={orientation}
                    />
                  ) : (
                    <BranchCard branch={n.data} />
                  )}
                </foreignObject>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
