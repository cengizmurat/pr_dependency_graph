import type {
  ReviewState,
  Mergeable,
  Reviewer,
  ReviewDecision,
  GraphQLPullRequest,
  CascadeResult,
  PRPageResult,
  Contributor,
  UserRepo,
} from "./types";
import { getToken } from "./auth";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

async function fetchWithAuth(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const buildInit = (bearer: string): RequestInit => {
    const headers = new Headers(init.headers ?? {});
    headers.set("Authorization", `bearer ${bearer}`);
    return { ...init, headers };
  };

  const res = await fetch(url, buildInit(token));
  if (res.status !== 401) return res;

  let refreshed: string;
  try {
    refreshed = await getToken({ forceRefresh: true });
  } catch {
    return res;
  }
  if (refreshed === token) return res;
  return fetch(url, buildInit(refreshed));
}

const PR_QUERY = `
query($owner: String!, $name: String!, $cursor: String, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt additions deletions
        headRefName baseRefName mergeable mergeStateStatus reviewDecision
        author { login avatarUrl }
        labels(first: 20) { nodes { name } }
        latestReviews(first: 100) {
          nodes {
            state
            author { login avatarUrl }
            comments { totalCount }
          }
        }
        reviewRequests(first: 100) {
          nodes {
            requestedReviewer {
              ... on User { login avatarUrl }
            }
          }
        }
        comments { totalCount }
      }
    }
  }
}`;

const VIEWER_QUERY = `query { viewer { login } }`;

const FETCH_TIMEOUT_MS = 10_000;

async function graphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(token, GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `GitHub API returned ${res.status}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data as T;
}

export async function mergePR(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<void> {
  const res = await fetchWithAuth(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ merge_method: "merge" }),
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Merge failed with status ${res.status}`);
  }
}

export async function updatePRBase(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
  newBase: string,
): Promise<void> {
  const res = await fetchWithAuth(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base: newBase }),
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Retarget failed with status ${res.status}`);
  }
}

export async function updatePRBranch(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<void> {
  const res = await fetchWithAuth(
    token,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/update-branch`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Branch update failed with status ${res.status}`);
  }
}

export async function mergeAndCascade(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  nodes: { type: string; number?: number; title?: string; baseBranch?: string; headBranch?: string }[],
): Promise<CascadeResult> {
  const prNodes = nodes.filter(
    (n): n is typeof n & { number: number; baseBranch: string; headBranch: string; title: string } =>
      n.type === "pr" && n.number != null,
  );

  const mergedPR = prNodes.find((n) => n.number === prNumber);
  if (!mergedPR) throw new Error(`PR #${prNumber} not found in graph`);

  await mergePR(token, owner, repo, prNumber);

  const dependents = prNodes.filter((n) => n.baseBranch === mergedPR.headBranch);
  const result: CascadeResult = { merged: prNumber, updated: [], errors: [] };

  for (const dep of dependents) {
    try {
      await updatePRBase(token, owner, repo, dep.number, mergedPR.baseBranch);
      await updatePRBranch(token, owner, repo, dep.number);
      result.updated.push({ number: dep.number, title: dep.title });
    } catch (err) {
      result.errors.push({
        number: dep.number,
        message: (err as Error).message,
      });
    }
  }

  return result;
}

async function fetchCompareBehindBy(
  token: string,
  owner: string,
  repo: string,
  base: string,
  head: string,
): Promise<number> {
  const res = await fetchWithAuth(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
      cache: "no-store",
    },
  );
  if (!res.ok) return 0;
  const data: { behind_by?: number } = await res.json();
  return data.behind_by ?? 0;
}

export async function fetchBehindByCounts(
  token: string,
  owner: string,
  repo: string,
  prs: { number: number; baseRefName: string; headRefName: string }[],
  queryClient: { fetchQuery: (opts: { queryKey: unknown[]; queryFn: () => Promise<number>; staleTime: number }) => Promise<number> },
): Promise<Map<number, number>> {
  if (prs.length === 0) return new Map();

  const result = new Map<number, number>();
  const COMPARE_STALE_TIME = 5 * 60 * 1000;

  const settled = await Promise.allSettled(
    prs.map(async (pr) => {
      const behindBy = await queryClient.fetchQuery({
        queryKey: ["compare", owner, repo, pr.baseRefName, pr.headRefName],
        queryFn: () => fetchCompareBehindBy(token, owner, repo, pr.baseRefName, pr.headRefName),
        staleTime: COMPARE_STALE_TIME,
      });
      result.set(pr.number, behindBy);
    }),
  );

  for (const s of settled) {
    if (s.status === "rejected") {
      console.warn("Failed to fetch comparison:", s.reason);
    }
  }

  return result;
}

export async function fetchViewerLogin(token: string): Promise<string> {
  const data = await graphql<{ viewer: { login: string } }>(token, VIEWER_QUERY);
  return data.viewer?.login ?? "";
}

export async function fetchContributors(
  token: string,
  owner: string,
  repo: string,
): Promise<Contributor[]> {
  const contributors: Contributor[] = [];
  let page = 1;

  while (true) {
    const res = await fetchWithAuth(
      token,
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message ?? `GitHub API returned ${res.status}`);
    }

    const data: { login?: string; avatar_url?: string; type?: string }[] =
      await res.json();

    for (const c of data) {
      if (c.login && c.type !== "Bot") {
        contributors.push({ login: c.login, avatarUrl: c.avatar_url ?? "" });
      }
    }

    const link = res.headers.get("Link") ?? "";
    if (!link.includes('rel="next"')) break;
    page++;
  }

  return contributors;
}

interface PRPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface PRNodeRaw {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: string | null;
  author: { login: string; avatarUrl: string } | null;
  labels: { nodes: ({ name: string } | null)[] | null } | null;
  latestReviews: {
    nodes:
      | ({
          state: string;
          author: { login: string; avatarUrl: string } | null;
          comments: { totalCount: number } | null;
        } | null)[]
      | null;
  } | null;
  reviewRequests: {
    nodes:
      | ({
          requestedReviewer: { login?: string; avatarUrl?: string } | null;
        } | null)[]
      | null;
  } | null;
  comments: { totalCount: number } | null;
}

interface PRQueryData {
  repository: {
    pullRequests: {
      pageInfo: PRPageInfo;
      nodes: (PRNodeRaw | null)[];
    };
  };
}

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 5;

export async function fetchOpenPRs(
  token: string,
  owner: string,
  repo: string,
  cursor?: string | null,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PRPageResult> {
  let currentSize = pageSize;

  while (currentSize >= MIN_PAGE_SIZE) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const data: PRQueryData = await graphql<PRQueryData>(
        token,
        PR_QUERY,
        { owner, name: repo, cursor: cursor ?? null, first: currentSize },
        controller.signal,
      );
      clearTimeout(timer);

      const prs: PRQueryData["repository"]["pullRequests"] | undefined =
        data.repository?.pullRequests;
      if (!prs?.nodes) return { prs: [], hasNextPage: false, endCursor: null, pageSize: currentSize };

      return processPage(prs, currentSize);
    } catch (err) {
      clearTimeout(timer);
      const isTimeout =
        err instanceof DOMException && err.name === "AbortError";
      if (isTimeout && currentSize > MIN_PAGE_SIZE) {
        currentSize = Math.max(Math.floor(currentSize / 2), MIN_PAGE_SIZE);
        continue;
      }
      throw err;
    }
  }

  throw new Error("Request timed out even at minimum page size");
}

function processRawPR(pr: PRNodeRaw): GraphQLPullRequest {
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
    if (!reviewer?.login) continue;
    if (!reviewerMap.has(reviewer.login)) {
      reviewerMap.set(reviewer.login, {
        login: reviewer.login,
        avatarUrl: reviewer.avatarUrl ?? "",
        state: "REQUESTED",
      });
    }
  }

  return {
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
      .filter(
        (l: { name?: string } | null): l is { name: string } => !!l?.name,
      )
      .map((l: { name: string }) => l.name),
    reviewers: [...reviewerMap.values()],
    commentCount: (pr.comments?.totalCount ?? 0) + reviewCommentCount,
    mergeable: pr.mergeable ?? "UNKNOWN",
    mergeStateStatus: pr.mergeStateStatus ?? "UNKNOWN",
    reviewDecision: (pr.reviewDecision as ReviewDecision) ?? null,
  };
}

function processPage(
  prs: PRQueryData["repository"]["pullRequests"],
  pageSize: number,
): PRPageResult {
  const result: GraphQLPullRequest[] = [];
  for (const pr of prs.nodes) {
    if (!pr) continue;
    result.push(processRawPR(pr));
  }
  return {
    prs: result,
    hasNextPage: prs.pageInfo.hasNextPage,
    endCursor: prs.pageInfo.endCursor ?? null,
    pageSize,
  };
}

const SEARCH_PR_QUERY = `
query($query: String!, $cursor: String, $first: Int!) {
  search(query: $query, type: ISSUE, first: $first, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt additions deletions
        headRefName baseRefName mergeable mergeStateStatus reviewDecision
        author { login avatarUrl }
        labels(first: 20) { nodes { name } }
        latestReviews(first: 100) {
          nodes {
            state
            author { login avatarUrl }
            comments { totalCount }
          }
        }
        reviewRequests(first: 100) {
          nodes {
            requestedReviewer {
              ... on User { login avatarUrl }
            }
          }
        }
        comments { totalCount }
      }
    }
  }
}`;

interface SearchQueryData {
  search: {
    pageInfo: PRPageInfo;
    nodes: (PRNodeRaw | null)[];
  };
}

export async function fetchPRsByDateRange(
  token: string,
  owner: string,
  repo: string,
  startDate: string,
  endDate: string,
  onPage?: (accumulated: GraphQLPullRequest[]) => void,
  signal?: AbortSignal,
): Promise<GraphQLPullRequest[]> {
  const searchQuery = `repo:${owner}/${repo} is:pr is:open created:${startDate}..${endDate}`;
  const all: GraphQLPullRequest[] = [];
  let cursor: string | null = null;

  while (true) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const result: SearchQueryData = await graphql<SearchQueryData>(
      token,
      SEARCH_PR_QUERY,
      { query: searchQuery, cursor, first: 50 },
      signal,
    );

    const search = result.search;
    if (!search?.nodes) break;

    for (const pr of search.nodes) {
      if (!pr) continue;
      all.push(processRawPR(pr));
    }

    onPage?.([...all]);

    if (!search.pageInfo.hasNextPage) break;
    cursor = search.pageInfo.endCursor;
  }

  return all;
}

interface RawUserRepo {
  name: string;
  full_name: string;
  private: boolean;
  pushed_at?: string | null;
  owner?: { login?: string; type?: string } | null;
}

// Cap repo discovery to keep the dropdown snappy; an OAuth-App user with
// access to thousands of repos can still find any one of them via the
// free-text owner/repo input. Sorted by `pushed` server-side so the most
// active repos surface first.
const USER_REPOS_PAGE_LIMIT = 10;

export async function fetchUserRepos(token: string): Promise<UserRepo[]> {
  const repos: UserRepo[] = [];
  let page = 1;

  while (page <= USER_REPOS_PAGE_LIMIT) {
    const res = await fetchWithAuth(
      token,
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        body?.message ?? `Failed to fetch repositories (HTTP ${res.status}).`,
      );
    }

    const data: RawUserRepo[] = await res.json();
    for (const r of data) {
      const owner = r.owner?.login ?? r.full_name.split("/")[0] ?? "";
      const ownerType =
        r.owner?.type === "Organization" ? "Organization" : "User";
      repos.push({
        owner,
        repo: r.name,
        fullName: r.full_name,
        isPrivate: r.private,
        ownerType,
        pushedAt: r.pushed_at ?? null,
      });
    }

    const link = res.headers.get("Link") ?? "";
    if (!link.includes('rel="next"')) break;
    page++;
  }

  return repos;
}
