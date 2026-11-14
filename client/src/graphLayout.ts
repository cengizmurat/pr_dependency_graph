import type {
  GraphData,
  GraphNode,
  PRNode,
  PRLabel,
  Orientation,
  LayoutNode,
  FlatEdge,
  EdgeFlags,
  MergedEdge,
  StackBox,
} from "./types";
import {
  PR_WIDTH,
  PR_HEIGHT,
  BRANCH_WIDTH,
  BRANCH_HEIGHT,
  SPACING,
  COLORS,
  STACK_BOX_PAD,
  STACK_LEAF_ROOM,
} from "./constants";
import { isPR } from "./utils";
import { branchNodeId, isMergedPR, mergedIntoBranch } from "./graph";

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
  } else if (pr.details.labels !== "loaded") {
    // One row for the spinner, or the warning, that stands in for the labels.
    h += PR_LABEL_ROW_PX;
  }
  return h;
}

// A PR's own state change, in milliseconds — when it last went ready for
// review or back to draft. Branch nodes have no state of their own and rank
// purely by the pull requests sitting on them.
function stateChangeTime(node: GraphNode): number {
  if (!isPR(node)) return 0;
  const t = Date.parse(node.stateChangedAt);
  return Number.isNaN(t) ? 0 : t;
}

// A subtree — a stack, or a branch node with every stack opened against it —
// paired with what it is ranked by.
interface RankedNode {
  node: LayoutNode;
  // The freshest state change anywhere in the subtree. A stack is as recent as
  // its most recently changed pull request, wherever in the stack that PR sits:
  // a layer going ready for review brings the whole stack forward, rather than
  // leaving it ranked by the PR at the bottom.
  recency: number;
  // Highest PR number in the subtree, the tiebreak when two stacks changed at
  // the same moment — so the order stays stable across refreshes.
  topNumber: number;
}

// Freshest stack first.
function byRecencyDesc(a: RankedNode, b: RankedNode): number {
  const diff = b.recency - a.recency;
  return diff !== 0 ? diff : b.topNumber - a.topNumber;
}

// The trees hold everything that still depends on something. Merged stack
// layers depend on nothing any more, so they are handed back on their own and
// placed afterwards, beside the branch they went into.
export function buildTrees(data: GraphData): {
  roots: LayoutNode[];
  edgeFlagsMap: Map<string, EdgeFlags>;
  merged: PRNode[];
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

  const merged = data.nodes.filter(isMergedPR);
  const roots = data.nodes.filter((n) => !hasParent.has(n.id) && !isMergedPR(n));

  // Each subtree is ranked by the whole of what it holds, so the sort applies
  // at every level: the stacks opened against a base branch, the branches
  // themselves, and the PRs stacked on one parent are all ordered by their
  // freshest pull request.
  function buildSubtree(id: string): RankedNode {
    const nodeData = nodeMap.get(id)!;
    const children = (childrenOf.get(id) ?? [])
      .filter((cid) => nodeMap.has(cid))
      .map(buildSubtree)
      .sort(byRecencyDesc);

    return {
      node: {
        data: nodeData,
        x: 0,
        y: 0,
        children: children.map((c) => c.node),
      },
      recency: Math.max(stateChangeTime(nodeData), ...children.map((c) => c.recency)),
      topNumber: Math.max(
        isPR(nodeData) ? nodeData.number : 0,
        ...children.map((c) => c.topNumber),
      ),
    };
  }

  const rankedRoots = roots.map((r) => buildSubtree(r.id)).sort(byRecencyDesc);

  return { roots: rankedRoots.map((r) => r.node), edgeFlagsMap, merged };
}

function stackNumber(node: GraphNode): number | null {
  return isPR(node) && node.stack ? node.stack.number : null;
}

// `minLeafSize` gives a leaf more room across the tree than its own card
// needs, by node id — for a branch that has a row of merged PRs beside it.
export function layoutTree(
  root: LayoutNode,
  startSecondary: number,
  orientation: Orientation,
  minLeafSize?: ReadonlyMap<string, number>,
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
      const own = isH ? nodeHeight(node.data) : nodeWidth(node.data);
      const size = Math.max(own, minLeafSize?.get(node.data.id) ?? 0);
      // The rectangle around a stack reaches past its cards, so the end of a
      // stack keeps that much more distance from what comes before it.
      if (stackNumber(node.data) !== null) current += STACK_LEAF_ROOM[orientation];
      current += size / 2;
      if (isH) node.y = current;
      else node.x = current;
      current += size / 2 + siblingGap;
      return;
    }
    for (const child of node.children) assignSecondary(child);

    // A GitHub stack is a chain, and it is drawn as one: a layer sits level
    // with the next layer of its stack rather than midway between everything
    // that depends on it. That keeps the stack a straight line, so the
    // rectangle around it never takes in a card that is not part of it.
    const stack = stackNumber(node.data);
    const nextLayer =
      stack === null
        ? undefined
        : node.children.find((child) => stackNumber(child.data) === stack);
    if (nextLayer) {
      if (isH) node.y = nextLayer.y;
      else node.x = nextLayer.x;
      return;
    }

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

// The link from a merged layer to what it went into. It leaves the far side of
// the card — the one facing the branch — and arrives on the near side of its
// target, so it reads as flowing into the branch.
export function mergedEdgePath(e: MergedEdge, orientation: Orientation): string {
  if (orientation === "horizontal") {
    const sx = e.from.x + nodeWidth(e.from.data) / 2;
    const sy = e.from.y;
    const tx = e.to.x - nodeWidth(e.to.data) / 2;
    const ty = e.to.y;
    const mx = (sx + tx) / 2;
    return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
  }
  const sx = e.from.x;
  const sy = e.from.y + nodeHeight(e.from.data) / 2;
  const tx = e.to.x;
  const ty = e.to.y - nodeHeight(e.to.data) / 2;
  const my = (sy + ty) / 2;
  return `M${sx},${sy} C${sx},${my} ${tx},${my} ${tx},${ty}`;
}

export function strokeColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branch;
  if (d.state === "MERGED") return COLORS.merged;
  return d.isDraft ? COLORS.draft : COLORS.ready;
}

export function bgColor(d: GraphNode): string {
  if (!isPR(d)) return COLORS.branchBg;
  if (d.state === "MERGED") return COLORS.mergedBg;
  return d.isDraft ? COLORS.draftBg : COLORS.readyBg;
}

// --- Merged stack layers ---

// The merged layers of one stack, bottom layer first.
interface MergedGroup {
  // Null for a merged PR that is in no stack; it is then a group of its own.
  stack: number | null;
  branchId: string;
  prs: PRNode[];
}

function groupMergedPRs(merged: PRNode[]): MergedGroup[] {
  const groups = new Map<string, MergedGroup>();
  for (const pr of merged) {
    const key = pr.stack ? `stack-${pr.stack.number}` : pr.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        stack: pr.stack?.number ?? null,
        branchId: branchNodeId(mergedIntoBranch(pr)),
        prs: [],
      };
      groups.set(key, group);
    }
    group.prs.push(pr);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.prs.sort(
      (a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0) || a.number - b.number,
    );
  }
  // By stack number, so the rows hold still across a refresh.
  return result.sort(
    (a, b) => (a.stack ?? a.prs[0].number) - (b.stack ?? b.prs[0].number),
  );
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: FlatEdge[];
  mergedEdges: MergedEdge[];
  stackBoxes: StackBox[];
  // The extent of the trees from the origin. Merged layers sit at negative
  // coordinates, on the far side of their branch, and are not counted here.
  width: number;
  height: number;
}

// Lays out the whole graph: the trees first, then the merged layers of each
// stack, then the rectangle around every stack.
//
// A merged layer is past work, so it goes on the far side of the branch its
// stack targets — to the left of `main` when the graph runs left to right,
// above it when it runs top to bottom — level with the stack's open layers.
// Read across, a stack is then one line in the order of its layers: what has
// merged, the branch it merged into, and what is still open against it.
export function layoutGraph(data: GraphData, orientation: Orientation): GraphLayout {
  const { roots, edgeFlagsMap, merged } = buildTrees(data);
  const isH = orientation === "horizontal";
  const { depth: depthSpacing, sibling: siblingSpacing } = SPACING[orientation];
  const siblingGap = siblingSpacing - (isH ? PR_HEIGHT : PR_WIDTH);
  const depthGap = depthSpacing - (isH ? PR_WIDTH : PR_HEIGHT);
  const acrossSize = (d: GraphNode) => (isH ? nodeHeight(d) : nodeWidth(d));

  const groups = groupMergedPRs(merged);

  // A stack with nothing open left has no row of its own to line up with. The
  // first such stack takes the row of its branch, when the branch has nothing
  // else on it, and that row is given the room the cards need.
  const openStacks = new Set<number>();
  for (const node of data.nodes) {
    const stack = stackNumber(node);
    if (stack !== null && !isMergedPR(node)) openStacks.add(stack);
  }
  const onBranchRow = new Map<string, MergedGroup>();
  const minLeafSize = new Map<string, number>();
  for (const group of groups) {
    if (group.stack !== null && openStacks.has(group.stack)) continue;
    const root = roots.find((r) => r.data.id === group.branchId);
    if (!root || root.children.length > 0 || onBranchRow.has(group.branchId)) continue;
    onBranchRow.set(group.branchId, group);
    minLeafSize.set(group.branchId, Math.max(...group.prs.map(acrossSize)));
  }

  let nextSecondary = siblingSpacing;
  for (const tree of roots) {
    nextSecondary = layoutTree(tree, nextSecondary, orientation, minLeafSize) + siblingSpacing;
  }
  const nodes = roots.flatMap(flattenTree);
  const edges = roots.flatMap((t) => flattenEdges(t, edgeFlagsMap));

  const byId = new Map(nodes.map((n) => [n.data.id, n]));
  // The lowest open layer of each stack: the row its merged layers join.
  const lowestOpen = new Map<number, LayoutNode>();
  for (const node of nodes) {
    if (!isPR(node.data) || !node.data.stack) continue;
    const { number, position } = node.data.stack;
    const current = lowestOpen.get(number);
    if (!current || position < (current.data as PRNode).stack!.position) {
      lowestOpen.set(number, node);
    }
  }

  const mergedNodes: LayoutNode[] = [];
  const mergedEdges: MergedEdge[] = [];
  const takenRows = new Set<number>();

  for (const group of groups) {
    const branch = byId.get(group.branchId);
    const open = group.stack === null ? undefined : lowestOpen.get(group.stack);

    let across: number | null = null;
    if (open) across = isH ? open.y : open.x;
    else if (branch && onBranchRow.get(group.branchId) === group) {
      across = isH ? branch.y : branch.x;
    }
    // Two stacks can end up level with each other at different depths. Their
    // merged layers would then land on the same spot, so the later one moves
    // to a row of its own.
    if (across !== null && takenRows.has(Math.round(across))) across = null;
    if (across === null) {
      const size = Math.max(...group.prs.map(acrossSize));
      across = nextSecondary + size / 2;
      nextSecondary = across + size / 2 + siblingGap + siblingSpacing;
    }
    takenRows.add(Math.round(across));

    // Outwards from the branch: the last layer to merge is the one next to it.
    let previous: LayoutNode | undefined = branch;
    let along = branch ? (isH ? branch.x : branch.y) : 0;
    let previousHeight = branch ? nodeHeight(branch.data) : BRANCH_HEIGHT;
    for (let i = group.prs.length - 1; i >= 0; i--) {
      const pr = group.prs[i];
      if (isH) {
        along -= depthSpacing;
      } else {
        const height = nodeHeight(pr);
        along -= previousHeight / 2 + depthGap + height / 2;
        previousHeight = height;
      }
      const node: LayoutNode = {
        data: pr,
        x: isH ? along : across,
        y: isH ? across : along,
        children: [],
      };
      mergedNodes.push(node);
      if (previous) mergedEdges.push({ from: node, to: previous });
      previous = node;
    }
  }

  const allNodes = [...nodes, ...mergedNodes];

  let width: number;
  let height: number;
  if (isH) {
    width = nodes.reduce((m, n) => Math.max(m, n.x), 0) + PR_WIDTH + 80;
    height = nextSecondary;
  } else {
    width = nextSecondary;
    height = nodes.reduce((m, n) => Math.max(m, n.y + nodeHeight(n.data) / 2), 0) + 80;
  }

  return {
    nodes: allNodes,
    edges,
    mergedEdges,
    stackBoxes: buildStackBoxes(allNodes),
    width,
    height,
  };
}

// One rectangle per stack, around every layer of it that is drawn.
function buildStackBoxes(nodes: LayoutNode[]): StackBox[] {
  const boxes = new Map<
    number,
    { size: number; nodeIds: string[]; minX: number; minY: number; maxX: number; maxY: number }
  >();
  for (const node of nodes) {
    if (!isPR(node.data) || !node.data.stack) continue;
    const { number, size } = node.data.stack;
    const w = nodeWidth(node.data);
    const h = nodeHeight(node.data);
    let box = boxes.get(number);
    if (!box) {
      box = { size, nodeIds: [], minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      boxes.set(number, box);
    }
    box.nodeIds.push(node.data.id);
    box.minX = Math.min(box.minX, node.x - w / 2);
    box.maxX = Math.max(box.maxX, node.x + w / 2);
    box.minY = Math.min(box.minY, node.y - h / 2);
    box.maxY = Math.max(box.maxY, node.y + h / 2);
  }
  return [...boxes.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, box]) => ({
      number,
      size: box.size,
      nodeIds: box.nodeIds,
      x: box.minX - STACK_BOX_PAD.left,
      y: box.minY - STACK_BOX_PAD.top,
      width: box.maxX - box.minX + STACK_BOX_PAD.left + STACK_BOX_PAD.right,
      height: box.maxY - box.minY + STACK_BOX_PAD.top + STACK_BOX_PAD.bottom,
    }));
}
