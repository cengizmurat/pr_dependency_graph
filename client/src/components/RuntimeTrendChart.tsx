import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchWorkflowRunJobs } from "../api";
import type { WorkflowJob, WorkflowRunInfo } from "../types";
import { niceStep, useContainerWidth } from "./churnChartUtils";
import { formatDuration } from "./RunTimeline";
import { styles } from "./WorkflowsView.styles";

// How a workflow's run time has evolved: one dot per completed run, placed on a
// real time axis and coloured by outcome. The plotted value is the run's active
// time — the wall-clock span during which at least one job was actually
// executing — so waiting for a runner, waiting on a deployment approval and any
// other queued time is left out. That number can only come from the run's jobs,
// so the chart measures each run with the very same jobs query the run timeline
// uses; opening a run afterwards is served from cache.

const HEIGHT = 300;
const PAD_TOP = 16;
const PAD_BOTTOM = 34;
const PAD_LEFT = 62;
const PAD_RIGHT = 18;
const MIN_WIDTH = 420;
const MAX_Y_TICKS = 5;
// Every charted run costs one jobs request. Past the first page the history
// only grows when the viewer asks for it, so this cap is a runaway guard rather
// than a budget — it sits far above any hand-driven amount of paging.
const MAX_CHARTED_RUNS = 200;
// A dot's clickable area is bigger than the dot, so dense stretches stay usable.
const DOT_R = 4.5;
const HIT_R = 9;

// Round durations, in seconds, that read well on an axis.
const DURATION_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600,
  43200, 86400,
];

const DAY_MS = 86_400_000;

type Outcome = "success" | "failure" | "cancelled" | "other";

const OUTCOME_ORDER: Outcome[] = ["success", "failure", "cancelled", "other"];

const OUTCOME_COLOR: Record<Outcome, string> = {
  success: "var(--color-ready)",
  failure: "var(--color-error)",
  cancelled: "var(--color-draft)",
  other: "var(--color-review-requested)",
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  success: "Success",
  failure: "Failed",
  cancelled: "Cancelled",
  other: "Other outcome",
};

function runOutcome(conclusion: string | null): Outcome {
  switch (conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
      return "failure";
    case "cancelled":
      return "cancelled";
    default:
      return "other";
  }
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : t;
}

// The run's pure execution time: the union of the jobs' [started, completed]
// spans. Taking the union rather than the sum keeps parallel jobs from
// double-counting, and taking spans rather than the run's own start/end drops
// the runner waits that sit before, between and inside those spans. Returns
// null when no job of the run ever started, which is the only case with
// nothing to plot.
export function activeRunSeconds(jobs: WorkflowJob[]): number | null {
  const spans: [number, number][] = [];
  for (const job of jobs) {
    const start = parseTime(job.startedAt);
    const end = parseTime(job.completedAt);
    if (start === null || end === null) continue;
    // A skipped job reports a completion before its start; it never ran.
    if (end <= start) continue;
    spans.push([start, end]);
  }
  if (spans.length === 0) return null;

  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [openStart, openEnd] = spans[0];
  for (let i = 1; i < spans.length; i++) {
    const [start, end] = spans[i];
    if (start <= openEnd) {
      openEnd = Math.max(openEnd, end);
      continue;
    }
    total += openEnd - openStart;
    openStart = start;
    openEnd = end;
  }
  total += openEnd - openStart;
  return total / 1000;
}

function durationTicks(maxSeconds: number): number[] {
  const max = Math.max(maxSeconds, 1);
  const step =
    DURATION_STEPS.find((s) => max / s <= MAX_Y_TICKS) ?? niceStep(max, MAX_Y_TICKS);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(value);
  return ticks;
}

// Axis ticks land on round durations, so they drop the zero tail that the
// timeline's own formatter keeps ("8m", not "8m 0s").
function formatTickDuration(seconds: number): string {
  if (seconds <= 0) return "0";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Axis labels tighten as the charted history shortens: a burst of runs inside a
// day needs the clock, a year of runs only needs the month.
function formatAxisTime(ms: number, spanMs: number): string {
  const options: Intl.DateTimeFormatOptions =
    spanMs < 2 * DAY_MS
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : spanMs < 300 * DAY_MS
        ? { month: "short", day: "numeric" }
        : { month: "short", year: "numeric" };
  return new Date(ms).toLocaleString(undefined, options);
}

// Points back the way the chart's history extends: to older runs on the left,
// and out of a run's detail to the chart itself.
export function BackArrow() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        d="M7 2.5 3.5 6 7 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface RunPoint {
  run: WorkflowRunInfo;
  timeMs: number;
  seconds: number;
  outcome: Outcome;
}

export default function RuntimeTrendChart({
  token,
  owner,
  repo,
  workflowName,
  runs,
  runsLoading,
  hasOlderRuns,
  loadingOlderRuns,
  onLoadOlderRuns,
  onSelectRun,
}: {
  token: string;
  owner: string;
  repo: string;
  workflowName: string | undefined;
  runs: WorkflowRunInfo[] | undefined;
  runsLoading: boolean;
  hasOlderRuns: boolean;
  loadingOlderRuns: boolean;
  onLoadOlderRuns: () => void;
  onSelectRun: (id: number) => void;
}) {
  const [containerRef, containerWidth] = useContainerWidth();
  const width = Math.max(containerWidth, MIN_WIDTH);

  // Only finished runs have a run time to compare; one still in flight would
  // plot a number that keeps growing.
  const charted = useMemo(() => {
    const completed = (runs ?? []).filter((r) => r.status === "completed");
    // The list arrives newest first; keep the newest page-worth and chart them
    // oldest to newest.
    return completed
      .slice(0, MAX_CHARTED_RUNS)
      .sort((a, b) => Date.parse(a.runStartedAt) - Date.parse(b.runStartedAt));
  }, [runs]);

  const completedCount = (runs ?? []).filter((r) => r.status === "completed").length;
  const inFlight = (runs?.length ?? 0) - completedCount;
  const skippedForCap = Math.max(0, completedCount - MAX_CHARTED_RUNS);

  const jobQueries = useQueries({
    queries: charted.map((run) => ({
      // Same key as the run timeline's own query, so a run measured here opens
      // instantly and a run opened first is never measured twice.
      queryKey: ["workflowRunJobs", owner, repo, run.id],
      queryFn: () => fetchWorkflowRunJobs(token, owner, repo, run.id),
      // A completed run's jobs are immutable.
      staleTime: Infinity,
    })),
  });

  const pendingCount = jobQueries.filter((q) => q.isPending).length;
  const failedCount = jobQueries.filter((q) => q.isError).length;

  // At most MAX_CHARTED_RUNS points, so these derivations are cheap enough to
  // redo on every render rather than memoise against a query array that is
  // rebuilt each time anyway.
  const points: RunPoint[] = [];
  charted.forEach((run, i) => {
    const jobs = jobQueries[i]?.data;
    if (!jobs) return;
    const seconds = activeRunSeconds(jobs);
    if (seconds === null) return;
    const timeMs = Date.parse(run.runStartedAt);
    if (isNaN(timeMs)) return;
    points.push({ run, timeMs, seconds, outcome: runOutcome(run.conclusion) });
  });

  const counts = new Map<Outcome, number>();
  for (const p of points) counts.set(p.outcome, (counts.get(p.outcome) ?? 0) + 1);

  const geometry = (() => {
    const plotLeft = PAD_LEFT;
    const plotRight = Math.max(plotLeft + 1, width - PAD_RIGHT);
    const plotWidth = plotRight - plotLeft;
    const plotTop = PAD_TOP;
    const plotBottom = HEIGHT - PAD_BOTTOM;
    const plotHeight = plotBottom - plotTop;

    const times = points.map((p) => p.timeMs);
    const minTime = times.length ? Math.min(...times) : 0;
    const maxTime = times.length ? Math.max(...times) : 0;
    const spanMs = maxTime - minTime;

    const ticks = durationTicks(points.reduce((max, p) => Math.max(max, p.seconds), 0));
    const yMax = ticks[ticks.length - 1] || 1;

    // A single run — or a burst that all started within the same second — has
    // no span to spread across, so it sits in the middle.
    const x = (ms: number) =>
      spanMs <= 0 ? plotLeft + plotWidth / 2 : plotLeft + ((ms - minTime) / spanMs) * plotWidth;
    const y = (seconds: number) => plotBottom - (seconds / yMax) * plotHeight;

    const tickCount = Math.max(2, Math.min(6, Math.floor(plotWidth / 120)));
    const timeTicks =
      spanMs <= 0
        ? [minTime]
        : Array.from({ length: tickCount }, (_, i) => minTime + (spanMs * i) / (tickCount - 1));

    return {
      plotLeft,
      plotRight,
      plotTop,
      plotBottom,
      plotWidth,
      plotHeight,
      ticks,
      timeTicks,
      spanMs,
      x,
      y,
    };
  })();

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${geometry.x(p.timeMs)},${geometry.y(p.seconds)}`)
    .join(" ");

  const measuring = pendingCount > 0;

  let body: React.ReactNode;
  if (runsLoading || (measuring && points.length === 0)) {
    body = (
      <p style={styles.cardMessage}>
        {runsLoading
          ? "Loading runs..."
          : `Measuring run times... ${charted.length - pendingCount}/${charted.length}`}
      </p>
    );
  } else if (charted.length === 0) {
    body = (
      <p style={styles.cardMessage}>
        No finished run yet — a run time appears here once a run completes.
      </p>
    );
  } else if (points.length === 0) {
    body = (
      <p style={styles.cardMessage}>
        None of these runs reported job timings, so there is no run time to chart.
      </p>
    );
  } else {
    body = (
      <svg
        width={width}
        height={HEIGHT}
        style={{ display: "block" }}
        role="img"
        aria-label={`Run time of the last ${points.length} runs of ${workflowName ?? "this workflow"}`}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick}>
            <line
              className="churn-grid"
              x1={geometry.plotLeft}
              x2={geometry.plotRight}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
            />
            <text
              className="churn-axis-label"
              x={geometry.plotLeft - 8}
              y={geometry.y(tick) + 3}
              textAnchor="end"
            >
              {formatTickDuration(tick)}
            </text>
          </g>
        ))}

        {geometry.timeTicks.map((tick, i) => (
          <text
            key={tick}
            className="churn-axis-label"
            x={geometry.x(tick)}
            y={HEIGHT - 10}
            textAnchor={
              geometry.timeTicks.length === 1
                ? "middle"
                : i === 0
                  ? "start"
                  : i === geometry.timeTicks.length - 1
                    ? "end"
                    : "middle"
            }
          >
            {formatAxisTime(tick, geometry.spanMs)}
          </text>
        ))}

        {/* The connecting line stays neutral: colour on this chart means
            outcome, and a coloured line between two differing dots would
            claim an outcome for the stretch in between. */}
        {points.length > 1 && <path className="runtime-line" d={linePath} />}

        {points.map((p) => {
          const cx = geometry.x(p.timeMs);
          const cy = geometry.y(p.seconds);
          const started = new Date(p.timeMs).toLocaleString();
          return (
            <g
              key={p.run.id}
              className="runtime-point"
              role="button"
              tabIndex={0}
              aria-label={`Run #${p.run.runNumber}, ${OUTCOME_LABEL[p.outcome].toLowerCase()}, ${formatDuration(p.seconds)}`}
              onClick={() => onSelectRun(p.run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRun(p.run.id);
                }
              }}
            >
              <circle className="runtime-hit" cx={cx} cy={cy} r={HIT_R} />
              <circle className="runtime-dot" cx={cx} cy={cy} r={DOT_R} fill={OUTCOME_COLOR[p.outcome]} />
              <title>
                {`#${p.run.runNumber} ${p.run.displayTitle}\n${OUTCOME_LABEL[p.outcome]} · ${formatDuration(p.seconds)} of run time${p.run.headBranch ? `\n${p.run.headBranch}` : ""}\n${started}\nClick to open this run`}
              </title>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <section style={styles.trendCard}>
      <div style={styles.trendHeader}>
        <h2 style={styles.trendTitle}>
          {workflowName ? `${workflowName} — run time over time` : "Run time over time"}
        </h2>
        <p style={styles.trendSubtitle}>
          Each dot is one finished run, measured as the time its jobs were
          actually executing. Waiting for a runner and any other pending time is
          excluded, so this is pure run time rather than the wall-clock span of
          the run. Click a dot to open that run's timeline.
        </p>
      </div>

      {/* Older runs extend the axis to the left, so the control that fetches
          them sits at that end of the plot. It pulls the next page of the very
          same runs query the sidebar lists, so the list grows with the chart. */}
      <div style={styles.trendPlotRow}>
        {hasOlderRuns && (
          <button
            className="workflow-back-btn"
            style={{
              ...styles.loadOlderBtn,
              ...(loadingOlderRuns ? styles.loadOlderBtnBusy : {}),
            }}
            onClick={onLoadOlderRuns}
            disabled={loadingOlderRuns}
            title="Load the previous batch of runs, extending the chart and the run list"
          >
            <BackArrow />
            {loadingOlderRuns ? "Loading…" : "Load older runs"}
          </button>
        )}
        <div ref={containerRef} style={styles.trendBody}>
          {body}
        </div>
      </div>

      <div style={styles.trendFooter}>
        <ul style={styles.trendLegend}>
          {OUTCOME_ORDER.filter((o) => (counts.get(o) ?? 0) > 0).map((o) => (
            <li key={o} style={styles.trendLegendItem}>
              <span style={{ ...styles.trendLegendDot, background: OUTCOME_COLOR[o] }} />
              {OUTCOME_LABEL[o]} ({counts.get(o)})
            </li>
          ))}
        </ul>
        {(measuring || failedCount > 0 || skippedForCap > 0 || inFlight > 0) && (
          <p style={styles.trendNote}>
            {[
              measuring ? `measuring ${pendingCount} more run${pendingCount === 1 ? "" : "s"}…` : null,
              failedCount > 0
                ? `${failedCount} run${failedCount === 1 ? "" : "s"} could not be measured`
                : null,
              inFlight > 0
                ? `${inFlight} unfinished run${inFlight === 1 ? "" : "s"} left off`
                : null,
              skippedForCap > 0
                ? `charting the ${MAX_CHARTED_RUNS} most recent finished runs`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}
