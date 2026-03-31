import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";

export type PullRequest =
  RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

export type PullRequestDetail =
  RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];

export interface EnrichedPullRequest extends PullRequest {
  additions: number;
  deletions: number;
}

export async function fetchOpenPRs(
  token: string,
  owner: string,
  repo: string
): Promise<EnrichedPullRequest[]> {
  const octokit = new Octokit({ auth: token });

  const prs = await octokit.paginate(octokit.pulls.list, {
    owner,
    repo,
    state: "open",
    per_page: 100,
  });

  const detailed = await Promise.all(
    prs.map(async (pr) => {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pr.number,
      });
      return {
        ...pr,
        additions: data.additions,
        deletions: data.deletions,
      };
    })
  );

  return detailed;
}
