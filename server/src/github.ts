import { Octokit, type RestEndpointMethodTypes } from "@octokit/rest";

export type PullRequest =
  RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][number];

export type PullRequestDetail =
  RestEndpointMethodTypes["pulls"]["get"]["response"]["data"];

export interface Reviewer {
  login: string;
  avatarUrl: string;
}

export interface EnrichedPullRequest extends PullRequest {
  additions: number;
  deletions: number;
  reviewers: Reviewer[];
  commentCount: number;
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
      const [{ data: detail }, reviews] = await Promise.all([
        octokit.pulls.get({ owner, repo, pull_number: pr.number }),
        octokit.paginate(octokit.pulls.listReviews, {
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        }),
      ]);

      const seen = new Set<string>();
      const reviewers: Reviewer[] = [];
      for (const r of reviews) {
        const login = r.user?.login;
        if (login && !seen.has(login)) {
          seen.add(login);
          reviewers.push({
            login,
            avatarUrl: r.user?.avatar_url ?? "",
          });
        }
      }

      return {
        ...pr,
        additions: detail.additions,
        deletions: detail.deletions,
        reviewers,
        commentCount: detail.comments + detail.review_comments,
      };
    })
  );

  return detailed;
}
