import type { CommitFile } from "./types";

// Folder churn: how often each folder of a repository is modified, rather than
// how much code moved inside it. A folder counts once per commit no matter how
// deep the change sat or how many of its files changed, so the numbers here
// answer "which areas change often", not "which areas are big".

export const MS_PER_DAY = 86_400_000;

// Days since the unix epoch, in UTC. Absolute rather than relative to a
// branch's first commit, so switching branches leaves a picked date range
// meaning the same thing.
export function dayFromIso(iso: string): number {
  return Math.floor(Date.parse(iso) / MS_PER_DAY);
}

export function dayFromParts(year: number, month: number, date: number): number {
  return Math.floor(Date.UTC(year, month, date) / MS_PER_DAY);
}

export function dayToDate(day: number): Date {
  return new Date(day * MS_PER_DAY);
}

export function todayDay(): number {
  const now = new Date();
  return dayFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// --- The interned model ---------------------------------------------------

// [directory index, files changed, lines changed]. Every directory in the
// history is interned into one shared array and referenced by index, so a
// large history stays small enough to hold in the browser and re-aggregate
// for any prefix, interval, measure and bucket size without refetching.
export type DirEntry = [number, number, number];

export interface ChurnCommit {
  sha: string;
  day: number;
  entries: DirEntry[];
}

export class DirIntern {
  readonly dirs: string[];
  private readonly index: Map<string, number>;

  constructor(dirs: string[] = []) {
    this.dirs = [...dirs];
    this.index = new Map(this.dirs.map((d, i) => [d, i]));
  }

  intern(dir: string): number {
    const existing = this.index.get(dir);
    if (existing !== undefined) return existing;
    const next = this.dirs.length;
    this.dirs.push(dir);
    this.index.set(dir, next);
    return next;
  }
}

// Folds a commit's file list into one entry per directory holding a changed
// file. Directories are the immediate parents only — the roll-up into
// ancestors happens at aggregation time, where the prefix being viewed is
// known.
export function entriesFromFiles(
  files: CommitFile[],
  intern: DirIntern,
): DirEntry[] {
  const byDir = new Map<number, DirEntry>();
  for (const file of files) {
    const idx = intern.intern(dirname(file.path));
    const entry = byDir.get(idx);
    if (entry) {
      entry[1] += 1;
      entry[2] += file.changes;
    } else {
      byDir.set(idx, [idx, 1, file.changes]);
    }
  }
  return [...byDir.values()];
}

// --- Paths ----------------------------------------------------------------

// `src`, `/src`, `./src/` and `src//` all name the same folder. A segment that
// merely starts with a dot is a real folder (`.github`) and survives; only a
// segment that *is* "." is dropped.
export function normalizeFolderPath(input: string): string {
  const kept: string[] = [];
  for (const raw of input.trim().split("/")) {
    const segment = raw.trim();
    if (segment === "" || segment === ".") continue;
    kept.push(segment);
  }
  return kept.join("/");
}

export const ROOT_FILES_BUCKET = "(root files)";
export const DIRECT_FILES_BUCKET = "(direct files)";

export function isSyntheticBucket(bucket: string): boolean {
  return bucket === ROOT_FILES_BUCKET || bucket === DIRECT_FILES_BUCKET;
}

// Which folder bucket a touched directory falls into for the prefix being
// viewed, or null when it sits outside the prefix entirely. Everything below
// the first level under the prefix folds into that level: at `src/`, all of
// `src/mastra`, `src/mastra/tools` and `src/mastra/db` return `mastra`.
export function bucketFor(dir: string, prefix: string): string | null {
  if (prefix === "") {
    if (dir === "") return ROOT_FILES_BUCKET;
    const slash = dir.indexOf("/");
    return slash === -1 ? dir : dir.slice(0, slash);
  }
  if (dir === prefix) return DIRECT_FILES_BUCKET;
  if (!dir.startsWith(prefix + "/")) return null;
  const rest = dir.slice(prefix.length + 1);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

// The full path a bucket stands for, used to check it against the branch tip.
export function bucketPath(bucket: string, prefix: string): string | null {
  if (isSyntheticBucket(bucket)) return null;
  return prefix === "" ? bucket : `${prefix}/${bucket}`;
}

// Every directory the history has ever seen, with ancestors filled in: a file
// at `a/b/c.ts` interns only `a/b`, but `a` is just as real a folder. This set
// is what the folder input autocompletes from and what decides whether a typed
// path is known.
export function expandDirs(dirs: readonly string[]): Set<string> {
  const all = new Set<string>();
  for (const dir of dirs) {
    for (let p = dir; p !== ""; p = dirname(p)) all.add(p);
  }
  return all;
}

export function childrenOf(parent: string, allDirs: ReadonlySet<string>): string[] {
  const prefix = parent === "" ? "" : `${parent}/`;
  const names = new Set<string>();
  for (const dir of allDirs) {
    if (parent !== "" && !dir.startsWith(prefix)) continue;
    const rest = dir.slice(prefix.length);
    if (rest === "") continue;
    const slash = rest.indexOf("/");
    names.add(slash === -1 ? rest : rest.slice(0, slash));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export interface PathSuggestions {
  // The nearest ancestor of the typed path that the history knows about.
  parent: string;
  // Full paths, ready to be applied as the folder prefix.
  paths: string[];
}

const MAX_SUGGESTIONS = 10;

// What to offer when nothing in the history ever lived under the typed path.
// The useful answer is the folders beside the one that was typed, so a typo in
// `src/mastraa/` offers the other folders under `src/`. If the parent is bogus
// too the walk continues up until a known ancestor is found, ending at the
// repo root. Prefixes are matched in both directions so an overshoot like
// `src/mastraa` still surfaces `src/mastra`.
export function suggestFolders(
  typed: string,
  allDirs: ReadonlySet<string>,
): PathSuggestions {
  let parent = dirname(typed);
  // The segment of the typed path that sits directly under `parent` — the one
  // the suggestions are alternatives to.
  let segment = typed.slice(parent === "" ? 0 : parent.length + 1);
  while (parent !== "" && !allDirs.has(parent)) {
    segment = parent.slice(dirname(parent) === "" ? 0 : dirname(parent).length + 1);
    parent = dirname(parent);
  }

  const needle = segment.toLowerCase();
  const scored = childrenOf(parent, allDirs).map((name) => {
    const hay = name.toLowerCase();
    const related =
      needle !== "" && (hay.startsWith(needle) || needle.startsWith(hay));
    return { name, related };
  });
  scored.sort((a, b) => {
    if (a.related !== b.related) return a.related ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    parent,
    paths: scored
      .slice(0, MAX_SUGGESTIONS)
      .map(({ name }) => (parent === "" ? name : `${parent}/${name}`)),
  };
}

// --- Time buckets ---------------------------------------------------------

export type BucketSize = "week" | "month" | "quarter";
export type BucketChoice = "auto" | BucketSize;

export const AUTO_WEEK_MAX_DAYS = 120;
export const AUTO_MONTH_MAX_DAYS = 365 * 3;

export function resolveBucketSize(
  fromDay: number,
  toDay: number,
  choice: BucketChoice,
): BucketSize {
  if (choice !== "auto") return choice;
  const span = toDay - fromDay + 1;
  if (span < AUTO_WEEK_MAX_DAYS) return "week";
  if (span < AUTO_MONTH_MAX_DAYS) return "month";
  return "quarter";
}

// Day 0 of the epoch is a Thursday, so shifting by 3 lands weeks on Monday.
function weekStart(day: number): number {
  return day - (((day % 7) + 10) % 7);
}

function bucketStartDay(day: number, size: BucketSize): number {
  if (size === "week") return weekStart(day);
  const date = dayToDate(day);
  const month =
    size === "month"
      ? date.getUTCMonth()
      : Math.floor(date.getUTCMonth() / 3) * 3;
  return dayFromParts(date.getUTCFullYear(), month, 1);
}

function nextBucketStart(startDay: number, size: BucketSize): number {
  if (size === "week") return startDay + 7;
  const date = dayToDate(startDay);
  const step = size === "month" ? 1 : 3;
  return dayFromParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + step,
    1,
  );
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface TimeBucket {
  startDay: number;
  // Last day belonging to the bucket itself, ignoring the interval.
  endDay: number;
  // Days of the bucket the interval actually covers. Lower than the bucket's
  // own length for the first and last bucket of most intervals.
  coveredDays: number;
  totalDays: number;
  label: string;
  fullLabel: string;
}

export function enumerateBuckets(
  fromDay: number,
  toDay: number,
  size: BucketSize,
): TimeBucket[] {
  if (toDay < fromDay) return [];
  const buckets: TimeBucket[] = [];
  const multiYear =
    dayToDate(fromDay).getUTCFullYear() !== dayToDate(toDay).getUTCFullYear();

  for (
    let start = bucketStartDay(fromDay, size);
    start <= toDay;
    start = nextBucketStart(start, size)
  ) {
    const end = nextBucketStart(start, size) - 1;
    const date = dayToDate(start);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();

    let label: string;
    let fullLabel: string;
    if (size === "week") {
      label = `${MONTHS[month]} ${date.getUTCDate()}`;
      fullLabel = `Week of ${MONTHS[month]} ${date.getUTCDate()}, ${year}`;
    } else if (size === "month") {
      label = multiYear ? `${MONTHS[month]} ${String(year).slice(2)}` : MONTHS[month];
      fullLabel = `${MONTHS[month]} ${year}`;
    } else {
      const quarter = Math.floor(month / 3) + 1;
      label = `Q${quarter} ${String(year).slice(2)}`;
      fullLabel = `Q${quarter} ${year}`;
    }

    buckets.push({
      startDay: start,
      endDay: end,
      coveredDays: Math.min(end, toDay) - Math.max(start, fromDay) + 1,
      totalDays: end - start + 1,
      label,
      fullLabel,
    });
  }

  return buckets;
}

// --- Aggregation ----------------------------------------------------------

export type Measure = "commits" | "files" | "lines";

export const MEASURE_LABELS: Record<Measure, string> = {
  commits: "commits",
  files: "files changed",
  lines: "lines changed",
};

export interface FolderTotals {
  folder: string;
  commits: number;
  files: number;
  lines: number;
  // The folder is not at the branch tip any more. It was still real churn at
  // the time, so it is flagged rather than dropped.
  gone: boolean;
}

export interface ChurnAggregate {
  folders: FolderTotals[];
  buckets: TimeBucket[];
  bucketSize: BucketSize;
  // Folder -> value per bucket index, in the active measure.
  series: Map<string, number[]>;
  // Commits in the interval that touched anything under the prefix.
  commitsInInterval: number;
  // Commits in the interval on this branch, whether or not they touched the
  // prefix — the denominator the folder counts should be read against.
  branchCommitsInInterval: number;
  // Sum over commits of the number of distinct folders each one touched.
  folderTouches: number;
}

export function measureOf(totals: FolderTotals, measure: Measure): number {
  return measure === "commits"
    ? totals.commits
    : measure === "files"
      ? totals.files
      : totals.lines;
}

export interface AggregateOptions {
  dirs: readonly string[];
  commits: readonly ChurnCommit[];
  prefix: string;
  fromDay: number;
  toDay: number;
  measure: Measure;
  bucketChoice: BucketChoice;
  // Directories present at the branch tip; null when unknown (an oversized
  // tree), in which case nothing is flagged as gone.
  tipDirs: ReadonlySet<string> | null;
}

export function aggregateChurn({
  dirs,
  commits,
  prefix,
  fromDay,
  toDay,
  measure,
  bucketChoice,
  tipDirs,
}: AggregateOptions): ChurnAggregate {
  const bucketSize = resolveBucketSize(fromDay, toDay, bucketChoice);
  const buckets = enumerateBuckets(fromDay, toDay, bucketSize);

  // Bucket start day -> index, so a commit finds its time bucket without a
  // scan. Every bucket in the range is contiguous, so the map is complete.
  const bucketIndex = new Map<number, number>();
  buckets.forEach((b, i) => bucketIndex.set(b.startDay, i));

  const totals = new Map<string, FolderTotals>();
  const series = new Map<string, number[]>();
  let commitsInInterval = 0;
  let branchCommitsInInterval = 0;
  let folderTouches = 0;

  for (const commit of commits) {
    if (commit.day < fromDay || commit.day > toDay) continue;
    branchCommitsInInterval++;

    // The de-duplication guard, and the single most load-bearing line in the
    // feature: everything a commit touched is folded into one entry per
    // folder bucket *before* anything is counted. A commit touching
    // `src/mastra/tools/a.ts` and `src/mastra/db/b.ts` reaches the counters
    // as one `mastra` entry, so it adds one commit to that folder, not two.
    const perFolder = new Map<string, { files: number; lines: number }>();
    for (const [dirIdx, files, lines] of commit.entries) {
      const bucket = bucketFor(dirs[dirIdx], prefix);
      if (bucket === null) continue;
      const existing = perFolder.get(bucket);
      if (existing) {
        existing.files += files;
        existing.lines += lines;
      } else {
        perFolder.set(bucket, { files, lines });
      }
    }

    if (perFolder.size === 0) continue;
    commitsInInterval++;
    folderTouches += perFolder.size;

    const timeIdx = bucketIndex.get(bucketStartDay(commit.day, bucketSize));

    for (const [folder, counts] of perFolder) {
      let entry = totals.get(folder);
      if (!entry) {
        const path = bucketPath(folder, prefix);
        entry = {
          folder,
          commits: 0,
          files: 0,
          lines: 0,
          gone: tipDirs !== null && path !== null && !tipDirs.has(path),
        };
        totals.set(folder, entry);
      }
      entry.commits += 1;
      entry.files += counts.files;
      entry.lines += counts.lines;

      if (timeIdx !== undefined) {
        let points = series.get(folder);
        if (!points) {
          points = new Array(buckets.length).fill(0);
          series.set(folder, points);
        }
        points[timeIdx] +=
          measure === "commits" ? 1 : measure === "files" ? counts.files : counts.lines;
      }
    }
  }

  const folders = [...totals.values()].sort((a, b) => {
    const diff = measureOf(b, measure) - measureOf(a, measure);
    return diff !== 0 ? diff : a.folder.localeCompare(b.folder);
  });

  return {
    folders,
    buckets,
    bucketSize,
    series,
    commitsInInterval,
    branchCommitsInInterval,
    folderTouches,
  };
}

// The partial first and last buckets of an interval, described in words. An
// interval ending mid-month makes the last point dive, and saying so beats
// letting it read as a collapse in activity.
export function partialBucketNotes(buckets: TimeBucket[]): string[] {
  const notes: string[] = [];
  const edges = buckets.length > 1 ? [buckets[0], buckets[buckets.length - 1]] : buckets;
  for (const bucket of edges) {
    if (bucket.coveredDays >= bucket.totalDays) continue;
    notes.push(
      `${bucket.fullLabel} covers ${bucket.coveredDays} of ${bucket.totalDays} days`,
    );
  }
  return notes;
}
