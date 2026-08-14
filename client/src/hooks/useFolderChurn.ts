import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCommitFiles,
  fetchCommitHistoryPage,
  fetchRateLimit,
  fetchRepoTreeDirs,
  getObservedRateLimit,
  subscribeRateLimit,
} from "../api";
import type { HistoryCommit, RateLimitStatus } from "../types";
import { DirIntern, dayFromIso, entriesFromFiles } from "../folderChurn";
import type { ChurnCommit } from "../folderChurn";
import { loadChurnCache, saveChurnCache } from "../churnCache";
import {
  CHURN_CONCURRENCY,
  CHURN_HISTORY_PAGE_LIMIT,
  CHURN_MAX_RETRIES,
  CHURN_PROGRESS_MS,
  CHURN_RATE_LIMIT_HEADROOM,
  CHURN_SAVE_EVERY,
} from "../constants";

// The interned directory table and the per-commit records are per repository,
// not per branch, folder or window: a commit's diff is the same whichever
// query reached it, and directory indices have to stay stable for records
// loaded from the cache to keep meaning what they meant. One store per
// repository is kept for the life of the session, seeded from the persistent
// cache on first use, and every commit ever fetched stays in it.
interface RepoStore {
  intern: DirIntern;
  commits: Map<string, ChurnCommit>;
  // Commits fetched since the last checkpoint, so a save writes only the delta.
  unsaved: ChurnCommit[];
}

const stores = new Map<string, Promise<RepoStore>>();

function getStore(owner: string, repo: string): Promise<RepoStore> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  let store = stores.get(key);
  if (!store) {
    store = loadChurnCache(owner, repo).then((cached) => ({
      intern: new DirIntern(cached.dirs),
      commits: cached.commits,
      unsaved: [],
    }));
    stores.set(key, store);
  }
  return store;
}

async function checkpoint(owner: string, repo: string): Promise<void> {
  const store = await getStore(owner, repo);
  if (store.unsaved.length === 0) return;
  const added = store.unsaved;
  store.unsaved = [];
  await saveChurnCache(owner, repo, {
    dirs: store.intern.dirs,
    all: store.commits,
    added,
  });
}

export interface ChurnData {
  dirs: string[];
  commits: ChurnCommit[];
  resolved: number;
  needed: number;
  // Resolved without a request, because a previous fetch already read them.
  fromCache: number;
  mergesSkipped: number;
  // The hourly budget ran out partway through. Whatever arrived before that is
  // still charted; the rest needs the window to reset.
  rateLimited: boolean;
  // Commits whose file list could not be read, for reasons other than the
  // rate limit. One bad commit does not stop the rest.
  failed: number;
}

// What one press of the fetch button would cost, worked out before it is
// pressed.
export interface ChurnEstimate {
  // Commits the window holds, merges included — what GitHub's history reports.
  totalCommits: number;
  // The same window with merges dropped: the commits that actually carry file
  // changes, and so the number the rest of the tab is about. Null until the
  // background pass has walked the list.
  commits: number | null;
  // Commits whose file lists still have to be read. Null while the background
  // pass has not resolved it, in which case only the total is known.
  toFetch: number | null;
  // Commits already in the cache and free to reuse.
  cached: number | null;
}

function isAbort(err: unknown): boolean {
  return (err as Error)?.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

// GitHub answers a tripped *secondary* rate limit with 403 or 429 and often a
// Retry-After; backing off and retrying is what lets a large window finish. A
// spent *primary* budget is different — the window can be an hour away — so it
// is raised immediately for the caller to stop on.
async function fetchFilesWithRetry(
  token: string,
  owner: string,
  repo: string,
  sha: string,
  signal: AbortSignal,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchCommitFiles(token, owner, repo, sha, signal);
    } catch (err) {
      const { status, rateLimited, retryAfter } = err as {
        status?: number;
        rateLimited?: boolean;
        retryAfter?: number;
      };
      const retryable =
        !rateLimited &&
        (status === 403 || status === 429 || status === 502 || status === 503);
      if (isAbort(err) || !retryable || attempt >= CHURN_MAX_RETRIES) throw err;
      const delay = retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(delay, 60_000), signal);
    }
  }
}

// A fixed pool of workers pulling from one queue, rather than a batch at a
// time: a single slow commit then delays only its own slot instead of holding
// up the whole batch behind it. `shouldStop` lets a spent budget end the run
// without abandoning the commits already fetched.
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !shouldStop()) {
        await worker(items[next++]);
      }
    }),
  );
}

// Walks the history from a page already in hand. `maxPages` bounds the walk for
// the background estimate; the fetch itself passes Infinity.
async function pageHistory(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  since: string | null,
  until: string | null,
  path: string | null,
  first: { commits: HistoryCommit[]; hasNextPage: boolean; endCursor: string | null },
  maxPages: number,
  signal: AbortSignal,
): Promise<{ commits: HistoryCommit[]; complete: boolean }> {
  const commits = [...first.commits];
  let cursor = first.endCursor;
  let more = first.hasNextPage;
  let pages = 1;

  while (more) {
    if (pages >= maxPages) return { commits, complete: false };
    const page = await fetchCommitHistoryPage(
      token, owner, repo, branch, cursor, since, until, path, signal,
    );
    commits.push(...page.commits);
    cursor = page.endCursor;
    more = page.hasNextPage;
    pages++;
  }

  return { commits, complete: true };
}

// Two readings of the same budget are compared by window first: a later window
// means the budget has reset since. Within one window the further-along reading
// is the one that has seen more of it spent.
//
// The window is matched with a tolerance rather than exactly. The two readings
// are taken at different moments and GitHub reports the reset as whole seconds,
// so an exact comparison would let a stale reading with a reset one second
// later win over a fresh one — which is how a live counter silently stops
// moving.
const SAME_WINDOW_MS = 90_000;

function freshestRateLimit(
  a: RateLimitStatus | null,
  b: RateLimitStatus | null,
): RateLimitStatus | null {
  if (!a) return b;
  if (!b) return a;
  if (Math.abs(a.resetAt - b.resetAt) > SAME_WINDOW_MS) {
    return a.resetAt > b.resetAt ? a : b;
  }
  return a.remaining <= b.remaining ? a : b;
}

export function useFolderChurn({
  token,
  owner,
  repo,
  branch,
  since,
  until,
  path,
  active,
}: {
  token: string | null;
  owner: string;
  repo: string;
  branch: string | null;
  since: string | null;
  until: string | null;
  // Directory to scope the history to, or null for the whole repository.
  path: string | null;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const enabled = !!token && !!owner && !!repo && !!branch && active;

  // Everything that decides which commits a view needs. Changing any of it
  // re-sizes the job and re-arms the fetch button.
  const windowKey = `${owner}/${repo}@${branch}:${since ?? ""}..${until ?? ""}:${path ?? ""}`;
  const [startedKey, setStartedKey] = useState<string | null>(null);
  const start = useCallback(() => setStartedKey(windowKey), [windowKey]);

  // Whatever has been fetched is worth keeping even if the tab is closed or
  // the inputs changed mid-run, so a checkpoint is forced when the page goes
  // away rather than only every N commits.
  const checkpointRef = useRef<() => void>(() => {});
  checkpointRef.current = () => {
    if (owner && repo) void checkpoint(owner, repo);
  };
  useEffect(() => {
    const flush = () => checkpointRef.current();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, []);

  // Pass one, on every input change: how big is this job? The history's
  // totalCount comes back on the very first page, so one request sizes a
  // window — and when a folder is given, the history is scoped to it, so the
  // number is the commits that actually touched that folder rather than every
  // commit in the repository.
  const countQuery = useQuery({
    queryKey: ["churnCount", owner, repo, branch, since, until, path],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) =>
      fetchCommitHistoryPage(
        token!, owner, repo, branch!, null, since, until, path, signal,
      ),
  });

  // Pass two, in the background: the rest of the commit list, so the button can
  // say how many of them still need reading rather than only how many exist.
  // Bounded, because this runs without being asked.
  const estimateQuery = useQuery({
    queryKey: ["churnEstimate", owner, repo, branch, since, until, path],
    enabled: enabled && countQuery.data !== undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const first = countQuery.data!;
      const { commits, complete } = await pageHistory(
        token!, owner, repo, branch!, since, until, path,
        first, CHURN_HISTORY_PAGE_LIMIT, signal,
      );
      if (!complete) return { commits: null, toFetch: null, cached: null };
      const store = await getStore(owner, repo);
      const relevant = commits.filter((c) => !c.isMerge);
      const cached = relevant.filter((c) => store.commits.has(c.sha)).length;
      return { commits: relevant.length, toFetch: relevant.length - cached, cached };
    },
  });

  // What is left of the hourly budget. /rate_limit is free, so asking costs
  // nothing but tells the estimate whether the window actually fits.
  const rateLimitQuery = useQuery({
    queryKey: ["rateLimit", token],
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: () => fetchRateLimit(token!),
  });

  // Nothing here costs a request, so a window whose commits are all in the
  // cache opens without waiting to be asked. Anything that would spend the
  // budget waits for the button.
  const isFree = estimateQuery.data?.toFetch === 0;

  const dataQuery = useQuery({
    queryKey: ["churnData", owner, repo, branch, since, until, path],
    enabled:
      enabled &&
      countQuery.data !== undefined &&
      (startedKey === windowKey || isFree),
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ queryKey, signal }): Promise<ChurnData> => {
      const store = await getStore(owner, repo);
      const first = countQuery.data!;

      const { commits: history } = await pageHistory(
        token!, owner, repo, branch!, since, until, path,
        first, Infinity, signal,
      );

      // Merge commits drop out here. Their file changes are already
      // attributed to the commits they bring in, so counting both would
      // double every folder they pass through.
      const relevant = history.filter((c) => !c.isMerge);
      const mergesSkipped = history.length - relevant.length;

      const missing = relevant.filter((c) => !store.commits.has(c.sha));
      const fromCache = relevant.length - missing.length;
      let resolved = fromCache;
      let rateLimited = false;
      let failed = 0;

      const snapshot = (): ChurnData => ({
        dirs: [...store.intern.dirs],
        commits: relevant
          .map((c) => store.commits.get(c.sha))
          .filter((c): c is ChurnCommit => c !== undefined),
        resolved,
        needed: relevant.length,
        fromCache,
        mergesSkipped,
        rateLimited,
        failed,
      });

      if (missing.length === 0) return snapshot();

      // Whatever the cache already held is charted straight away, and the rest
      // is added to the same charts as it arrives.
      queryClient.setQueryData(queryKey, snapshot());

      let sinceSave = 0;
      // Publishing a snapshot copies the directory table and re-runs the whole
      // aggregation, so doing it once per commit would cost O(commits²) on a
      // large history. Throttling to a few frames a second keeps the charts
      // visibly growing without that.
      let lastPublish = 0;

      await runPool(
        missing,
        CHURN_CONCURRENCY,
        async (commit) => {
          try {
            const files = await fetchFilesWithRetry(
              token!, owner, repo, commit.sha, signal,
            );
            const record: ChurnCommit = {
              sha: commit.sha,
              day: dayFromIso(commit.committedDate),
              entries: entriesFromFiles(files, store.intern),
            };
            store.commits.set(commit.sha, record);
            store.unsaved.push(record);
            resolved++;
            sinceSave++;
          } catch (err) {
            if (isAbort(err)) throw err;
            if ((err as { rateLimited?: boolean }).rateLimited) {
              rateLimited = true;
              return;
            }
            // A commit GitHub will not describe (too large, or gone) should
            // not cost the rest of the window.
            failed++;
          }

          const now = Date.now();
          if (now - lastPublish >= CHURN_PROGRESS_MS) {
            lastPublish = now;
            queryClient.setQueryData(queryKey, snapshot());
          }
          if (sinceSave >= CHURN_SAVE_EVERY) {
            sinceSave = 0;
            void checkpoint(owner, repo);
          }
        },
        () => rateLimited,
      );

      await checkpoint(owner, repo);
      void rateLimitQuery.refetch();
      void estimateQuery.refetch();
      return snapshot();
    },
  });

  // The branch tip's directories, for telling folders that still exist from
  // ones that only live in the history.
  const treeQuery = useQuery({
    queryKey: ["churnTree", owner, repo, branch],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchRepoTreeDirs(token!, owner, repo, branch!),
  });

  const data = dataQuery.data ?? null;

  // Two views of the same budget: what /rate_limit last reported, and what the
  // headers on the fetch's own responses have seen since. The second is free
  // and moves with every commit read, so during a fetch it is the live one.
  const observed = useSyncExternalStore(
    subscribeRateLimit,
    getObservedRateLimit,
    () => null,
  );
  const rateLimit = freshestRateLimit(observed, rateLimitQuery.data ?? null);

  const estimate: ChurnEstimate | null =
    countQuery.data === undefined
      ? null
      : {
          totalCommits: countQuery.data.totalCount,
          commits: estimateQuery.data?.commits ?? null,
          toFetch: estimateQuery.data?.toFetch ?? null,
          cached: estimateQuery.data?.cached ?? null,
        };

  const isStreaming = dataQuery.isFetching && (!data || data.resolved < data.needed);

  // Requests this window needs, cache hits already deducted where they are
  // known. Deliberately the size of the whole job rather than what is left of
  // it, so a warning about the job does not evaporate halfway through.
  const requiredRequests = data
    ? data.needed - data.fromCache
    : (estimate?.toFetch ?? estimate?.totalCommits ?? null);

  // Is there anything left to read? True before the button is pressed and
  // while commits are still arriving, false once the window is complete.
  const hasOutstandingWork = !data || data.resolved < data.needed;

  // Headroom rather than the bare remainder, so the warning arrives while
  // choosing a narrower interval is still worth doing. It is shown from the
  // moment an input makes the job too big — before anything is fetched — and
  // stops once the window has been read, when it has been overtaken by events.
  const mayExceedRateLimit =
    requiredRequests !== null &&
    requiredRequests > 0 &&
    rateLimit !== null &&
    hasOutstandingWork &&
    requiredRequests > rateLimit.remaining * CHURN_RATE_LIMIT_HEADROOM;

  const error = countQuery.error ?? dataQuery.error;

  return {
    data,
    estimate,
    requiredRequests,
    rateLimit,
    mayExceedRateLimit,
    // True once this exact window has been asked for, or is free to open.
    started: startedKey === windowKey || isFree,
    start,
    // The tree is a nicety; failing to read it only costs the GONE badges.
    tipDirs: treeQuery.data && !treeQuery.data.truncated ? treeQuery.data.dirs : null,
    isCounting: countQuery.isLoading,
    isEstimating: estimateQuery.isFetching,
    isStreaming,
    error: error ? (error as Error).message : null,
    refetch: () => {
      countQuery.refetch();
      estimateQuery.refetch();
      dataQuery.refetch();
      rateLimitQuery.refetch();
    },
  };
}
