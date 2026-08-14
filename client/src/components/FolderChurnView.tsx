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

  const churn = useFolderChurn({
    token,
    owner,
    repo,
    branch,
    since: fromDay === null ? null : isoFromDayStart(fromDay),
    until: isoFromDayEnd(toDay),
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
  const [capNotice, setCapNotice] = useState(false);

  const toggleFolder = useCallback((folder: string) => {
    setCapNotice(false);
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
  // starts again — seeded with the busiest few, and only once the fetch has
  // finished so the seed is not chosen from a partial history.
  useEffect(() => {
    if (seededPrefixRef.current === prefix) return;
    if (!aggregate || !data || data.resolved < data.needed) return;
    setCharted(
      aggregate.folders
        .slice(0, CHURN_DEFAULT_SERIES)
        .map((f, slot) => ({ folder: f.folder, slot })),
    );
    setCapNotice(false);
    seededPrefixRef.current = prefix;
  }, [prefix, aggregate, data]);

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
  const isStreaming = !!data && data.resolved < data.needed;

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

      {!churn.error && churn.needsConfirm && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>
            {churn.totalCount?.toLocaleString()} commits in this interval
          </h3>
          <p style={styles.panelText}>
            GitHub's API returns a commit's file list one commit at a time, so
            this needs about {churn.totalCount?.toLocaleString()} requests
            against an hourly budget of 5,000. They are cached by commit, so it
            is paid once — but a narrower interval or a shorter branch gets you
            an answer sooner.
          </p>
          <button style={styles.primaryBtn} onClick={churn.confirm}>
            Load {churn.totalCount?.toLocaleString()} commits
          </button>
        </div>
      )}

      {!churn.error && !churn.needsConfirm && (churn.isCounting || churn.isLoading) && (
        <div style={styles.panel}>
          <h3 style={styles.panelTitle}>
            {churn.isCounting ? "Counting commits…" : "Reading commit contents…"}
          </h3>
          <p style={styles.panelText}>
            {data
              ? `${data.resolved.toLocaleString()} of ${data.needed.toLocaleString()} commits read.`
              : "Asking GitHub how much history this interval covers."}
          </p>
          {data && data.needed > 0 && (
            <div style={styles.progressTrack}>
              <div style={{ ...styles.progressFill, width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      {!churn.error && !churn.needsConfirm && aggregate && !pathExists && suggestions && (
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

      {!churn.error && !churn.needsConfirm && aggregate && pathExists && !pathHadChurn && (
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

      {!churn.error && !churn.needsConfirm && aggregate && pathExists && pathHadChurn && (
        <>
          {isStreaming && (
            <p style={styles.note}>
              Still reading commits — {data!.resolved.toLocaleString()} of{" "}
              {data!.needed.toLocaleString()} so far, so these numbers will grow.
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
