import type { GraphQLPullRequest, GraphData, GraphNode, GraphEdge, EdgeReviewStatus } from "./types";

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
  const headBranchToPR = new Map<string, GraphQLPullRequest>();
  for (const pr of prs) {
    if (pr.headRefName !== pr.baseRefName) {
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
    labels: pr.labels,
    createdAt: pr.createdAt,
    stateChangedAt: pr.stateChangedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    reviewers: pr.reviewers,
    reviewDecision: pr.reviewDecision,
    commentCount: pr.commentCount,
    stack: pr.stack,
  }));

  const edges: GraphEdge[] = [];
  const branchNodes = new Map<string, GraphNode>();

  for (const pr of prs) {
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
      const branchId = `branch-${pr.baseRefName}`;
      if (!branchNodes.has(branchId)) {
        branchNodes.set(branchId, {
          type: "branch",
          id: branchId,
          name: pr.baseRefName,
          url: `https://github.com/${owner}/${repo}/tree/${pr.baseRefName}`,
        });
      }
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

  return {
    ...data,
    nodes: data.nodes.filter((n) => kept.has(n.id)),
    edges: data.edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
  };
}
