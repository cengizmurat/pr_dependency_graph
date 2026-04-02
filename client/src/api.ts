import type { GraphData } from "./types";
import { fetchOpenPRs, fetchViewerLogin } from "./github";
import { buildDependencyGraph } from "./graph";

export async function fetchGraph(
  owner: string,
  repo: string,
  token: string,
): Promise<GraphData> {
  const [prs, viewerLogin] = await Promise.all([
    fetchOpenPRs(token, owner, repo),
    fetchViewerLogin(token),
  ]);
  const graph = buildDependencyGraph(prs, owner, repo);
  graph.viewerLogin = viewerLogin;
  return graph;
}
