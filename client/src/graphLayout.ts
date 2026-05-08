import type { GraphData, GraphNode, PRNode, PRLabel, Orientation, LayoutNode, FlatEdge, EdgeFlags } from "./types";
import { PR_WIDTH, PR_HEIGHT, BRANCH_WIDTH, BRANCH_HEIGHT, SPACING, COLORS } from "./constants";
import { isPR } from "./utils";

const PR_BASE_HEIGHT = 95;
const PR_TITLE_LINE_PX = 17;
const PR_TITLE_CHARS_PER_LINE = 30;
const PR_LABEL_ROW_PX = 22;
const PR_LABEL_CHIP_CHAR_PX = 6;
const PR_LABEL_CHIP_PAD_PX = 14;
const PR_LABEL_CHIP_GAP_PX = 3;
const PR_LABELS_INNER_WIDTH = PR_WIDTH - 30;

function estimateLabelRows(labels: PRLabel[]): number {
  let rowWidth = 0;
  let rows = 1;
  for (const label of labels) {
    const chipWidth = label.name.length * PR_LABEL_CHIP_CHAR_PX + PR_LABEL_CHIP_PAD_PX;
    if (rowWidth === 0) {
      rowWidth = chipWidth;
    } else if (rowWidth + PR_LABEL_CHIP_GAP_PX + chipWidth > PR_LABELS_INNER_WIDTH) {
      rows++;
      rowWidth = chipWidth;
    } else {
      rowWidth += PR_LABEL_CHIP_GAP_PX + chipWidth;
    }
  }
  return rows;
}

function estimatePRHeight(pr: PRNode): number {
  let h = PR_BASE_HEIGHT;
  const titleLines = Math.max(1, Math.ceil(pr.title.length / PR_TITLE_CHARS_PER_LINE));
  h += (titleLines - 1) * PR_TITLE_LINE_PX;
  if (pr.labels.length > 0) {
    h += estimateLabelRows(pr.labels) * PR_LABEL_ROW_PX;
  }
  return h;
}

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
  const siblingGap = siblingSpacing - (isH ? PR_HEIGHT : PR_WIDTH);
  const depthGap = depthSpacing - (isH ? PR_WIDTH : PR_HEIGHT);

  const levelOrigin: number[] = [];
  if (!isH) {
    const levelMaxH: number[] = [];
    const collectLevelMax = (node: LayoutNode, depth: number) => {
      const h = nodeHeight(node.data);
      levelMaxH[depth] = Math.max(levelMaxH[depth] ?? 0, h);
      for (const c of node.children) collectLevelMax(c, depth + 1);
    };
    collectLevelMax(root, 0);
    let yCursor = 0;
    for (let i = 0; i < levelMaxH.length; i++) {
      yCursor += levelMaxH[i] / 2;
      levelOrigin[i] = yCursor;
      yCursor += levelMaxH[i] / 2 + depthGap;
    }
  }

  const assignDepth = (node: LayoutNode, depth: number) => {
    if (isH) node.x = depth * depthSpacing;
    else node.y = levelOrigin[depth] ?? depth * depthSpacing;
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  assignDepth(root, 0);

  let current = startSecondary;
  const assignSecondary = (node: LayoutNode) => {
    if (node.children.length === 0) {
      const size = isH ? nodeHeight(node.data) : nodeWidth(node.data);
      current += size / 2;
      if (isH) node.y = current;
      else node.x = current;
      current += size / 2 + siblingGap;
      return;
    }
    for (const child of node.children) assignSecondary(child);
    const first = isH ? node.children[0].y : node.children[0].x;
    const last = isH
      ? node.children[node.children.length - 1].y
      : node.children[node.children.length - 1].x;
    if (isH) node.y = (first + last) / 2;
    else node.x = (first + last) / 2;
  };
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
  return isPR(d) ? estimatePRHeight(d) : BRANCH_HEIGHT;
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
