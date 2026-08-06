import type {
  ReviewState,
  Mergeable,
  Reviewer,
  ReviewDecision,
  GraphQLPullRequest,
  CascadeResult,
  PRPageResult,
  StackDetail,
  Contributor,
  UserRepo,
  WorkflowJob,
  WorkflowRunInfo,
  WorkflowRunsPage,
  WorkflowsPage,
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

// Stacked-PR membership. `stack` and `stackEntry` are the read-only fields
// GitHub added to PullRequest with stacked pull requests; a PR that isn't in a
// stack returns null for both.
const STACK_FIELDS = `
        stackEntry { position }
        stack { number size }`;

// Stacked PRs are still a public preview, so the fields are absent from the
// schema wherever the feature isn't enabled — and an unknown field fails the
// whole query, not just that selection. The first such failure drops the
// fields for the rest of the session and every request retries without them.
let stackFieldsSupported = true;

function isUnknownStackFieldError(message: string): boolean {
  const m = message.toLowerCase();
  if (!m.includes("stack")) return false;
  return (
    m.includes("doesn't exist on type") ||
    m.includes("does not exist on type") ||
    m.includes("cannot query field")
  );
}

const prQuery = (stackFields: string) => `
query($owner: String!, $name: String!, $cursor: String, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt additions deletions
        headRefName baseRefName mergeable mergeStateStatus reviewDecision
        author { login avatarUrl }
        labels(first: 20) { nodes { name color } }
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
        comments { totalCount }${stackFields}
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

// Runs a query that asks for the stacked-PR fields, retrying once without them
// if this repository's schema doesn't have them yet. `buildQuery` receives the
// stack selection set to splice in, or an empty string.
async function graphqlWithStack<T>(
  token: string,
  buildQuery: (stackFields: string) => string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (stackFieldsSupported) {
    try {
      return await graphql<T>(token, buildQuery(STACK_FIELDS), variables, signal);
    } catch (err) {
      if (!isUnknownStackFieldError((err as Error).message ?? "")) throw err;
      stackFieldsSupported = false;
    }
  }
  return graphql<T>(token, buildQuery(""), variables, signal);
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

interface RawStack {
  number: number;
  base?: { ref?: string } | null;
  pull_requests?:
    | ({
        number: number;
        state?: string;
        draft?: boolean;
        merged_at?: string | null;
      } | null)[]
    | null;
}

// The stack containing a pull request, from the Stacks REST API. GraphQL can
// only report a PR's own position, so the ordered membership has to come from
// REST. Returns null when the PR isn't stacked, when stacks aren't enabled for
// the repository (404), or when the lookup fails — every caller has a
// non-stacked path to fall back to, so a failure here degrades rather than
// blocking the action.
export async function fetchStackForPR(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<StackDetail | null> {
  try {
    const res = await fetchWithAuth(
      token,
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stacks?pull_request=${pullNumber}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;

    const data: RawStack[] = await res.json();
    const stack = data[0];
    if (!stack) return null;

    return {
      number: stack.number,
      baseRef: stack.base?.ref ?? "",
      pullRequests: (stack.pull_requests ?? [])
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
          number: p.number,
          state: p.state ?? "open",
          isDraft: p.draft ?? false,
          mergedAt: p.merged_at ?? null,
        })),
    };
  } catch {
    return null;
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
  labels: { nodes: ({ name: string; color: string } | null)[] | null } | null;
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
  // Absent entirely when the stack fields aren't in the schema, null when the
  // PR simply isn't stacked.
  stackEntry?: { position: number } | null;
  stack?: { number: number; size: number } | null;
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
      const data: PRQueryData = await graphqlWithStack<PRQueryData>(
        token,
        prQuery,
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
        (l: { name?: string; color?: string } | null): l is { name: string; color: string } =>
          !!l?.name,
      )
      .map((l: { name: string; color: string }) => ({
        name: l.name,
        color: l.color ?? "8b949e",
      })),
    reviewers: [...reviewerMap.values()],
    commentCount: (pr.comments?.totalCount ?? 0) + reviewCommentCount,
    mergeable: pr.mergeable ?? "UNKNOWN",
    mergeStateStatus: pr.mergeStateStatus ?? "UNKNOWN",
    reviewDecision: (pr.reviewDecision as ReviewDecision) ?? null,
    // Both halves are needed to render "position/size", so a PR only counts as
    // stacked when GitHub returned the stack and this PR's entry in it.
    stack:
      pr.stack && pr.stackEntry
        ? {
            number: pr.stack.number,
            position: pr.stackEntry.position,
            size: pr.stack.size,
          }
        : null,
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

const searchPRQuery = (stackFields: string) => `
query($query: String!, $cursor: String, $first: Int!) {
  search(query: $query, type: ISSUE, first: $first, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt additions deletions
        headRefName baseRefName mergeable mergeStateStatus reviewDecision
        author { login avatarUrl }
        labels(first: 20) { nodes { name color } }
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
        comments { totalCount }${stackFields}
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

    const result: SearchQueryData = await graphqlWithStack<SearchQueryData>(
      token,
      searchPRQuery,
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

// --- GitHub Actions (workflows / runs / jobs) ---

interface RawWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
  html_url: string;
}

interface RawWorkflowRun {
  id: number;
  run_number: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  head_branch: string | null;
  display_title?: string;
  name?: string | null;
  actor?: { login?: string; avatar_url?: string } | null;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  html_url: string;
}

interface RawWorkflowStep {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

interface RawWorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string | null;
  steps?: RawWorkflowStep[] | null;
}

async function fetchRestJson<T>(token: string, url: string): Promise<T> {
  const res = await fetchWithAuth(token, url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `GitHub API returned ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function processRawRun(run: RawWorkflowRun): WorkflowRunInfo {
  return {
    id: run.id,
    runNumber: run.run_number,
    event: run.event,
    status: run.status ?? "completed",
    conclusion: run.conclusion,
    headBranch: run.head_branch,
    displayTitle: run.display_title ?? run.name ?? `Run #${run.run_number}`,
    actorLogin: run.actor?.login ?? "",
    actorAvatarUrl: run.actor?.avatar_url ?? "",
    createdAt: run.created_at,
    runStartedAt: run.run_started_at ?? run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

// Both list endpoints report a total_count, so a page knows whether more
// batches exist without an extra request. The batch-length guard keeps a
// misreported total from ever promising a next page that would come back
// empty.
export async function fetchWorkflows(
  token: string,
  owner: string,
  repo: string,
  page: number,
  perPage: number,
): Promise<WorkflowsPage> {
  const data = await fetchRestJson<{
    total_count?: number;
    workflows?: RawWorkflow[] | null;
  }>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows?per_page=${perPage}&page=${page}`,
  );

  const batch = data.workflows ?? [];
  return {
    workflows: batch.map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
      htmlUrl: w.html_url,
    })),
    hasMore: batch.length > 0 && page * perPage < (data.total_count ?? 0),
  };
}

export async function fetchWorkflowRuns(
  token: string,
  owner: string,
  repo: string,
  workflowId: number,
  page: number,
  perPage: number,
): Promise<WorkflowRunsPage> {
  const data = await fetchRestJson<{
    total_count?: number;
    workflow_runs?: RawWorkflowRun[] | null;
  }>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowId}/runs?per_page=${perPage}&page=${page}`,
  );

  const batch = data.workflow_runs ?? [];
  return {
    runs: batch.map(processRawRun),
    hasMore: batch.length > 0 && page * perPage < (data.total_count ?? 0),
  };
}

export async function fetchWorkflowRun(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<WorkflowRunInfo> {
  const data = await fetchRestJson<RawWorkflowRun>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}`,
  );
  return processRawRun(data);
}

export async function fetchWorkflowRunJobs(
  token: string,
  owner: string,
  repo: string,
  runId: number,
): Promise<WorkflowJob[]> {
  const jobs: WorkflowJob[] = [];
  let page = 1;

  while (true) {
    const data = await fetchRestJson<{ jobs?: RawWorkflowJob[] | null }>(
      token,
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`,
    );

    const batch = data.jobs ?? [];
    for (const j of batch) {
      jobs.push({
        id: j.id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        createdAt: j.created_at ?? null,
        startedAt: j.started_at ?? null,
        completedAt: j.completed_at ?? null,
        htmlUrl: j.html_url ?? null,
        steps: (j.steps ?? []).map((s) => ({
          name: s.name,
          number: s.number,
          status: s.status,
          conclusion: s.conclusion,
          startedAt: s.started_at ?? null,
          completedAt: s.completed_at ?? null,
        })),
      });
    }

    if (batch.length < 100) break;
    page++;
  }

  return jobs;
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
