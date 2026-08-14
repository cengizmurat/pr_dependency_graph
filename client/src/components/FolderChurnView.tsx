import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AutoComplete, DatePicker, Segmented, Select } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { fetchBranches } from "../api";
import {
  CHURN_DEFAULT_PRESET,
  CHURN_DEFAULT_SERIES,
  CHURN_INTERVAL_PRESETS,
  CHURN_MAX_SERIES,
  churnSeriesColor,
} from "../constants";
import type { ChurnIntervalPreset } from "../constants";
import {
  MEASURE_LABELS,
  aggregateChurn,
  bucketPath,
  dayFromParts,
  dayToDate,
  expandDirs,
  isSyntheticBucket,
  measureOf,
  normalizeFolderPath,
  partialBucketNotes,
  suggestFolders,
  todayDay,
  MS_PER_DAY,
} from "../folderChurn";
import type { BucketChoice, Measure } from "../folderChurn";
import { useFolderChurn } from "../hooks/useFolderChurn";
import ChurnBarChart from "./ChurnBarChart";
import ChurnTrendChart from "./ChurnTrendChart";
import type { ChurnSeries } from "./ChurnTrendChart";
import { styles } from "./FolderChurnView.styles";

const { RangePicker } = DatePicker;

const MEASURE_OPTIONS: { value: Measure; label: string }[] = [
  { value: "commits", label: "Commits" },
  { value: "files", label: "Files" },
  { value: "lines", label: "Lines" },
];

const BUCKET_OPTIONS: { value: BucketChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
];

function isPreset(value: string | null): value is ChurnIntervalPreset {
  return CHURN_INTERVAL_PRESETS.some((p) => p.id === value);
}

function dayFromDayjs(value: Dayjs): number {
  return dayFromParts(value.year(), value.month(), value.date());
}

function dayjsFromDay(day: number): Dayjs {
  const date = dayToDate(day);
  return dayjs(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoFromDayStart(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString();
}

function isoFromDayEnd(day: number): string {
  return new Date((day + 1) * MS_PER_DAY - 1).toISOString();
}

export default function FolderChurnView({
  token,
  owner,
  repo,
}: {
  token: string;
  owner: string;
  repo: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Folder, branch, interval, measure and bucket size live in the URL so a
  // view can be bookmarked and shared, the way the other tabs keep their
  // state. Chart selection stays local: it is interaction, not a view.
  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const rawPath = searchParams.get("path") ?? "";
  const prefix = useMemo(() => normalizeFolderPath(rawPath), [rawPath]);

  const measure = (searchParams.get("measure") as Measure) ?? "commits";
  const bucketChoice = (searchParams.get("bucket") as BucketChoice) ?? "auto";
  const presetParam = searchParams.get("range");
  const preset: ChurnIntervalPreset | "custom" = isPreset(presetParam)
    ? presetParam
    : presetParam === "custom"
      ? "custom"
      : CHURN_DEFAULT_PRESET;

  const branchesQuery = useQuery({
    queryKey: ["branches", owner, repo],
    queryFn: () => fetchBranches(token, owner, repo),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  // "Defaulting to main" in practice means the repository's own default
  // branch, which is what a viewer means by main; the literal name is the
  // fallback while the branch list is still loading.
  const branch =
    searchParams.get("branch") ?? branchesQuery.data?.defaultBranch ?? null;

  // --- Interval -----------------------------------------------------------

  const today = useMemo(() => todayDay(), []);
  const customFrom = searchParams.get("from");
  const customTo = searchParams.get("to");

  // `fromDay` is null for all time: the history query is then unbounded, and
  // the aggregation's lower bound becomes whatever the oldest commit turns
  // out to be.
  const { fromDay, toDay } = useMemo(() => {
    if (preset === "custom" && customFrom && customTo) {
      const from = Number(customFrom);
      const to = Number(customTo);
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        return { fromDay: from, toDay: to };
      }
    }
    const days = CHURN_INTERVAL_PRESETS.find((p) => p.id === preset)?.days ?? null;
    if (days === null) return { fromDay: null, toDay: today };
    return { fromDay: today - days + 1, toDay: today };
  }, [preset, customFrom, customTo, today]);

  // The typed folder scopes the history query itself, so drilling into an area
  // costs a request per commit that touched *it* rather than one per commit in
  // the repository.
  const churn = useFolderChurn({
    token,
    owner,
    repo,
    branch,
    since: fromDay === null ? null : isoFromDayStart(fromDay),
    until: isoFromDayEnd(toDay),
    path: prefix === "" ? null : prefix,
    active: true,
  });

  const data = churn.data;

  // All time has no lower bound until the commits are in hand, at which point
  // the first commit is the bound.
  const effectiveFrom = useMemo(() => {
    if (fromDay !== null) return fromDay;
    if (!data || data.commits.length === 0) return toDay;
    return data.commits.reduce((min, c) => Math.min(min, c.day), Infinity);
  }, [fromDay, data, toDay]);

  // --- Aggregation --------------------------------------------------------

  const aggregate = useMemo(() => {
    if (!data) return null;
    return aggregateChurn({
      dirs: data.dirs,
      commits: data.commits,
      prefix,
      fromDay: effectiveFrom,
      toDay,
      measure,
      bucketChoice,
      tipDirs: churn.tipDirs,
    });
  }, [data, prefix, effectiveFrom, toDay, measure, bucketChoice, churn.tipDirs]);

  // Every directory the history knows about, plus the ones standing at the
  // branch tip. The union is what decides whether a typed path is real: a
  // folder that exists but saw no change in this interval is a different
  // situation from one that never existed at all.
  const historyDirs = useMemo(
    () => (data ? expandDirs(data.dirs) : new Set<string>()),
    [data],
  );
  const knownDirs = useMemo(() => {
    const all = new Set(historyDirs);
    if (churn.tipDirs) for (const dir of churn.tipDirs) if (dir !== "") all.add(dir);
    return all;
  }, [historyDirs, churn.tipDirs]);

  const autocompleteOptions = useMemo(
    () =>
      [...knownDirs]
        .sort((a, b) => a.localeCompare(b))
        .map((dir) => ({ value: dir })),
    [knownDirs],
  );

  const pathExists = prefix === "" || knownDirs.has(prefix);
  const pathHadChurn = prefix === "" || historyDirs.has(prefix);

  // --- Charted folders and their colour slots -----------------------------

  // A charted folder and the colour slot it holds. The slot is claimed when
  // the folder joins the chart and released only when it leaves, so
  // re-sorting the bars, changing the measure, the interval, the bucket size
  // or the branch never repaints a series that is already drawn. Keeping the
  // pair in one piece of state is what makes that guarantee hold: nothing can
  // reassign a colour without the folder list changing too.
  const [charted, setCharted] = useState<{ folder: string; slot: number }[]>([]);
  const seededPrefixRef = useRef<string | null>(null);
  // Once the viewer has picked folders themselves, the automatic fill stops
  // interfering with the selection.
  const pickedByHandRef = useRef(false);
  const [capNotice, setCapNotice] = useState(false);

  const toggleFolder = useCallback((folder: string) => {
    setCapNotice(false);
    pickedByHandRef.current = true;
    setCharted((prev) => {
      if (prev.some((c) => c.folder === folder)) {
        return prev.filter((c) => c.folder !== folder);
      }
      const taken = new Set(prev.map((c) => c.slot));
      for (let slot = 0; slot < CHURN_MAX_SERIES; slot++) {
        if (!taken.has(slot)) return [...prev, { folder, slot }];
      }
      setCapNotice(true);
      return prev;
    });
  }, []);

  // A different folder prefix is a different set of folders, so the selection
  // starts again, filled with the busiest few. While commits are still coming
  // in the fill tops up as new folders appear rather than waiting for the end
  // — but it only ever claims free slots, never moves a folder already drawn,
  // so a line's colour is fixed from the moment it is first drawn.
  useEffect(() => {
    if (!aggregate) return;
    const isNewPrefix = seededPrefixRef.current !== prefix;
    if (isNewPrefix) {
      seededPrefixRef.current = prefix;
      pickedByHandRef.current = false;
      setCapNotice(false);
      setCharted(
        aggregate.folders
          .slice(0, CHURN_DEFAULT_SERIES)
          .map((f, slot) => ({ folder: f.folder, slot })),
      );
      return;
    }
    // The top-up keeps running rather than stopping when the stream ends: the
    // last folders to appear arrive in the same update that ends it, and would
    // otherwise never be offered a slot. It only ever claims free ones, so
    // running again costs nothing once there is nothing left to add.
    if (pickedByHandRef.current) return;

    setCharted((prev) => {
      if (prev.length >= CHURN_DEFAULT_SERIES) return prev;
      const already = new Set(prev.map((c) => c.folder));
      const taken = new Set(prev.map((c) => c.slot));
      const next = [...prev];
      for (const folder of aggregate.folders) {
        if (next.length >= CHURN_DEFAULT_SERIES) break;
        if (already.has(folder.folder)) continue;
        const slot = [...Array(CHURN_MAX_SERIES).keys()].find((s) => !taken.has(s));
        if (slot === undefined) break;
        taken.add(slot);
        next.push({ folder: folder.folder, slot });
      }
      return next.length === prev.length ? prev : next;
    });
  }, [prefix, aggregate]);

  const colorFor = useCallback(
    (folder: string) => {
      const entry = charted.find((c) => c.folder === folder);
      return entry ? churnSeriesColor(entry.slot) : null;
    },
    [charted],
  );

  const series: ChurnSeries[] = useMemo(() => {
    if (!aggregate) return [];
    return charted.map(({ folder, slot }) => {
      const values = aggregate.series.get(folder);
      return {
        folder,
        color: churnSeriesColor(slot),
        values: values ?? new Array(aggregate.buckets.length).fill(0),
        dormant: !values,
      };
    });
  }, [charted, aggregate]);

  // --- Rendering ----------------------------------------------------------

  const measureLabel = MEASURE_LABELS[measure];
  const folderLabel = prefix === "" ? "the repository root" : `${prefix}/`;
  const busiest = aggregate?.folders[0] ?? null;
  const avgFolders =
    aggregate && aggregate.commitsInInterval > 0
      ? aggregate.folderTouches / aggregate.commitsInInterval
      : 0;

  const suggestions = useMemo(
    () => (pathExists ? null : suggestFolders(prefix, knownDirs)),
    [pathExists, prefix, knownDirs],
  );

  const progress =
    data && data.needed > 0 ? Math.round((data.resolved / data.needed) * 100) : 0;

  // --- The fetch button and what it says it will cost ---------------------

  const estimate = churn.estimate;
  const scopeSuffix =
    prefix === "" ? "" : ` under ${prefix}/`;

  const fetchDisabled =
    churn.isCounting || churn.isStreaming || estimate?.totalCommits === 0;

  const fetchButtonLabel = churn.isCounting
    ? "Counting commits…"
    : churn.isStreaming && data
      ? `Fetching ${data.resolved.toLocaleString()} / ${data.needed.toLocaleString()}…`
      : churn.isStreaming
        ? "Fetching…"
        : estimate?.totalCommits === 0
          ? "Nothing to fetch"
          : churn.started && data
            ? "Refetch"
            : estimate?.toFetch !== null && estimate?.toFetch !== undefined
              ? `Fetch ${estimate.toFetch.toLocaleString()} commit${estimate.toFetch === 1 ? "" : "s"}`
              : `Fetch up to ${(estimate?.totalCommits ?? 0).toLocaleString()} commit${estimate?.totalCommits === 1 ? "" : "s"}`;

  // Merges are skipped everywhere else, so the headline counts what the tab is
  // actually about — and matches the number on the button rather than sitting
  // beside it saying something different.
  const headlineCount = estimate?.commits ?? estimate?.totalCommits ?? 0;
  const skippedMerges =
    estimate == null || estimate.commits === null
      ? 0
      : estimate.totalCommits - estimate.commits;

  const estimateHeadline = churn.isCounting
    ? "Sizing this interval…"
    : estimate === null
      ? ""
      : `${headlineCount.toLocaleString()} commit${
          headlineCount === 1 ? "" : "s"
        } in this interval${scopeSuffix}${
          skippedMerges > 0
            ? ` (${skippedMerges.toLocaleString()} merge${skippedMerges === 1 ? "" : "s"} skipped)`
            : ""
        }`;

  const estimateDetail = churn.isCounting
    ? null
    : estimate === null
      ? null
      : churn.started && data && !churn.isStreaming
        ? `${data.resolved.toLocaleString()} read${
            data.fromCache > 0 ? `, ${data.fromCache.toLocaleString()} of them from the cache` : ""
          }${data.mergesSkipped > 0 ? `, ${data.mergesSkipped.toLocaleString()} merge${data.mergesSkipped === 1 ? "" : "s"} skipped` : ""}.`
        : estimate.toFetch === null
          ? churn.isEstimating
            ? "Working out how many still need reading…"
            : "Too long a history to count what is already cached — the fetch will skip anything it has."
          : estimate.toFetch === 0
            ? "All of them are already cached, so this costs no requests."
            : `${estimate.cached?.toLocaleString() ?? 0} already cached · ${estimate.toFetch.toLocaleString()} request${
                estimate.toFetch === 1 ? "" : "s"
              } to GitHub.`;

  // The scoped history costing nothing means the folder saw no commits in this
  // window — which is answered without fetching anything. Whether the folder is
  // unknown or merely quiet is decided by the branch tip, which the tree query
  // already has.
  const emptyScope =
    prefix !== "" &&
    estimate !== null &&
    estimate.totalCommits === 0 &&
    !churn.isCounting &&
    !pathExists;
  const emptyInInterval =
    prefix !== "" &&
    estimate !== null &&
    estimate.totalCommits === 0 &&
    !churn.isCounting &&
    pathExists;

  return (
    <div style={styles.container}>
      <div style={styles.controls}>
        <div style={{ ...styles.control, ...styles.controlGrow }}>
          <label style={styles.controlLabel} htmlFor="churn-folder">
            Folder
          </label>
          <AutoComplete
            id="churn-folder"
            value={rawPath}
            options={autocompleteOptions}
            onChange={(value) => setParam({ path: value || null })}
            placeholder="Repository root — try src/ to drill in"
            allowClear
            filterOption={(input, option) => {
              const needle = normalizeFolderPath(input).toLowerCase();
              return needle === "" || (option?.value ?? "").toLowerCase().includes(needle);
            }}
          />
        </div>

        <div style={styles.control}>
          <label style={styles.controlLabel} htmlFor="churn-branch">
            Branch
          </label>
          <Select
            id="churn-branch"
            style={{ minWidth: 180 }}
            showSearch
            value={branch ?? undefined}
            loading={branchesQuery.isLoading}
            placeholder="Select a branch"
            options={(branchesQuery.data?.names ?? []).map((name) => ({
              value: name,
              label: name,
            }))}
            onChange={(value) => setParam({ branch: value })}
          />
        </div>

        <div style={styles.control}>
          <span style={styles.controlLabel}>Time interval</span>
          <div style={styles.presetRow}>
            <div style={styles.segmentedScroll}>
              <Segmented
                value={preset}
                options={CHURN_INTERVAL_PRESETS.map((p) => ({
                  value: p.id,
                  label: p.label,
                }))}
                onChange={(value) =>
                  setParam({ range: String(value), from: null, to: null })
                }
              />
            </div>
            <RangePicker
              style={styles.rangePicker}
              allowClear
              value={
                preset === "custom" && fromDay !== null
                  ? [dayjsFromDay(fromDay), dayjsFromDay(toDay)]
                  : null
              }
              onChange={(range) => {
                if (!range?.[0] || !range?.[1]) {
                  setParam({ range: CHURN_DEFAULT_PRESET, from: null, to: null });
                  return;
                }
                setParam({
                  range: "custom",
                  from: String(dayFromDayjs(range[0])),
                  to: String(dayFromDayjs(range[1])),
                });
              }}
            />
          </div>
        </div>

        {/* Measure and buckets wrap together rather than splitting across
            rows, so a narrow window gives two tidy rows instead of one
            control stranded under the rest. */}
        <div style={styles.controlPair}>
          <div style={styles.control}>
            <span style={styles.controlLabel}>Measure</span>
            <div style={styles.segmentedScroll}>
              <Segmented
                value={measure}
                options={MEASURE_OPTIONS}
                onChange={(value) => setParam({ measure: String(value) })}
              />
            </div>
          </div>

          <div style={styles.control}>
            <span style={styles.controlLabel}>Buckets</span>
            <div style={styles.segmentedScroll}>
              <Segmented
                value={bucketChoice}
                options={BUCKET_OPTIONS}
                onChange={(value) => setParam({ bucket: String(value) })}
              />
            </div>
          </div>
        </div>
      </div>

      <p style={styles.note}>
        A folder counts <strong>once per commit</strong>, however deep the change
        sat or how many of its files moved — so these are measures of how often
        an area changes, not how much code it holds. Merge commits are skipped,
        because their changes already belong to the commits they bring in, and a
        file moved between folders counts as a change to both. Two folder views
        do not break each other down: a change to{" "}
        <code style={styles.noteCode}>src/mastra/tools/x.ts</code> counts for{" "}
        <code style={styles.noteCode}>src</code> at the root and for{" "}
        <code style={styles.noteCode}>mastra</code> inside{" "}
        <code style={styles.noteCode}>src/</code>. They overlap; they are not
        meant to add up.
      </p>

      {/* Nothing is read until this is pressed. The count beside it is the
          answer to "what will this cost", refreshed whenever an input that
          changes the answer is touched. */}
      {!churn.error && (
        <div style={styles.actionBar}>
          <button
            style={{
              ...styles.fetchBtn,
              ...(fetchDisabled ? styles.fetchBtnDisabled : {}),
              ...(churn.started && !churn.isStreaming ? styles.fetchBtnDone : {}),
            }}
            disabled={fetchDisabled}
            onClick={churn.started && !churn.isStreaming ? churn.refetch : churn.start}
          >
            {fetchButtonLabel}
          </button>
          <div style={styles.actionText}>
            <div style={styles.actionHeadline}>{estimateHeadline}</div>
            {estimateDetail && <div style={styles.actionDetail}>{estimateDetail}</div>}
          </div>
        </div>
      )}

      {churn.error && (
        <div style={styles.panel}>
          <h3 style={{ ...styles.panelTitle, ...styles.errorText }}>
            Could not load commit history
          </h3>
          <p style={styles.panelText}>{churn.error}</p>
          <button style={styles.primaryBtn} onClick={churn.refetch}>
            Retry
          </button>
        </div>
      )}

      {/* Sizing the interval is one cheap request, so it happens on every
          change and reports before the per-commit fetch gets going. The
          warning is information, not a gate: the fetch runs either way and the
          charts fill in as commits land. */}
      {!churn.error && churn.mayExceedRateLimit && (
        <div style={{ ...styles.panel, ...styles.panelWarning }}>
          <h3 style={styles.panelTitle}>
            That is a lot of commits for one interval
          </h3>
          <p style={styles.panelText}>
            This interval needs about{" "}
            {churn.requiredRequests?.toLocaleString()} commit
            {churn.requiredRequests === 1 ? "" : "s"} that have not been read
            before, and GitHub returns a commit's file list one commit at a
            time. Your hourly budget has{" "}
            {churn.rateLimit?.remaining.toLocaleString()} of{" "}
            {churn.rateLimit?.limit.toLocaleString()} requests left
            {churn.rateLimit
              ? `, resetting at ${new Date(churn.rateLimit.resetAt).toLocaleTimeString()}`
              : ""}
            , so the fetch may run out before it finishes.
          </p>
          <p style={styles.panelText}>
            Nothing is lost if it does: everything read is kept, the charts
            below build up as the commits arrive, and picking up again after the
            reset only fetches what is still missing. A narrower interval gets
            you a complete answer sooner.
          </p>
        </div>
      )}

      {!churn.error && data?.rateLimited && (
        <div style={{ ...styles.panel, ...styles.panelWarning }}>
          <h3 style={styles.panelTitle}>The hourly budget ran out</h3>
          <p style={styles.panelText}>
            {data.resolved.toLocaleString()} of {data.needed.toLocaleString()}{" "}
            commits were read before GitHub stopped answering, and those are
            what the charts below show. The budget resets at{" "}
            {churn.rateLimit
              ? new Date(churn.rateLimit.resetAt).toLocaleTimeString()
              : "the top of the hour"}
            ; everything already read is cached, so continuing then costs only
            the remaining {(data.needed - data.resolved).toLocaleString()}.
          </p>
          <button style={styles.primaryBtn} onClick={churn.refetch}>
            Try again
          </button>
        </div>
      )}

      {/* Nothing has been read yet and nothing is on its way. Say what the
          button will do rather than showing empty charts. */}
      {!churn.error && !churn.started && !aggregate && !emptyScope && !churn.isCounting && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>Ready when you are</h3>
          <p style={styles.panelText}>
            {estimateHeadline}. Press <strong>{fetchButtonLabel}</strong> above to
            read them; the tiles, charts and table build up as the commits
            arrive. Nothing is fetched until you ask.
          </p>
        </div>
      )}

      {!churn.error && emptyScope && suggestions && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>
            Nothing has ever lived under <code style={styles.noteCode}>{prefix}</code>
          </h3>
          <p style={styles.panelText}>
            No commit on <strong>{branch}</strong> touched that path, and it is
            not at the branch tip either.{" "}
            {suggestions.paths.length > 0
              ? `Here is what sits ${
                  suggestions.parent === ""
                    ? "at the repository root"
                    : `under ${suggestions.parent}/`
                } instead:`
              : "Try another path."}
          </p>
          <div style={styles.suggestions}>
            {suggestions.paths.map((path) => (
              <button
                key={path}
                className="churn-suggestion"
                style={styles.suggestion}
                onClick={() => setParam({ path })}
              >
                {path}/
              </button>
            ))}
            <button
              className="churn-suggestion"
              style={{ ...styles.suggestion, ...styles.suggestionRoot }}
              onClick={() => setParam({ path: null })}
            >
              ← Back to repo root
            </button>
          </div>
        </div>
      )}

      {!churn.error && emptyScope === false && emptyInInterval && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>
            <code style={styles.noteCode}>{prefix}/</code> exists, but nothing under
            it changed in this interval
          </h3>
          <p style={styles.panelText}>
            The folder is there at the tip of <strong>{branch}</strong>; no commit
            in the selected interval touched it. Widen the interval to find when
            it last moved.
          </p>
        </div>
      )}

      {!churn.error && aggregate && pathExists && pathHadChurn && (
        <>
          {/* The charts are built from whatever has arrived, always — the
              progress strip says so rather than hiding them behind a spinner. */}
          {churn.isStreaming && data && (
            <div style={styles.progressPanel}>
              <div style={styles.progressRow}>
                <span style={styles.progressText}>
                  Reading commits — {data.resolved.toLocaleString()} of{" "}
                  {data.needed.toLocaleString()}
                  {data.fromCache > 0 &&
                    ` (${data.fromCache.toLocaleString()} already cached)`}
                  . The charts below grow as they arrive.
                </span>
                <span style={styles.progressPercent}>{progress}%</span>
              </div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${progress}%` }} />
              </div>
            </div>
          )}

          {!churn.isStreaming && data && data.failed > 0 && (
            <p style={styles.note}>
              {data.failed.toLocaleString()} commit
              {data.failed === 1 ? "" : "s"} could not be read and{" "}
              {data.failed === 1 ? "is" : "are"} left out of these numbers.
            </p>
          )}

          <div style={styles.tiles}>
            <div style={styles.tile}>
              <div style={styles.tileLabel}>Commits</div>
              <div style={styles.tileValue}>
                {aggregate.commitsInInterval.toLocaleString()}
              </div>
              <div style={styles.tileHint}>
                touching {folderLabel}, of{" "}
                {aggregate.branchCommitsInInterval.toLocaleString()} on {branch}
                {data && data.mergesSkipped > 0
                  ? ` (${data.mergesSkipped.toLocaleString()} merge${
                      data.mergesSkipped === 1 ? "" : "s"
                    } skipped)`
                  : ""}
              </div>
            </div>
            <div style={styles.tile}>
              <div style={styles.tileLabel}>Folders modified</div>
              <div style={styles.tileValue}>{aggregate.folders.length}</div>
              <div style={styles.tileHint}>directly under {folderLabel}</div>
            </div>
            <div style={styles.tile}>
              <div style={styles.tileLabel}>Busiest folder</div>
              <div style={styles.tileValue} title={busiest?.folder ?? ""}>
                {busiest?.folder ?? "—"}
              </div>
              <div style={styles.tileHint}>
                {busiest
                  ? `${measureOf(busiest, measure).toLocaleString()} ${measureLabel}`
                  : "nothing changed"}
              </div>
            </div>
            <div style={styles.tile}>
              <div style={styles.tileLabel}>Folders per commit</div>
              <div style={styles.tileValue}>{avgFolders.toFixed(2)}</div>
              <div style={styles.tileHint}>average, counting each folder once</div>
            </div>
          </div>

          {capNotice && (
            <p style={styles.note}>
              The trend chart holds {CHURN_MAX_SERIES} folders at a time — remove
              one before adding another, so every line keeps a colour of its own.
            </p>
          )}

          <ChurnTrendChart
            buckets={aggregate.buckets}
            series={series}
            measure={measure}
            partialNotes={partialBucketNotes(aggregate.buckets)}
            onRemoveSeries={toggleFolder}
          />

          <ChurnBarChart
            folders={aggregate.folders}
            measure={measure}
            colorFor={colorFor}
            onToggle={toggleFolder}
          />

          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.cardTitle}>The same numbers, as a table</h3>
              <p style={styles.cardSubtitle}>
                Commits count a folder once each; files and lines add up every
                change inside it. Click a row to chart it.
              </p>
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Folder</th>
                    <th style={{ ...styles.th, ...styles.thNumeric }}>Commits</th>
                    <th style={{ ...styles.th, ...styles.thNumeric }}>Files changed</th>
                    <th style={{ ...styles.th, ...styles.thNumeric }}>Lines changed</th>
                  </tr>
                </thead>
                <tbody>
                  {aggregate.folders.map((folder) => {
                    const color = colorFor(folder.folder);
                    return (
                      <tr
                        key={folder.folder}
                        className="churn-table-row"
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleFolder(folder.folder)}
                      >
                        <td style={styles.td}>
                          <span style={styles.folderCell}>
                            <span
                              style={
                                color
                                  ? { ...styles.swatchDot, background: color }
                                  : styles.swatchDotEmpty
                              }
                            />
                            <span>
                              {isSyntheticBucket(folder.folder)
                                ? folder.folder
                                : (bucketPath(folder.folder, prefix) ?? folder.folder)}
                            </span>
                            {folder.gone && <span style={styles.goneBadge}>GONE</span>}
                          </span>
                        </td>
                        <td style={{ ...styles.td, ...styles.tdNumeric }}>
                          {folder.commits.toLocaleString()}
                        </td>
                        <td style={{ ...styles.td, ...styles.tdNumeric }}>
                          {folder.files.toLocaleString()}
                        </td>
                        <td style={{ ...styles.td, ...styles.tdNumeric }}>
                          {folder.lines.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
