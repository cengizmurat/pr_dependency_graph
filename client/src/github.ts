export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "REQUESTED";

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export interface Reviewer {
  login: string;
  avatarUrl: string;
  state: ReviewState;
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

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
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: ReviewDecision;
}

const GITHUB_GRAPHQL = "https://api.github.com/graphql";

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
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
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
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/merge`,
    {
      method: "PUT",
      headers: {
        Authorization: `bearer ${token}`,
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
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `bearer ${token}`,
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
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/update-branch`,
    {
      method: "PUT",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Branch update failed with status ${res.status}`);
  }
}

export interface CascadeResult {
  merged: number;
  updated: { number: number; title: string }[];
  errors: { number: number; message: string }[];
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

export async function fetchViewerLogin(token: string): Promise<string> {
  const data = await graphql<{ viewer: { login: string } }>(token, VIEWER_QUERY);
  return data.viewer?.login ?? "";
}

export interface Contributor {
  login: string;
  avatarUrl: string;
}

export async function fetchContributors(
  token: string,
  owner: string,
  repo: string,
): Promise<Contributor[]> {
  const contributors: Contributor[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `bearer ${token}`,
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

export interface PRPageResult {
  prs: GraphQLPullRequest[];
  hasNextPage: boolean;
  endCursor: string | null;
  pageSize: number;
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

function processRawPR(pr: PRNodeRaw): GraphQLPullRequest | null {
  if (pr.mergeable === "UNKNOWN" && pr.mergeStateStatus === "UNKNOWN")
    return null;

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
    const processed = processRawPR(pr);
    if (processed) result.push(processed);
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
): Promise<GraphQLPullRequest[]> {
  const searchQuery = `repo:${owner}/${repo} is:pr is:open created:${startDate}..${endDate}`;
  const all: GraphQLPullRequest[] = [];
  let cursor: string | null = null;

  while (true) {
    const result: SearchQueryData = await graphql<SearchQueryData>(
      token,
      SEARCH_PR_QUERY,
      { query: searchQuery, cursor, first: 50 },
    );

    const search = result.search;
    if (!search?.nodes) break;

    for (const pr of search.nodes) {
      if (!pr) continue;
      const processed = processRawPR(pr);
      if (processed) all.push(processed);
    }

    if (!search.pageInfo.hasNextPage) break;
    cursor = search.pageInfo.endCursor;
  }

  return all;
}
