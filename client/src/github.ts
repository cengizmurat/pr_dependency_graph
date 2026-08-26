import type {
  ReviewState,
  Mergeable,
  Reviewer,
  ReviewDecision,
  GraphQLPullRequest,
  CascadeResult,
  PRPageResult,
  Contributor,
  PullRequestSummary,
  UserRepo,
  WorkflowJob,
  WorkflowRunInfo,
  WorkflowRunsPage,
  WorkflowsPage,
  BranchList,
  CommitFile,
  CommitHistoryPage,
  RepoTreeDirs,
  RateLimitStatus,
} from "./types";
import { REVIEW_STATE_PRIORITY } from "./types";
import { getToken } from "./auth";
import { isBotActor } from "./bots";

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

// When the PR last became a draft or became ready for review. Asking for the
// last of those two timeline events gives the moment the PR entered the state
// it is in now; a PR that never switched has none, and falls back to its
// creation time.
const STATE_CHANGE_FIELDS = `
        timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
          nodes {
            ... on ReadyForReviewEvent { createdAt }
            ... on ConvertToDraftEvent { createdAt }
          }
        }`;

// Each reviewer's current review state takes two connections to pin down.
// `latestReviews` is the newest review per reviewer whatever its state, so a
// reviewer who approves and then drops a comment comes back COMMENTED and the
// approval vanishes. `latestOpinionatedReviews` is the newest APPROVED or
// CHANGES_REQUESTED review per reviewer that GitHub still counts — a dismissed
// verdict is absent from it, which is what keeps a dismissal from being undone
// here. Merging the two by REVIEW_STATE_PRIORITY gives the state that survives.
// A review's author is an Actor, so `__typename` says whether a GitHub App or
// a person left it — the only reliable way to tell, since an App's login is not
// always suffixed. `requestedReviewer` asks for Bot as well as User, so a review
// request sitting with an App is visible too rather than silently dropped.
const REVIEW_FIELDS = `
        latestReviews(first: 100) {
          nodes {
            state
            author { __typename login avatarUrl }
            comments { totalCount }
          }
        }
        latestOpinionatedReviews(first: 100) {
          nodes {
            state
            author { __typename login avatarUrl }
          }
        }
        reviewRequests(first: 100) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login avatarUrl }
              ... on Bot { login avatarUrl }
            }
          }
        }`;

const prQuery = (stackFields: string) => `
query($owner: String!, $name: String!, $cursor: String, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: $first, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url isDraft createdAt additions deletions
        headRefName baseRefName mergeable mergeStateStatus reviewDecision
        author { login avatarUrl }
        labels(first: 20) { nodes { name color } }${REVIEW_FIELDS}
        comments { totalCount }${STATE_CHANGE_FIELDS}${stackFields}
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

const PR_SUMMARY_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { number title url createdAt state }
  }
}`;

// Looks a single PR up by number. Used when a shared link points at a PR the
// graph didn't load, to tell "opened before the date range" apart from "closed"
// and "no such PR". A missing PR comes back as null rather than an error, since
// a hand-typed number being wrong is an ordinary outcome here.
export async function fetchPullRequestSummary(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestSummary | null> {
  try {
    const data = await graphql<{
      repository: { pullRequest: PullRequestSummary | null } | null;
    }>(token, PR_SUMMARY_QUERY, { owner, name: repo, number });
    return data.repository?.pullRequest ?? null;
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (/could not resolve to a pullrequest/i.test(message)) return null;
    throw err;
  }
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

interface RawReview {
  state: string;
  author: { __typename?: string; login: string; avatarUrl: string } | null;
  // Only selected on `latestReviews`; the opinionated pass leaves it out so the
  // same review is not counted twice.
  comments?: { totalCount: number } | null;
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
  latestReviews: { nodes: (RawReview | null)[] | null } | null;
  // The APPROVED / CHANGES_REQUESTED review each reviewer still stands behind,
  // which `latestReviews` loses as soon as they say anything after it.
  latestOpinionatedReviews: { nodes: (RawReview | null)[] | null } | null;
  reviewRequests: {
    nodes:
      | ({
          requestedReviewer: {
            __typename?: string;
            login?: string;
            avatarUrl?: string;
          } | null;
        } | null)[]
      | null;
  } | null;
  comments: { totalCount: number } | null;
  // At most one node: the PR's latest draft/ready switch, or none at all when
  // it has stayed in the state it was opened in.
  timelineItems: { nodes: ({ createdAt?: string } | null)[] | null } | null;
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

// The timestamp of the PR's latest draft/ready switch, or its creation time
// when it never switched.
function stateChangedAt(pr: PRNodeRaw): string {
  const events = pr.timelineItems?.nodes ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const at = events[i]?.createdAt;
    if (at) return at;
  }
  return pr.createdAt;
}

const REVIEW_STATE_RANK: ReadonlyMap<ReviewState, number> = new Map(
  REVIEW_STATE_PRIORITY.map((state, i) => [state, i] as const),
);

// The stronger of two states for the same reviewer, by REVIEW_STATE_PRIORITY.
// An unrecognised state ranks last so a future GitHub state never outranks one
// we do understand.
function strongerReviewState(a: ReviewState, b: ReviewState): ReviewState {
  const rankA = REVIEW_STATE_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
  const rankB = REVIEW_STATE_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
  return rankA <= rankB ? a : b;
}

function processRawPR(pr: PRNodeRaw): GraphQLPullRequest {
  const reviewerMap = new Map<string, Reviewer>();
  let reviewCommentCount = 0;
  let botReviewCommentCount = 0;

  // Folds one review into the reviewer's running state. A reviewer shows up in
  // both review connections, so whichever review lands second only wins if it
  // is the stronger of the two.
  const recordReview = (review: RawReview | null): void => {
    const login = review?.author?.login;
    if (!login) return;
    const state = (review.state as ReviewState) ?? "COMMENTED";
    const existing = reviewerMap.get(login);
    reviewerMap.set(login, {
      login,
      avatarUrl: existing?.avatarUrl || review.author?.avatarUrl || "",
      state: existing ? strongerReviewState(existing.state, state) : state,
      isBot: isBotActor(review.author?.__typename, login),
    });
  };

  // Comment totals come off this pass alone — `latestOpinionatedReviews`
  // repeats reviews that are already here, and adding them would double-count.
  for (const review of pr.latestReviews?.nodes ?? []) {
    if (!review) continue;
    const comments = review.comments?.totalCount ?? 0;
    reviewCommentCount += comments;
    if (isBotActor(review.author?.__typename, review.author?.login)) {
      botReviewCommentCount += comments;
    }
    recordReview(review);
  }

  for (const review of pr.latestOpinionatedReviews?.nodes ?? []) {
    recordReview(review);
  }

  // REQUESTED is the weakest state, so a reviewer who has already reviewed
  // keeps that verdict even once they are asked for another look.
  for (const req of pr.reviewRequests?.nodes ?? []) {
    const reviewer = req?.requestedReviewer;
    if (!reviewer?.login) continue;
    if (!reviewerMap.has(reviewer.login)) {
      reviewerMap.set(reviewer.login, {
        login: reviewer.login,
        avatarUrl: reviewer.avatarUrl ?? "",
        state: "REQUESTED",
        isBot: isBotActor(reviewer.__typename, reviewer.login),
      });
    }
  }

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    stateChangedAt: stateChangedAt(pr),
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
    botCommentCount: botReviewCommentCount,
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
        labels(first: 20) { nodes { name color } }${REVIEW_FIELDS}
        comments { totalCount }${STATE_CHANGE_FIELDS}${stackFields}
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

// Every REST response states the budget it was charged against, so the readout
// can follow a long fetch request by request without spending anything on
// /rate_limit. GraphQL responses are deliberately not fed in here: they draw on
// a separate budget with the same header names, and mixing the two would make
// both numbers wrong.
let observedRateLimit: RateLimitStatus | null = null;
const rateLimitWatchers = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function noteRestRateLimit(res: Response): void {
  const limit = Number(res.headers.get("X-RateLimit-Limit"));
  const remaining = Number(res.headers.get("X-RateLimit-Remaining"));
  const reset = Number(res.headers.get("X-RateLimit-Reset"));
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) {
    return;
  }
  if (res.headers.get("X-RateLimit-Remaining") === null) return;

  const next: RateLimitStatus = { limit, remaining, resetAt: reset * 1000 };
  // Responses come back out of order under concurrency, so the freshest view
  // within one window is the one that has seen the most spent, not the one
  // that arrived last.
  if (
    observedRateLimit &&
    observedRateLimit.resetAt === next.resetAt &&
    observedRateLimit.remaining <= next.remaining
  ) {
    return;
  }
  observedRateLimit = next;

  // Eight requests a second would otherwise be eight re-renders a second, for
  // a number that only has to look live.
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const watcher of rateLimitWatchers) watcher();
  }, 500);
}

export function getObservedRateLimit(): RateLimitStatus | null {
  return observedRateLimit;
}

export function subscribeRateLimit(watcher: () => void): () => void {
  rateLimitWatchers.add(watcher);
  return () => {
    rateLimitWatchers.delete(watcher);
  };
}

async function fetchRestJson<T>(token: string, url: string): Promise<T> {
  const res = await fetchWithAuth(token, url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  noteRestRateLimit(res);

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

// --- Folder churn ---------------------------------------------------------

// The branch selector lists this many branches at most. A repository with
// more is reported as truncated; the default branch is fetched separately so
// it is always offered even when it sorts past the cut.
const BRANCH_PAGE_LIMIT = 5;

const BRANCHES_QUERY = `
query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    refs(refPrefix: "refs/heads/", first: 100, after: $cursor, orderBy: { field: ALPHABETICAL, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { name }
    }
  }
}`;

interface BranchesQueryResult {
  repository: {
    defaultBranchRef: { name: string } | null;
    refs: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: { name: string }[];
    };
  } | null;
}

export async function fetchBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<BranchList> {
  const names: string[] = [];
  let defaultBranch: string | null = null;
  let cursor: string | null = null;
  let truncated = false;

  for (let page = 0; page < BRANCH_PAGE_LIMIT; page++) {
    const data: BranchesQueryResult = await graphql<BranchesQueryResult>(
      token,
      BRANCHES_QUERY,
      { owner, name: repo, cursor },
    );

    const repository = data.repository;
    if (!repository) throw new Error(`Repository ${owner}/${repo} not found.`);

    defaultBranch = repository.defaultBranchRef?.name ?? defaultBranch;
    for (const node of repository.refs.nodes) names.push(node.name);

    if (!repository.refs.pageInfo.hasNextPage) break;
    cursor = repository.refs.pageInfo.endCursor;
    if (page === BRANCH_PAGE_LIMIT - 1) truncated = true;
  }

  if (defaultBranch && !names.includes(defaultBranch)) names.unshift(defaultBranch);

  return { names, defaultBranch, truncated };
}

// Commit metadata for a branch, oldest-relevant filtering done server-side by
// `since`/`until`. `totalCount` is the whole reason this pass is a separate
// (and cheap) one: it says exactly how many commits a window holds before the
// expensive per-commit file fetch starts, so the size of the job can be shown
// rather than discovered.
const HISTORY_QUERY = `
query($owner: String!, $name: String!, $branch: String!, $cursor: String, $since: GitTimestamp, $until: GitTimestamp, $path: String) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $branch) {
      target {
        ... on Commit {
          history(first: 100, after: $cursor, since: $since, until: $until, path: $path) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              oid
              committedDate
              parents(first: 2) { totalCount }
            }
          }
        }
      }
    }
  }
}`;

export async function fetchCommitHistoryPage(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  cursor: string | null,
  since: string | null,
  until: string | null,
  // Repository-relative directory to restrict the history to, or null for the
  // whole repository. Scoping the query is what keeps drilling into a folder
  // from costing a request per commit in the rest of the repository.
  //
  // The filter carries git's own path-filtering semantics, which simplify
  // history rather than walking every ancestor: on a merge that is TREESAME to
  // one parent, git follows only that parent. A merge-heavy history can
  // therefore report slightly fewer commits for a path here than
  // `git log --full-history` would. Both agree on ordinary histories, and the
  // scoped view is self-consistent either way.
  path: string | null,
  signal?: AbortSignal,
): Promise<CommitHistoryPage> {
  const data = await graphql<{
    repository: {
      ref: {
        target: {
          history?: {
            totalCount: number;
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: {
              oid: string;
              committedDate: string;
              parents: { totalCount: number };
            }[];
          };
        } | null;
      } | null;
    } | null;
  }>(
    token,
    HISTORY_QUERY,
    { owner, name: repo, branch, cursor, since, until, path },
    signal,
  );

  const repository = data.repository;
  if (!repository) throw new Error(`Repository ${owner}/${repo} not found.`);
  if (!repository.ref) throw new Error(`Branch "${branch}" not found.`);

  const history = repository.ref.target?.history;
  // A ref pointing at a tag or tree object has no history to read.
  if (!history) throw new Error(`Branch "${branch}" has no commit history.`);

  return {
    commits: history.nodes.map((n) => ({
      sha: n.oid,
      committedDate: n.committedDate,
      isMerge: n.parents.totalCount > 1,
    })),
    totalCount: history.totalCount,
    hasNextPage: history.pageInfo.hasNextPage,
    endCursor: history.pageInfo.endCursor,
  };
}

interface RawCommitFile {
  filename: string;
  status?: string;
  previous_filename?: string;
  changes?: number;
  additions?: number;
  deletions?: number;
}

// GitHub returns at most 300 files per page and stops paginating a commit
// after this many pages. A commit touching more paths than that is rare
// enough that the cut is worth the bounded request count.
const COMMIT_FILES_PAGE_LIMIT = 10;

// GitHub says "API rate limit exceeded for ..." when the hourly budget is
// gone, and "You have exceeded a secondary rate limit" when a burst tripped
// the short-term one. Only the first is worth stopping for.
function isPrimaryRateLimitMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const m = message.toLowerCase();
  return m.includes("rate limit exceeded") && !m.includes("secondary");
}

// The one thing the GraphQL API cannot answer: which paths a commit touched.
// The `Commit` object exposes additions, deletions and a changed-file *count*,
// but no diff and no file connection, so the per-commit file list has to come
// from REST — one request per commit.
//
// GitHub applies rename detection and reports a moved file once, as
// `renamed` with a `previous_filename`. Folder churn wants the opposite (a
// move is a modification of the folder it left as well as the one it joined),
// so a rename is split back into both paths here — the equivalent of
// `git --no-renames`. The line count stays on the destination: GitHub reports
// a pure rename as a zero-line change and the original file's size is not in
// the response, so it cannot be attributed to the source folder.
export async function fetchCommitFiles(
  token: string,
  owner: string,
  repo: string,
  sha: string,
  signal?: AbortSignal,
): Promise<CommitFile[]> {
  const files: CommitFile[] = [];

  for (let page = 1; page <= COMMIT_FILES_PAGE_LIMIT; page++) {
    const res = await fetchWithAuth(
      token,
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${sha}?per_page=300&page=${page}`,
      { headers: { Accept: "application/vnd.github+json" }, signal },
    );

    noteRestRateLimit(res);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const error = new Error(
        body?.message ?? `GitHub API returned ${res.status}`,
      ) as Error & {
        status?: number;
        retryAfter?: number;
        rateLimited?: boolean;
      };
      error.status = res.status;
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter) error.retryAfter = parseInt(retryAfter, 10);
      // A spent hourly budget is not something backing off can recover from
      // inside a session — the window can be an hour away — while a tripped
      // secondary limit clears in seconds. Telling them apart decides between
      // stopping and retrying, so it is read from the message as well as the
      // header: a proxy that drops the header would otherwise leave the
      // client retrying into a wall it cannot clear.
      error.rateLimited =
        res.headers.get("X-RateLimit-Remaining") === "0" ||
        isPrimaryRateLimitMessage(body?.message);
      throw error;
    }

    const data: { files?: RawCommitFile[] | null } = await res.json();
    const batch = data.files ?? [];

    for (const f of batch) {
      const changes =
        f.changes ?? (f.additions ?? 0) + (f.deletions ?? 0);
      files.push({ path: f.filename, changes });
      if (f.status === "renamed" && f.previous_filename) {
        files.push({ path: f.previous_filename, changes: 0 });
      }
    }

    if (batch.length < 300) break;
  }

  return files;
}

// Every directory present at a branch tip, from one recursive tree request.
// Directories are read off blob paths as well as tree entries so the set is
// right even if GitHub elides an entry.
export async function fetchRepoTreeDirs(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<RepoTreeDirs> {
  const data = await fetchRestJson<{
    tree?: { path: string; type: string }[] | null;
    truncated?: boolean;
  }>(
    token,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );

  const dirs = new Set<string>([""]);
  for (const entry of data.tree ?? []) {
    const path = entry.type === "tree" ? entry.path : dirname(entry.path);
    for (let p = path; p !== ""; p = dirname(p)) dirs.add(p);
  }

  return { dirs, truncated: data.truncated === true };
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// What is left of the hourly REST budget. This endpoint is free — GitHub
// documents it as not counting against the limit — so it can be asked before
// every fetch to weigh the cost of an interval against what remains.
export async function fetchRateLimit(token: string): Promise<RateLimitStatus> {
  const data = await fetchRestJson<{
    resources?: { core?: { limit?: number; remaining?: number; reset?: number } };
  }>(token, "https://api.github.com/rate_limit");

  const core = data.resources?.core;
  return {
    limit: core?.limit ?? 5000,
    remaining: core?.remaining ?? 5000,
    resetAt: (core?.reset ?? Math.floor(Date.now() / 1000) + 3600) * 1000,
  };
}
