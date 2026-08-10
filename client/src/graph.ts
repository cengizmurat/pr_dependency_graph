import type { GraphQLPullRequest, GraphData, GraphNode, GraphEdge, EdgeReviewStatus } from "./types";

function reviewStatusFromDecision(
  reviewDecision: string | null,
): EdgeReviewStatus {
  if (reviewDecision === "CHANGES_REQUESTED") return "changes_requested";
  if (reviewDecision === "APPROVED") return "approved";
  return null;
}

function stateChangeTime(pr: GraphQLPullRequest): number {
  const t = Date.parse(pr.stateChangedAt);
  return Number.isNaN(t) ? 0 : t;
}

// Most recent state change first. The layout follows the order the PRs are
// listed in, so this is what orders the cards on screen: siblings under a
// parent, and the base-branch nodes by the freshest PR opened against them. A
// PR that has sat in draft for days ranks by the moment it was made ready, not
// by when it was created.
function byStateChangeDesc(
  a: GraphQLPullRequest,
  b: GraphQLPullRequest,
): number {
  const diff = stateChangeTime(b) - stateChangeTime(a);
  // Ties (and unreadable dates) fall back to PR number, newest first, so the
  // order stays stable across refreshes.
  return diff !== 0 ? diff : b.number - a.number;
}

export function buildDependencyGraph(
  unsortedPRs: GraphQLPullRequest[],
  owner: string,
  repo: string,
): GraphData {
  const prs = [...unsortedPRs].sort(byStateChangeDesc);

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
