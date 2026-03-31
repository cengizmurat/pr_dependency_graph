import {
  createClient,
  type QueryGenqlSelection,
  type QueryResult,
} from "./generated/index.js";

export interface Reviewer {
  login: string;
  avatarUrl: string;
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
          reviews: {
            __args: { first: 100 },
            nodes: {
              author: { login: true, avatarUrl: true },
              comments: { totalCount: true },
            },
          },
          comments: { totalCount: true },
        },
      },
    },
  } satisfies QueryGenqlSelection;
}

type PRQueryResult = QueryResult<ReturnType<typeof buildQuery>>;

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

      const seen = new Set<string>();
      const reviewers: Reviewer[] = [];
      let reviewCommentCount = 0;

      for (const review of pr.reviews?.nodes ?? []) {
        if (!review) continue;
        reviewCommentCount += review.comments?.totalCount ?? 0;
        const login = review.author?.login;
        if (login && !seen.has(login)) {
          seen.add(login);
          reviewers.push({
            login,
            avatarUrl: review.author?.avatarUrl ?? "",
          });
        }
      }

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
          .filter((l): l is { name: string } => !!l?.name)
          .map((l) => l.name),
        reviewers,
        commentCount: (pr.comments?.totalCount ?? 0) + reviewCommentCount,
      });
    }

    cursor = prs.pageInfo.hasNextPage ? (prs.pageInfo.endCursor ?? null) : null;
  } while (cursor);

  return allPRs;
}
