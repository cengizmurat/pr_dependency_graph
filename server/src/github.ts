import {
  createClient,
  type QueryGenqlSelection,
  type QueryResult,
} from "./generated/index.js";

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "REQUESTED";

export interface Reviewer {
  login: string;
  avatarUrl: string;
  state: ReviewState;
}

export interface GraphQLPullRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  authorLogin: string;
  authorAvatarUrl: string;
  labels: string[];
  reviewers: Reviewer[];
  commentCount: number;
}

function buildQuery(cursor: string | null) {
  return {
    repository: {
      __args: { owner: "", name: "" },
      pullRequests: {
        __args: {
          states: ["OPEN"] as ["OPEN"],
          first: 100,
          after: cursor,
        },
        pageInfo: { hasNextPage: true, endCursor: true },
        nodes: {
          number: true,
          title: true,
          url: true,
          isDraft: true,
          createdAt: true,
          additions: true,
          deletions: true,
          headRefName: true,
          baseRefName: true,
          author: { login: true, avatarUrl: true },
          labels: { __args: { first: 20 }, nodes: { name: true } },
          latestReviews: {
            __args: { first: 100 },
            nodes: {
              state: true,
              author: { login: true, avatarUrl: true },
              comments: { totalCount: true },
            },
          },
          reviewRequests: {
            __args: { first: 100 },
            nodes: {
              requestedReviewer: {
                on_User: { login: true, avatarUrl: true },
              },
            },
          },
          comments: { totalCount: true },
        },
      },
    },
  } satisfies QueryGenqlSelection;
}

type PRQueryResult = QueryResult<ReturnType<typeof buildQuery>>;

export async function fetchViewerLogin(token: string): Promise<string> {
  const client = createClient({
    headers: {
      Authorization: `bearer ${token}`,
      "User-Agent": "pr-dependency-graph",
    },
  });
  const data = await client.query({ viewer: { login: true } });
  return data.viewer?.login ?? "";
}

export async function fetchOpenPRs(
  token: string,
  owner: string,
  repo: string,
): Promise<GraphQLPullRequest[]> {
  const client = createClient({
    headers: {
      Authorization: `bearer ${token}`,
      "User-Agent": "pr-dependency-graph",
    },
  });

  const allPRs: GraphQLPullRequest[] = [];
  let cursor: string | null = null;

  do {
    const query = buildQuery(cursor);
    query.repository.__args.owner = owner;
    query.repository.__args.name = repo;

    const data: PRQueryResult = await client.query(query);
    const prs = data.repository?.pullRequests;
    if (!prs?.nodes) break;

    for (const pr of prs.nodes) {
      if (!pr) continue;

      const reviewerMap = new Map<string, Reviewer>();
      let reviewCommentCount = 0;

      for (const review of pr.latestReviews?.nodes ?? []) {
        if (!review) continue;
        reviewCommentCount += review.comments?.totalCount ?? 0;
        const login = review.author?.login;
        if (login) {
          reviewerMap.set(login, {
            login,
            avatarUrl: review.author?.avatarUrl ?? "",
            state: (review.state as ReviewState) ?? "COMMENTED",
          });
        }
      }

      for (const req of pr.reviewRequests?.nodes ?? []) {
        const reviewer = req?.requestedReviewer;
        if (!reviewer || !("login" in reviewer) || typeof reviewer.login !== "string") continue;
        if (!reviewerMap.has(reviewer.login)) {
          reviewerMap.set(reviewer.login, {
            login: reviewer.login,
            avatarUrl: ("avatarUrl" in reviewer ? String(reviewer.avatarUrl) : ""),
            state: "REQUESTED",
          });
        }
      }

      const reviewers = [...reviewerMap.values()];

      allPRs.push({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        isDraft: pr.isDraft,
        createdAt: pr.createdAt,
        additions: pr.additions,
        deletions: pr.deletions,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        authorLogin: pr.author?.login ?? "unknown",
        authorAvatarUrl: pr.author?.avatarUrl ?? "",
        labels: (pr.labels?.nodes ?? [])
          .filter((l: { name?: string } | null | undefined): l is { name: string } => !!l?.name)
          .map((l: { name: string }) => l.name),
        reviewers,
        commentCount: (pr.comments?.totalCount ?? 0) + reviewCommentCount,
      });
    }

    cursor = prs.pageInfo.hasNextPage ? (prs.pageInfo.endCursor ?? null) : null;
  } while (cursor);

  return allPRs;
}
