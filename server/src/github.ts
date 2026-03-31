import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";

export type PullRequest =
  RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

export async function fetchOpenPRs(
  token: string,
  owner: string,
  repo: string
): Promise<PullRequest[]> {
  const octokit = new Octokit({ auth: token });

  const prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });

  return prs;
}
