import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCommitFiles,
  fetchCommitHistoryPage,
  fetchRepoTreeDirs,
} from "../api";
import type { HistoryCommit } from "../types";
import { DirIntern, dayFromIso, entriesFromFiles } from "../folderChurn";
import type { ChurnCommit } from "../folderChurn";
import { loadChurnCache, saveChurnCache } from "../churnCache";
import {
  CHURN_CONCURRENCY,
  CHURN_CONFIRM_THRESHOLD,
  CHURN_MAX_RETRIES,
  CHURN_PROGRESS_MS,
  CHURN_SAVE_EVERY,
} from "../constants";

// The interned directory table and the per-commit records are per repository,
// not per branch or per window: a commit's diff is the same whichever branch
// reaches it, and directory indices have to stay stable for records loaded
// from the cache to keep meaning what they meant. One store per repository is
// kept for the life of the session, seeded from localStorage on first use.
interface RepoStore {
  intern: DirIntern;
  commits: Map<string, ChurnCommit>;
}

const stores = new Map<string, RepoStore>();

function getStore(owner: string, repo: string): RepoStore {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
  let store = stores.get(key);
  if (!store) {
    const cached = loadChurnCache(owner, repo);
    store = { intern: new DirIntern(cached.dirs), commits: cached.commits };
    stores.set(key, store);
  }
  return store;
}

export interface ChurnData {
  dirs: string[];
  commits: ChurnCommit[];
  // File lists resolved so far, against the number the window needs. Equal
  // once the fetch is done; unequal while it streams in.
  resolved: number;
  needed: number;
  mergesSkipped: number;
}

export interface ChurnCounts {
  // Commits in the window including merges — what the GraphQL history reports
  // before any file list has been fetched, and what the size warning reads.
  totalCount: number;
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

// GitHub answers a tripped secondary rate limit with 403 or 429 and often a
// Retry-After. Backing off and retrying is the difference between a large
// window finishing and it failing halfway; a 404 or a permissions error is
// not worth retrying and is raised straight away.
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
      const status = (err as { status?: number }).status;
      const retryable = status === 403 || status === 429 || status === 502 || status === 503;
      if (isAbort(err) || !retryable || attempt >= CHURN_MAX_RETRIES) throw err;
      const retryAfter = (err as { retryAfter?: number }).retryAfter;
      const delay = retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(delay, 60_000), signal);
    }
  }
}

// A fixed pool of workers pulling from one queue, rather than a batch at a
// time: a single slow commit then delays only its own slot instead of holding
// up the whole batch behind it.
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
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
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const windowKey = `${owner}/${repo}@${branch}:${since ?? ""}..${until ?? ""}`;

  const enabled = !!token && !!owner && !!repo && !!branch && active;

  // Pass one: how big is this job? The history's totalCount comes back on the
  // very first page, so the size of a window is known after a single cheap
  // request — before anything commits to a per-commit fetch.
  const countQuery = useQuery({
    queryKey: ["churnCount", owner, repo, branch, since, until],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: ({ signal }) =>
      fetchCommitHistoryPage(token!, owner, repo, branch!, null, since, until, signal),
  });

  const totalCount = countQuery.data?.totalCount ?? null;
  const needsConfirm =
    totalCount !== null &&
    totalCount > CHURN_CONFIRM_THRESHOLD &&
    confirmedKey !== windowKey;

  // Reset the confirmation whenever the window changes, so widening the
  // interval asks again rather than inheriting the last "yes".
  useEffect(() => {
    setConfirmedKey((prev) => (prev === windowKey ? prev : null));
  }, [windowKey]);

  const confirm = useCallback(() => setConfirmedKey(windowKey), [windowKey]);

  const dataQuery = useQuery({
    queryKey: ["churnData", owner, repo, branch, since, until],
    enabled: enabled && countQuery.data !== undefined && !needsConfirm,
    staleTime: 5 * 60 * 1000,
    queryFn: async ({ queryKey, signal }): Promise<ChurnData> => {
      const store = getStore(owner, repo);
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
      let resolved = relevant.length - missing.length;

      const snapshot = (): ChurnData => ({
        dirs: [...store.intern.dirs],
        commits: relevant
          .map((c) => store.commits.get(c.sha))
          .filter((c): c is ChurnCommit => c !== undefined),
        resolved,
        needed: relevant.length,
        mergesSkipped,
      });

      if (missing.length === 0) return snapshot();

      // Render what the cache already had while the rest streams in.
      queryClient.setQueryData(queryKey, snapshot());

      let sinceSave = 0;
      // Publishing a snapshot copies the directory table and re-runs the whole
      // aggregation, so doing it once per commit would cost O(commits²) on a
      // large history. Throttling to a few frames a second keeps the progress
      // visibly live without that.
      let lastPublish = 0;
      await runPool(missing, CHURN_CONCURRENCY, async (commit) => {
        const files = await fetchFilesWithRetry(token!, owner, repo, commit.sha, signal);
        store.commits.set(commit.sha, {
          sha: commit.sha,
          day: dayFromIso(commit.committedDate),
          entries: entriesFromFiles(files, store.intern),
        });
        resolved++;
        sinceSave++;

        const now = Date.now();
        if (now - lastPublish >= CHURN_PROGRESS_MS) {
          lastPublish = now;
          queryClient.setQueryData(queryKey, snapshot());
        }

        // Checkpoint periodically so a long run that is cancelled halfway
        // still leaves everything it fetched behind for the next attempt.
        if (sinceSave >= CHURN_SAVE_EVERY) {
          sinceSave = 0;
          saveChurnCache(owner, repo, store.intern.dirs, store.commits);
        }
      });

      saveChurnCache(owner, repo, store.intern.dirs, store.commits);
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

  const error = countQuery.error ?? dataQuery.error;

  return {
    data: dataQuery.data ?? null,
    totalCount,
    needsConfirm,
    confirm,
    // The tree is a nicety; failing to read it only costs the GONE badges.
    tipDirs: treeQuery.data && !treeQuery.data.truncated ? treeQuery.data.dirs : null,
    isCounting: countQuery.isLoading,
    isLoading: dataQuery.isLoading,
    isFetching: dataQuery.isFetching,
    error: error ? (error as Error).message : null,
    refetch: () => {
      countQuery.refetch();
      dataQuery.refetch();
    },
  };
}
