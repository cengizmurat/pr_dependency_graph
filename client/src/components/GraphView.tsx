import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphData, GraphNode, PRNode } from "../types";
import PRCard from "./PRCard";
import BranchCard from "./BranchCard";

interface Props {
  data: GraphData;
}

const PR_WIDTH = 260;
const PR_HEIGHT = 82;
const BRANCH_WIDTH = 140;
const BRANCH_HEIGHT = 36;
const H_SPACING = 320;
const V_SPACING = 90;

const COLORS = {
  ready: "#238636",
  draft: "#6e7681",
  readyBg: "#1b2a1f",
  draftBg: "#1c1e23",
  branch: "#8957e5",
  branchBg: "#1e1535",
  edge: "#30363d",
  hover: "#58a6ff",
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
}

function buildTrees(data: GraphData): LayoutNode[] {
  const nodeMap = new Map<string, GraphNode>();
  for (const n of data.nodes) nodeMap.set(n.id, n);

  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const e of data.edges) {
    const list = childrenOf.get(e.source) ?? [];
    list.push(e.target);
    childrenOf.set(e.source, list);
    hasParent.add(e.target);
  }

  const roots = data.nodes.filter((n) => !hasParent.has(n.id));

  function buildSubtree(id: string): LayoutNode {
    return {
      data: nodeMap.get(id)!,
      x: 0,
      y: 0,
      children: (childrenOf.get(id) ?? [])
        .filter((cid) => nodeMap.has(cid))
        .map(buildSubtree),
    };
  }

  return roots.map((r) => buildSubtree(r.id));
}

function layoutTree(root: LayoutNode, startY: number): number {
  function assignDepth(node: LayoutNode, depth: number) {
    node.x = depth * H_SPACING;
    for (const child of node.children) assignDepth(child, depth + 1);
  }
  assignDepth(root, 0);

  let currentY = startY;
  function assignY(node: LayoutNode) {
    if (node.children.length === 0) {
      node.y = currentY;
      currentY += V_SPACING;
      return;
    }
    for (const child of node.children) assignY(child);
    node.y =
      (node.children[0].y + node.children[node.children.length - 1].y) / 2;
  }
  assignY(root);

  return currentY;
}

function flattenTree(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

function flattenEdges(node: LayoutNode): FlatEdge[] {
  const edges: FlatEdge[] = [];
  for (const child of node.children) {
    edges.push({ source: node, target: child });
    edges.push(...flattenEdges(child));
  }
  return edges;
}

function nodeWidth(d: GraphNode) {
  return isPR(d) ? PR_WIDTH : BRANCH_WIDTH;
}
function nodeHeight(d: GraphNode) {
  return isPR(d) ? PR_HEIGHT : BRANCH_HEIGHT;
}

function edgePath(e: FlatEdge): string {
  const sx = e.source.x + nodeWidth(e.source.data) / 2;
  const sy = e.source.y;
  const tx = e.target.x - nodeWidth(e.target.data) / 2;
  const ty = e.target.y;
  const mx = (sx + tx) / 2;
  return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
}

function strokeColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branch;
  return d.isDraft ? COLORS.draft : COLORS.ready;
}
function bgColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branchBg;
  return d.isDraft ? COLORS.draftBg : COLORS.readyBg;
}

export default function GraphView({ data }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { allNodes, allEdges, totalWidth, totalHeight } = useMemo(() => {
    const trees = buildTrees(data);
    let nextY = V_SPACING;
    for (const tree of trees) {
      nextY = layoutTree(tree, nextY) + V_SPACING;
    }
    const nodes = trees.flatMap(flattenTree);
    const edges = trees.flatMap(flattenEdges);
    const maxX = nodes.reduce((m, n) => Math.max(m, n.x), 0);
    return {
      allNodes: nodes,
      allEdges: edges,
      totalWidth: maxX + PR_WIDTH + 80,
      totalHeight: nextY,
    };
  }, [data]);

  const fitView = useCallback(() => {
    const svg = svgRef.current;
    const g = gRef.current;
    if (!svg || !g) return;

    const width = svg.clientWidth;
    const height = svg.clientHeight;
    const padding = 40;
    const scaleX = (width - padding * 2) / totalWidth;
    const scaleY = (height - padding * 2) / totalHeight;
    const scale = Math.min(scaleX, scaleY, 1);
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
    <div style={{ width: "100%", height: "100%", background: "#0d1117" }}>
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
        </defs>

        <g ref={gRef}>
          {allEdges.map((e, i) => (
            <path
              key={i}
              d={edgePath(e)}
              fill="none"
              stroke={COLORS.edge}
              strokeWidth={2}
              markerEnd="url(#arrowhead)"
            />
          ))}

          {allNodes.map((n) => {
            const w = nodeWidth(n.data);
            const h = nodeHeight(n.data);
            const isHovered = hoveredId === n.data.id;
            const stroke = isHovered
              ? COLORS.hover
              : strokeColor(n.data);

            return (
              <g
                key={n.data.id}
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredId(n.data.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() =>
                  window.open(n.data.url, "_blank", "noopener")
                }
              >
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={8}
                  ry={8}
                  fill={bgColor(n.data)}
                  stroke={stroke}
                  strokeWidth={1.5}
                />
                <foreignObject
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                >
                  {isPR(n.data) ? (
                    <PRCard pr={n.data} />
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
