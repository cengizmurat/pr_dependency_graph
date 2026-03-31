import { EnrichedPullRequest } from "./github.js";
import { GraphData, GraphNode, GraphEdge } from "./types.js";

export function buildDependencyGraph(
  prs: EnrichedPullRequest[],
  owner: string,
  repo: string
): GraphData {
  const headBranchToPR = new Map<string, EnrichedPullRequest>();
  for (const pr of prs) {
    headBranchToPR.set(pr.head.ref, pr);
  }

  const nodes: GraphNode[] = prs.map((pr) => ({
    type: "pr" as const,
    id: `pr-${pr.number}`,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    author: pr.user?.login ?? "unknown",
    avatarUrl: pr.user?.avatar_url ?? "",
    baseBranch: pr.base.ref,
    headBranch: pr.head.ref,
    isDraft: pr.draft ?? false,
    labels: pr.labels.map((l) => l.name).filter((n): n is string => !!n),
    createdAt: pr.created_at,
    additions: pr.additions,
    deletions: pr.deletions,
  }));

  const edges: GraphEdge[] = [];
  const branchNodes = new Map<string, GraphNode>();

  for (const pr of prs) {
    const dependency = headBranchToPR.get(pr.base.ref);
    if (dependency) {
      edges.push({
        source: `pr-${dependency.number}`,
        target: `pr-${pr.number}`,
      });
    } else {
      const branchId = `branch-${pr.base.ref}`;
      if (!branchNodes.has(branchId)) {
        branchNodes.set(branchId, {
          type: "branch",
          id: branchId,
          name: pr.base.ref,
          url: `https://github.com/${owner}/${repo}/tree/${pr.base.ref}`,
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
