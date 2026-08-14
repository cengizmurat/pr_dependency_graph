import type { ChurnCommit, DirEntry } from "./folderChurn";

// A commit's diff never changes, so the expensive half of folder churn — one
// REST request per commit for its file list — only ever has to be paid once.
// The interned per-commit records are kept in localStorage keyed by SHA, which
// makes a second visit free and makes switching branches or widening the
// interval cost only the commits that are genuinely new.

const CACHE_PREFIX = "folder-churn:";
const CACHE_VERSION = 2;

// Beyond this a repository's cache is trimmed oldest-commit-first. The interned
// shape runs about 40 bytes per commit, so this holds a six-figure history
// while leaving room in the 5MB localStorage budget for other repositories.
const MAX_BYTES_PER_REPO = 2_000_000;

// [day, entries] — the same shape the aggregator consumes, minus the SHA,
// which is the key it is stored under.
type StoredCommit = [number, DirEntry[]];

interface StoredCache {
  v: number;
  dirs: string[];
  commits: Record<string, StoredCommit>;
  touched: number;
}

export interface LoadedCache {
  dirs: string[];
  commits: Map<string, ChurnCommit>;
}

function cacheKey(owner: string, repo: string): string {
  return `${CACHE_PREFIX}${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export function loadChurnCache(owner: string, repo: string): LoadedCache {
  const empty: LoadedCache = { dirs: [], commits: new Map() };
  let parsed: StoredCache;
  try {
    const raw = localStorage.getItem(cacheKey(owner, repo));
    if (!raw) return empty;
    parsed = JSON.parse(raw) as StoredCache;
  } catch {
    return empty;
  }

  // A cache written by an older shape is dropped rather than migrated; it
  // costs one refetch and keeps the reader simple.
  if (parsed?.v !== CACHE_VERSION || !Array.isArray(parsed.dirs)) return empty;

  const commits = new Map<string, ChurnCommit>();
  for (const [sha, stored] of Object.entries(parsed.commits ?? {})) {
    if (!Array.isArray(stored) || stored.length !== 2) continue;
    commits.set(sha, { sha, day: stored[0], entries: stored[1] });
  }
  return { dirs: parsed.dirs, commits };
}

// Persists the whole per-repo cache. Callers hold the interned directory array
// and the commit map for the session and hand both back, so this never has to
// merge against what is already on disk.
export function saveChurnCache(
  owner: string,
  repo: string,
  dirs: readonly string[],
  commits: ReadonlyMap<string, ChurnCommit>,
): void {
  const key = cacheKey(owner, repo);

  // Oldest first, so trimming to fit drops the least interesting commits —
  // the ones outside any default window.
  const ordered = [...commits.values()].sort((a, b) => a.day - b.day);

  const write = (from: number): string => {
    const record: Record<string, StoredCommit> = {};
    for (let i = from; i < ordered.length; i++) {
      record[ordered[i].sha] = [ordered[i].day, ordered[i].entries];
    }
    const payload: StoredCache = {
      v: CACHE_VERSION,
      dirs: [...dirs],
      commits: record,
      touched: Date.now(),
    };
    return JSON.stringify(payload);
  };

  let serialized = write(0);
  // Drop the oldest quarter at a time rather than one commit at a time, so an
  // oversized history converges in a handful of passes.
  let from = 0;
  while (serialized.length > MAX_BYTES_PER_REPO && from < ordered.length) {
    from += Math.max(1, Math.ceil((ordered.length - from) / 4));
    serialized = write(from);
  }

  try {
    localStorage.setItem(key, serialized);
  } catch {
    // Out of quota. Other repositories' caches are the cheapest thing to give
    // up — they cost a refetch on a page the user is not currently looking at.
    evictOtherRepos(key);
    try {
      localStorage.setItem(key, serialized);
    } catch {
      // Still no room: leave the cache absent rather than half-written.
      try {
        localStorage.removeItem(key);
      } catch {
        /* nothing further to try */
      }
    }
  }
}

function evictOtherRepos(keepKey: string): void {
  const victims: { key: string; touched: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX) || key === keepKey) continue;
    let touched = 0;
    try {
      touched = (JSON.parse(localStorage.getItem(key) ?? "{}") as StoredCache).touched ?? 0;
    } catch {
      /* an unreadable entry is evicted first */
    }
    victims.push({ key, touched });
  }
  victims.sort((a, b) => a.touched - b.touched);
  for (const victim of victims) {
    try {
      localStorage.removeItem(victim.key);
    } catch {
      /* nothing further to try */
    }
  }
}
