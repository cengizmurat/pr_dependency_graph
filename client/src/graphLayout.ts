import type { GraphData, GraphNode, Orientation, LayoutNode, FlatEdge, EdgeFlags } from "./types";
import { PR_WIDTH, PR_HEIGHT, BRANCH_WIDTH, BRANCH_HEIGHT, SPACING, COLORS } from "./constants";
import { isPR } from "./utils";

export function buildTrees(data: GraphData): {
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
        .map(buildSubtree),
    };
  }

  return { roots: roots.map((r) => buildSubtree(r.id)), edgeFlagsMap };
}

export function layoutTree(
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

export function flattenTree(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flattenTree)];
}

export function flattenEdges(
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

export function nodeWidth(d: GraphNode) {
  return isPR(d) ? PR_WIDTH : BRANCH_WIDTH;
}

export function nodeHeight(d: GraphNode) {
  return isPR(d) ? PR_HEIGHT : BRANCH_HEIGHT;
}

export function edgePath(e: FlatEdge, orientation: Orientation): string {
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

export function strokeColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branch;
  return d.isDraft ? COLORS.draft : COLORS.ready;
}

export function bgColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branchBg;
  return d.isDraft ? COLORS.draftBg : COLORS.readyBg;
}
