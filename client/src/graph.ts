import type {
  GraphQLPullRequest,
  GraphData,
  GraphNode,
  GraphEdge,
  EdgeReviewStatus,
  PRNode,
} from "./types";

// A merged pull request is past work: it is on the graph only as a layer of a
// stack, hangs off nothing and has nothing hanging off it. The layout puts it
// on the far side of the branch its stack targets — see layoutMergedPRs.
export function isMergedPR(node: GraphNode): node is PRNode {
  return node.type === "pr" && node.state === "MERGED";
}

// The branch a merged layer went into: the one its stack targets. GitHub
// retargets each layer to that branch as the ones below it merge, so the PR's
// own base says the same thing when the stack's is not known.
export function mergedIntoBranch(pr: { baseBranch: string; stack?: PRNode["stack"] }): string {
  return pr.stack?.baseRefName ?? pr.baseBranch;
}

export function branchNodeId(name: string): string {
  return `branch-${name}`;
}

function reviewStatusFromDecision(
  reviewDecision: string | null,
): EdgeReviewStatus {
  if (reviewDecision === "CHANGES_REQUESTED") return "changes_requested";
  if (reviewDecision === "APPROVED") return "approved";
  return null;
}

// The graph is drawn in stack order rather than in the order the PRs arrive
// in; that ordering needs the stacks assembled, so it lives in buildTrees.
export function buildDependencyGraph(
  prs: GraphQLPullRequest[],
  owner: string,
  repo: string,
): GraphData {
  // A merged PR's head branch is spent — usually deleted — so nothing depends
  // on it any more, even where a name gets reused.
  const headBranchToPR = new Map<string, GraphQLPullRequest>();
  for (const pr of prs) {
    if (pr.state !== "MERGED" && pr.headRefName !== pr.baseRefName) {
      headBranchToPR.set(pr.headRefName, pr);
    }
  }

  const nodes: GraphNode[] = prs.map((pr) => ({
    type: "pr" as const,
    id: `pr-${pr.number}`,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.authorLogin,
    avatarUrl: pr.authorAvatarUrl,
    baseBranch: pr.baseRefName,
    headBranch: pr.headRefName,
    isDraft: pr.isDraft,
    state: pr.state,
    mergedAt: pr.mergedAt,
    labels: pr.labels,
    createdAt: pr.createdAt,
    stateChangedAt: pr.stateChangedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    reviewers: pr.reviewers,
    reviewDecision: pr.reviewDecision,
    commentCount: pr.commentCount,
    details: pr.details,
    stack: pr.stack,
  }));

  const edges: GraphEdge[] = [];
  const branchNodes = new Map<string, GraphNode>();
  const addBranch = (name: string): string => {
    const branchId = branchNodeId(name);
    if (!branchNodes.has(branchId)) {
      branchNodes.set(branchId, {
        type: "branch",
        id: branchId,
        name,
        url: `https://github.com/${owner}/${repo}/tree/${name}`,
      });
    }
    return branchId;
  };

  for (const pr of prs) {
    // A merged layer has no dependency left to draw. The branch it went into
    // is still put on the graph, so there is something to draw it beside even
    // when every open layer of its stack is gone.
    if (pr.state === "MERGED") {
      addBranch(pr.stack?.baseRefName ?? pr.baseRefName);
      continue;
    }
    const hasConflict = pr.mergeable === "CONFLICTING";
    const isMergeable = pr.mergeStateStatus === "CLEAN";
    const reviewStatus = reviewStatusFromDecision(pr.reviewDecision);
    const dependency = headBranchToPR.get(pr.baseRefName);
    if (dependency && dependency.number !== pr.number) {
      edges.push({
        source: `pr-${dependency.number}`,
        target: `pr-${pr.number}`,
        hasConflict,
        isMergeable,
        reviewStatus,
      });
    } else {
      const branchId = addBranch(pr.baseRefName);
      edges.push({
        source: branchId,
        target: `pr-${pr.number}`,
        hasConflict,
        isMergeable,
        reviewStatus,
      });
    }
  }

  nodes.push(...branchNodes.values());

  return { nodes, edges, owner, repo };
}

// The graph with only the given pull requests left on it — what the "Filtered
// out PRs: Hidden" setting draws, so the PRs a filter kept are laid out on
// their own rather than faded in place among the ones it dropped.
//
// A dependency leaves with either of its ends, which makes a kept PR whose
// parent was dropped a root of its own rather than something hanging off a PR
// that is no longer there. The base branches under the kept PRs stay: a chip is
// small, and a PR still has to say what it is opened against.
//
// Keeping nothing would leave an empty page to look at, so a set that matches
// no PR on the graph gives the graph back whole.
export function restrictGraphToPRs(
  data: GraphData,
  prNumbers: ReadonlySet<number>,
): GraphData {
  const kept = new Set<string>();
  for (const node of data.nodes) {
    if (node.type === "pr" && prNumbers.has(node.number)) kept.add(node.id);
  }
  if (kept.size === 0) return data;

  const branchIds = new Set(
    data.nodes.filter((n) => n.type === "branch").map((n) => n.id),
  );
  for (const edge of data.edges) {
    if (branchIds.has(edge.source) && kept.has(edge.target)) kept.add(edge.source);
  }
  // A merged layer has no edge to say so, but it too is drawn against a branch.
  for (const node of data.nodes) {
    if (isMergedPR(node) && kept.has(node.id)) {
      const branchId = branchNodeId(mergedIntoBranch(node));
      if (branchIds.has(branchId)) kept.add(branchId);
    }
  }

  return {
    ...data,
    nodes: data.nodes.filter((n) => kept.has(n.id)),
    edges: data.edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
  };
}
