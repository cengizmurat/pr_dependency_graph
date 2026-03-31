import { GraphQLPullRequest } from "./github.js";
import { GraphData, GraphNode, GraphEdge } from "./types.js";

export function buildDependencyGraph(
  prs: GraphQLPullRequest[],
  owner: string,
  repo: string,
): GraphData {
  const headBranchToPR = new Map<string, GraphQLPullRequest>();
  for (const pr of prs) {
    headBranchToPR.set(pr.headRefName, pr);
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
    additions: pr.additions,
    deletions: pr.deletions,
    reviewers: pr.reviewers,
    commentCount: pr.commentCount,
  }));

  const edges: GraphEdge[] = [];
  const branchNodes = new Map<string, GraphNode>();

  for (const pr of prs) {
    const dependency = headBranchToPR.get(pr.baseRefName);
    if (dependency) {
      edges.push({
        source: `pr-${dependency.number}`,
        target: `pr-${pr.number}`,
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
      });
    }
  }

  nodes.push(...branchNodes.values());

  return { nodes, edges, owner, repo };
}
