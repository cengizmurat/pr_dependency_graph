import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCommitFiles,
  fetchCommitHistoryPage,
  fetchRateLimit,
  fetchRepoTreeDirs,
} from "../api";
import type { HistoryCommit, RateLimitStatus } from "../types";
import { DirIntern, dayFromIso, entriesFromFiles } from "../folderChurn";
import type { ChurnCommit } from "../folderChurn";
import { loadChurnCache, saveChurnCache } from "../churnCache";
import {
  CHURN_CONCURRENCY,
  CHURN_MAX_RETRIES,
  CHURN_PROGRESS_MS,
  CHURN_RATE_LIMIT_HEADROOM,
  CHURN_SAVE_EVERY,
} from "../constants";

// The interned directory table and the per-commit records are per repository,
// not per branch or per window: a commit's diff is the same whichever branch
// reaches it, and directory indices have to stay stable for records loaded
// from the cache to keep meaning what they meant. One store per repository is
// kept for the life of the session, seeded from the persistent cache on first
// use, and every commit ever fetched stays in it.
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
  // File lists resolved so far, against the number the window needs.
  resolved: number;
  needed: number;
  // Resolved without a request, because a previous visit already fetched them.
  fromCache: number;
  mergesSkipped: number;
  // The hourly budget ran out partway through. Whatever arrived before that is
  // still charted; the rest needs the window to reset.
  rateLimited: boolean;
  // Commits whose file list could not be read, for reasons other than the
  // rate limit. One bad commit does not stop the rest.
  failed: number;
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
// up the whole batch behind it. `stop` lets a spent budget end the run without
// abandoning the commits already fetched.
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

async function fetchHistory(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  since: string | null,
  until: string | null,
  firstPage: HistoryCommit[],
  firstCursor: string | null,
  hasNextPage: boolean,
  signal: AbortSignal,
): Promise<HistoryCommit[]> {
  const commits = [...firstPage];
  let cursor = firstCursor;
  let more = hasNextPage;

  while (more) {
    const page = await fetchCommitHistoryPage(
      token, owner, repo, branch, cursor, since, until, signal,
    );
    commits.push(...page.commits);
    cursor = page.endCursor;
    more = page.hasNextPage;
  }

  return commits;
}

export function useFolderChurn({
  token,
  owner,
  repo,
  branch,
  since,
  until,
  active,
}: {
  token: string | null;
  owner: string;
  repo: string;
  branch: string | null;
  since: string | null;
  until: string | null;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const enabled = !!token && !!owner && !!repo && !!branch && active;

  // Whatever has been fetched is worth keeping even if the tab is closed or
  // the interval changed mid-run, so a checkpoint is forced when the page goes
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

  // Pass one, on every interval change: how big is this job? The history's
  // totalCount comes back on the very first page, so one cheap request sizes a
  // window before anything commits to fetching file lists.
  const countQuery = useQuery({
    queryKey: ["churnCount", owner, repo, branch, since, until],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) =>
      fetchCommitHistoryPage(token!, owner, repo, branch!, null, since, until, signal),
  });

  // What is left of the hourly budget. /rate_limit is free, so asking costs
  // nothing but tells the estimate below whether the interval actually fits.
  const rateLimitQuery = useQuery({
    queryKey: ["rateLimit", token],
    enabled,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: () => fetchRateLimit(token!),
  });

  const dataQuery = useQuery({
    queryKey: ["churnData", owner, repo, branch, since, until],
    enabled: enabled && countQuery.data !== undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ queryKey, signal }): Promise<ChurnData> => {
      const store = await getStore(owner, repo);
      const first = countQuery.data!;

      const history = await fetchHistory(
        token!, owner, repo, branch!, since, until,
        first.commits, first.endCursor, first.hasNextPage, signal,
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
            // not cost the rest of the interval.
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
  const rateLimit: RateLimitStatus | null = rateLimitQuery.data ?? null;

  // Requests this window needs in total, cache hits already deducted. This is
  // deliberately the size of the whole job rather than what is left of it: a
  // warning about the job must not evaporate halfway through just because the
  // queue has drained past the threshold. Before the history has been paged
  // the only figure available is the commit count including merges, which is
  // an upper bound.
  const requiredRequests = data
    ? data.needed - data.fromCache
    : (countQuery.data?.totalCount ?? null);

  // Headroom rather than the bare remainder, so the warning arrives while
  // choosing a narrower interval is still worth doing.
  const mayExceedRateLimit =
    requiredRequests !== null &&
    rateLimit !== null &&
    requiredRequests > rateLimit.remaining * CHURN_RATE_LIMIT_HEADROOM;

  const error = countQuery.error ?? dataQuery.error;

  const isStreaming = dataQuery.isFetching && (!data || data.resolved < data.needed);

  return {
    data,
    totalCount: countQuery.data?.totalCount ?? null,
    requiredRequests,
    rateLimit,
    // Only worth saying while there is still fetching to do; once the window
    // is complete the warning has been overtaken by events.
    mayExceedRateLimit: mayExceedRateLimit && (isStreaming || !data),
    // The tree is a nicety; failing to read it only costs the GONE badges.
    tipDirs: treeQuery.data && !treeQuery.data.truncated ? treeQuery.data.dirs : null,
    isCounting: countQuery.isLoading,
    isStreaming,
    error: error ? (error as Error).message : null,
    refetch: () => {
      countQuery.refetch();
      dataQuery.refetch();
      rateLimitQuery.refetch();
    },
  };
}
