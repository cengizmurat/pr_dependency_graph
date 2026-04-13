import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphData, GraphNode, PRNode, EdgeReviewStatus } from "../types";
import { mergeAndCascade } from "../github";
import PRCard from "./PRCard";
import BranchCard from "./BranchCard";
import Legend from "./Legend";

export type Orientation = "horizontal" | "vertical";

interface Props {
  data: GraphData;
  orientation: Orientation;
  token: string;
}

const PR_WIDTH = 280;
const PR_HEIGHT = 120;
const BRANCH_WIDTH = 140;
const BRANCH_HEIGHT = 36;

const SPACING = {
  horizontal: { depth: 370, sibling: 136 },
  vertical: { depth: 210, sibling: 320 },
};

const COLORS = {
  ready: "var(--color-ready)",
  draft: "var(--color-draft)",
  readyBg: "var(--color-ready-bg)",
  draftBg: "var(--color-draft-bg)",
  branch: "var(--color-branch)",
  branchBg: "var(--color-branch-bg)",
  edge: "var(--color-edge)",
  conflict: "var(--color-conflict)",
  hover: "var(--color-hover)",
};

function isPR(d: GraphNode): d is PRNode {
  return d.type === "pr";
}

interface LayoutNode {
  data: GraphNode;
  x: number;
  y: number;
  children: LayoutNode[];
}

interface FlatEdge {
  source: LayoutNode;
  target: LayoutNode;
  hasConflict: boolean;
  isMergeable: boolean;
  reviewStatus: EdgeReviewStatus;
}

interface EdgeFlags {
  hasConflict: boolean;
  isMergeable: boolean;
  reviewStatus: EdgeReviewStatus;
}

function buildTrees(data: GraphData): {
  roots: LayoutNode[];
  edgeFlagsMap: Map<string, EdgeFlags>;
} {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of data.nodes) nodeMap.set(n.id, n);

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const edgeFlagsMap = new Map<string, EdgeFlags>();

  for (const e of data.edges) {
    const list = childrenOf.get(e.source) ?? [];
    list.push(e.target);
    childrenOf.set(e.source, list);
    hasParent.add(e.target);
    edgeFlagsMap.set(`${e.source}->${e.target}`, {
      hasConflict: e.hasConflict,
      isMergeable: e.isMergeable,
      reviewStatus: e.reviewStatus,
    });
  }

  const roots = data.nodes.filter((n) => !hasParent.has(n.id));

  function buildSubtree(id: string): LayoutNode {
    return {
      data: nodeMap.get(id)!,
      x: 0,
      y: 0,
      children: (childrenOf.get(id) ?? [])
        .filter((cid) => nodeMap.has(cid))
        .map(buildSubtree)
        .reverse(),
    };
  }

  return { roots: roots.map((r) => buildSubtree(r.id)), edgeFlagsMap };
}

function layoutTree(
  root: LayoutNode,
  startSecondary: number,
  orientation: Orientation,
): number {
  const { depth: depthSpacing, sibling: siblingSpacing } = SPACING[orientation];
  const isH = orientation === "horizontal";

  function assignDepth(node: LayoutNode, depth: number) {
    if (isH) node.x = depth * depthSpacing;
    else node.y = depth * depthSpacing;
    for (const child of node.children) assignDepth(child, depth + 1);
  }
  assignDepth(root, 0);

  let current = startSecondary;
  function assignSecondary(node: LayoutNode) {
    if (node.children.length === 0) {
      if (isH) node.y = current;
      else node.x = current;
      current += siblingSpacing;
      return;
    }
    for (const child of node.children) assignSecondary(child);
    const first = isH ? node.children[0].y : node.children[0].x;
    const last = isH
      ? node.children[node.children.length - 1].y
      : node.children[node.children.length - 1].x;
    if (isH) node.y = (first + last) / 2;
    else node.x = (first + last) / 2;
  }
  assignSecondary(root);

  return current;
}

function flattenTree(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

function flattenEdges(
  node: LayoutNode,
  edgeFlagsMap: Map<string, EdgeFlags>,
): FlatEdge[] {
  const edges: FlatEdge[] = [];
  for (const child of node.children) {
    const key = `${node.data.id}->${child.data.id}`;
    const flags = edgeFlagsMap.get(key);
    edges.push({
      source: node,
      target: child,
      hasConflict: flags?.hasConflict ?? false,
      isMergeable: flags?.isMergeable ?? false,
      reviewStatus: flags?.reviewStatus ?? null,
    });
    edges.push(...flattenEdges(child, edgeFlagsMap));
  }
  return edges;
}

function nodeWidth(d: GraphNode) {
  return isPR(d) ? PR_WIDTH : BRANCH_WIDTH;
}
function nodeHeight(d: GraphNode) {
  return isPR(d) ? PR_HEIGHT : BRANCH_HEIGHT;
}

function edgePath(e: FlatEdge, orientation: Orientation): string {
  if (orientation === "horizontal") {
    const sx = e.target.x - nodeWidth(e.target.data) / 2;
    const sy = e.target.y;
    const tx = e.source.x + nodeWidth(e.source.data) / 2;
    const ty = e.source.y;
    const mx = (sx + tx) / 2;
    return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
  }
  const sx = e.target.x;
  const sy = e.target.y - nodeHeight(e.target.data) / 2;
  const tx = e.source.x;
  const ty = e.source.y + nodeHeight(e.source.data) / 2;
  const my = (sy + ty) / 2;
  return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
}


function strokeColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branch;
  return d.isDraft ? COLORS.draft : COLORS.ready;
}
function bgColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branchBg;
  return d.isDraft ? COLORS.draftBg : COLORS.readyBg;
}

export default function GraphView({ data, orientation, token }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [merging, setMerging] = useState<number | null>(null);

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
                      onMerge={handleMerge}
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
