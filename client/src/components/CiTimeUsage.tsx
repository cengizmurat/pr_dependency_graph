import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { fetchUsageRound, fetchUsageWorkflows, type UsageCursors } from "../api";
import type { WorkflowInfo, WorkflowJob } from "../types";
import { formatDuration } from "./RunTimeline";
import Spinner from "./Spinner";
import { styles } from "./WorkflowsView.styles";

// Where the repository's CI time goes. Every finished run in the picked window
// is measured from its jobs, and each job adds the time it held a runner
// (started -> completed) to its workflow's total. That is the number GitHub
// bills in Actions minutes, so the ranking answers "what costs us the most CI
// time", not "what takes longest to go green": two parallel jobs of 10 minutes
// count 20 minutes here, while the run itself only took 10.

export type UsageWindow = "1d" | "7d" | "30d";

export const USAGE_WINDOWS: { value: UsageWindow; label: string; days: number }[] = [
  { value: "1d", label: "24 hours", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
];

export function parseUsageWindow(value: string | null): UsageWindow {
  return value === "1d" || value === "30d" ? value : "7d";
}

// The walk goes back through every run in the window, so this is only a
// runaway guard for a repository with an unusual amount of CI: past it the walk
// stops and the note under the table says so.
const MAX_MEASURED_RUNS = 20_000;
// How long a bar takes to fill or empty to its new length, and a row to slide
// to its new place, when a batch of runs changes the numbers.
const BAR_TRANSITION_S = 0.6;
const ROW_TRANSITION = { duration: BAR_TRANSITION_S, ease: [0.22, 1, 0.36, 1] as const };

// Jobs listed under an expanded workflow, and rows in the job ranking.
const TOP_JOBS = 10;
const TOP_JOBS_OVERALL = 25;

function parseTime(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : t;
}

// Seconds a job held a runner. A skipped job reports a completion at or before
// its start; it never ran, so it costs nothing.
function jobSeconds(job: WorkflowJob): number {
  const start = parseTime(job.startedAt);
  const end = parseTime(job.completedAt);
  if (start === null || end === null || end <= start) return 0;
  return (end - start) / 1000;
}

interface JobUsage {
  key: string;
  name: string;
  workflowId: number;
  workflowName: string;
  seconds: number;
  // How many times the job ran, and how many of those failed.
  runs: number;
  failures: number;
}

interface WorkflowUsage {
  workflowId: number;
  name: string;
  seconds: number;
  runs: number;
  jobs: JobUsage[];
}

function isFailure(conclusion: string | null): boolean {
  return conclusion === "failure" || conclusion === "timed_out";
}

// A duration of an hour or more also shows its length in minutes, in
// parentheses ("9h 45m (585 min)"), so totals can be compared or copied
// without working out the hours. Shorter durations already read in minutes.
// `withMinutes` false leaves the minutes out, where a row has no room.
function formatUsageDuration(seconds: number, withMinutes = true): string {
  const text = formatDuration(seconds);
  if (seconds < 3600 || !withMinutes) return text;
  return `${text} (${Math.round(seconds / 60).toLocaleString()} min)`;
}

function percent(part: number, total: number): string {
  if (total <= 0) return "0%";
  const p = (part / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

export default function CiTimeUsage({
  token,
  owner,
  repo,
  branch,
  usageWindow,
  onWindowChange,
  workflows,
  onSelectWorkflow,
  isMobile,
}: {
  token: string;
  owner: string;
  repo: string;
  branch: string | null;
  usageWindow: UsageWindow;
  onWindowChange: (window: UsageWindow) => void;
  // Used for names when a run carries none, and to know which rows can be
  // opened in the sidebar.
  workflows: WorkflowInfo[] | undefined;
  onSelectWorkflow: (id: number) => void;
  // On a phone, job rows leave the minutes out: their names are long and the
  // row is narrow. The total and the workflow rows keep them.
  isMobile: boolean;
}) {
  const jobMinutes = !isMobile;
  const [mode, setMode] = useState<"workflows" | "jobs">("workflows");
  const [expanded, setExpanded] = useState<number | null>(null);

  const days = USAGE_WINDOWS.find((w) => w.value === usageWindow)?.days ?? 7;

  // Rounded down to the hour, and part of the query key: every round of one
  // walk uses the same start, and opening the same window again within the
  // hour is served from cache.
  const sinceMs = useMemo(() => {
    const since = new Date(Date.now() - days * 86_400_000);
    since.setMinutes(0, 0, 0);
    return since.getTime();
  }, [days]);

  // Every workflow, disabled ones included, with the GraphQL id the walk
  // needs. The sidebar's list is paged, so it cannot be used here.
  const workflowsQuery = useQuery({
    queryKey: ["usageWorkflows", owner, repo],
    queryFn: () => fetchUsageWorkflows(token, owner, repo),
    staleTime: 5 * 60 * 1000,
  });
  const usageWorkflows = workflowsQuery.data;

  // One page of this query is one round of the walk: the next 50 runs of each
  // workflow still inside the window. Pages are fetched one after another (see
  // the effect below) until every workflow has gone past the window's start,
  // and the table fills in as they arrive.
  const runsKey = useMemo(
    () => ["ciUsage", owner, repo, sinceMs, branch] as const,
    [owner, repo, sinceMs, branch],
  );
  const runsQuery = useInfiniteQuery({
    queryKey: runsKey,
    queryFn: ({ pageParam, signal }) =>
      fetchUsageRound(token, owner, repo, usageWorkflows!, pageParam, sinceMs, branch, signal),
    initialPageParam: null as UsageCursors | null,
    getNextPageParam: (last) => (Object.keys(last.next).length > 0 ? last.next : undefined),
    enabled: !!usageWorkflows,
    staleTime: 5 * 60 * 1000,
  });

  // Runs come back in cursor order, so none repeats; the set is a guard all
  // the same, as a run counted twice would skew the ranking.
  const runs = useMemo(() => {
    const seen = new Set<number>();
    const out = [];
    for (const page of runsQuery.data?.pages ?? []) {
      for (const run of page.runs) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        out.push(run);
      }
    }
    return out;
  }, [runsQuery.data]);

  const capped = runs.length >= MAX_MEASURED_RUNS;

  // The viewer can stop the walk once the ranking is enough for them. The
  // round in flight is cancelled, which keeps the pages already loaded, and no
  // next round starts. Remembered by query key, so another window or branch
  // starts its own walk; "Resume" picks up from the last round kept.
  const queryClient = useQueryClient();
  const keyString = JSON.stringify(runsKey);
  const [stoppedKey, setStoppedKey] = useState<string | null>(null);
  const stopped = stoppedKey === keyString;
  const stopLoading = () => {
    setStoppedKey(keyString);
    queryClient.cancelQueries({ queryKey: runsKey });
  };
  const resumeLoading = () => setStoppedKey(null);

  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = runsQuery;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError && !capped && !stopped) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, capped, stopped, fetchNextPage]);

  // Loading covers every stage: the workflow list, the first round (the runs
  // query waits on that list, so it is not fetching yet), and every round
  // after it. Without the first two the panel would read "no finished run"
  // before a single run was asked for.
  const walking =
    !stopped &&
    (workflowsQuery.isPending ||
      (!!usageWorkflows && runsQuery.isPending && !runsQuery.isError) ||
      (!!hasNextPage && !isError && !capped) ||
      runsQuery.isFetching);
  const pages = runsQuery.data?.pages ?? [];
  const reachedIso = pages.reduce<string | null>((oldest, p) => {
    if (!p.oldestCreatedAt) return oldest;
    return !oldest || p.oldestCreatedAt < oldest ? p.oldestCreatedAt : oldest;
  }, null);
  const reached = reachedIso
    ? new Date(reachedIso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  // How far back the walk has gone, as a share of the window. Runs come newest
  // first, so the oldest one reached tells how much of the window is covered.
  // It is a lower bound: a workflow that is already done may reach no further.
  const progress = reachedIso
    ? Math.min(1, Math.max(0, (Date.now() - Date.parse(reachedIso)) / (Date.now() - sinceMs)))
    : 0;

  const workflowNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const wf of usageWorkflows ?? []) names.set(wf.id, wf.name);
    return names;
  }, [usageWorkflows]);
  // Only a workflow the sidebar lists can be opened from a row.
  const sidebarIds = useMemo(() => new Set((workflows ?? []).map((w) => w.id)), [workflows]);

  // A single pass over the runs' jobs; cheap next to the requests behind it.
  const byWorkflow = new Map<number, WorkflowUsage>();
  const jobMap = new Map<string, JobUsage>();
  let totalSeconds = 0;

  for (const run of runs) {
    const jobs = run.jobs;
    const name = workflowNames.get(run.workflowId) ?? `Workflow ${run.workflowId}`;
    let wf = byWorkflow.get(run.workflowId);
    if (!wf) {
      wf = { workflowId: run.workflowId, name, seconds: 0, runs: 0, jobs: [] };
      byWorkflow.set(run.workflowId, wf);
    }
    wf.runs++;
    for (const job of jobs) {
      const seconds = jobSeconds(job);
      if (seconds <= 0) continue;
      wf.seconds += seconds;
      totalSeconds += seconds;
      const key = `${run.workflowId}\u0000${job.name}`;
      let usage = jobMap.get(key);
      if (!usage) {
        usage = {
          key,
          name: job.name,
          workflowId: run.workflowId,
          workflowName: name,
          seconds: 0,
          runs: 0,
          failures: 0,
        };
        jobMap.set(key, usage);
      }
      usage.seconds += seconds;
      usage.runs++;
      if (isFailure(job.conclusion)) usage.failures++;
    }
  }

  const allJobs = [...jobMap.values()].sort((a, b) => b.seconds - a.seconds);
  for (const job of allJobs) byWorkflow.get(job.workflowId)?.jobs.push(job);
  const workflowRows = [...byWorkflow.values()]
    .filter((wf) => wf.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
  const jobRows = allJobs.slice(0, TOP_JOBS_OVERALL);

  const topSeconds = mode === "workflows" ? (workflowRows[0]?.seconds ?? 0) : (jobRows[0]?.seconds ?? 0);
  const knownWorkflow = (id: number) => sidebarIds.has(id);
  const loadError = (workflowsQuery.error ?? runsQuery.error) as Error | null;

  let body: React.ReactNode;
  if (loadError && runs.length === 0) {
    body = (
      <div style={{ ...styles.cardError, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <span>{loadError.message}</span>
        <button
          style={styles.retryBtn}
          onClick={() => (workflowsQuery.error ? workflowsQuery.refetch() : runsQuery.refetch())}
        >
          Retry
        </button>
      </div>
    );
  } else if (walking && totalSeconds === 0) {
    // Nothing to rank yet: a large spinner in the middle of the card, so the
    // empty space reads as "working" rather than "empty".
    body = (
      <div style={styles.usageLoadingBlock} role="status">
        <Spinner size={36} color="var(--color-link)" />
        <span>
          {workflowsQuery.isPending
            ? "Loading workflows…"
            : runs.length > 0
              ? `Loading runs… ${runs.length} so far`
              : "Loading runs…"}
        </span>
      </div>
    );
  } else if (runs.length === 0) {
    body = (
      <p style={styles.cardMessage}>
        {branch
          ? `No finished run on ${branch} in the last ${days === 1 ? "24 hours" : `${days} days`}.`
          : `No finished run in the last ${days === 1 ? "24 hours" : `${days} days`}.`}
      </p>
    );
  } else if (totalSeconds === 0) {
    body = (
      <p style={styles.cardMessage}>
        None of these runs reported job timings, so there is no run time to rank.
      </p>
    );
  } else if (mode === "workflows") {
    body = (
      <ol style={styles.usageList}>
        {workflowRows.map((wf) => {
          const open = expanded === wf.workflowId;
          return (
            // A batch can change the order, and the row then slides to its
            // new place. Only the position animates: a size animation would
            // stretch the text while a workflow opens.
            <motion.li
              key={wf.workflowId}
              layout="position"
              transition={ROW_TRANSITION}
              style={styles.usageItem}
            >
              <button
                className="workflow-run-item"
                style={styles.usageRow}
                onClick={() => setExpanded(open ? null : wf.workflowId)}
                aria-expanded={open}
                title={open ? "Hide this workflow's jobs" : "Show which jobs use this workflow's time"}
              >
                <Chevron open={open} />
                <UsageBar
                  name={wf.name}
                  seconds={wf.seconds}
                  max={topSeconds}
                  share={percent(wf.seconds, totalSeconds)}
                  meta={`${wf.runs} run${wf.runs === 1 ? "" : "s"} · ${formatUsageDuration(wf.seconds / wf.runs)} per run`}
                />
              </button>
              {open && (
                <div style={styles.usageJobs}>
                  {wf.jobs.slice(0, TOP_JOBS).map((job) => (
                    <div key={job.key} style={styles.usageJobRow}>
                      <UsageBar
                        name={job.name}
                        seconds={job.seconds}
                        max={wf.jobs[0]?.seconds ?? 0}
                        share={percent(job.seconds, wf.seconds)}
                        meta={jobMeta(job, jobMinutes)}
                        withMinutes={jobMinutes}
                        small
                      />
                    </div>
                  ))}
                  {wf.jobs.length > TOP_JOBS && (
                    <p style={styles.usageMore}>
                      and {wf.jobs.length - TOP_JOBS} more job
                      {wf.jobs.length - TOP_JOBS === 1 ? "" : "s"}
                    </p>
                  )}
                  {knownWorkflow(wf.workflowId) && (
                    <button
                      style={styles.usageOpenBtn}
                      onClick={() => onSelectWorkflow(wf.workflowId)}
                    >
                      Open this workflow's run time over time →
                    </button>
                  )}
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
    );
  } else {
    body = (
      <ol style={styles.usageList}>
        {jobRows.map((job) => (
          <motion.li
            key={job.key}
            layout="position"
            transition={ROW_TRANSITION}
            style={styles.usageItem}
          >
            <div style={{ ...styles.usageRow, cursor: "default" }}>
              <UsageBar
                name={job.name}
                caption={job.workflowName}
                seconds={job.seconds}
                max={topSeconds}
                share={percent(job.seconds, totalSeconds)}
                meta={jobMeta(job, jobMinutes)}
                withMinutes={jobMinutes}
              />
            </div>
          </motion.li>
        ))}
      </ol>
    );
  }

  const notes = [
    loadError && runs.length > 0 ? `stopped early: ${loadError.message}` : null,
    capped ? `stopped after the ${MAX_MEASURED_RUNS} most recent runs` : null,
  ].filter(Boolean);

  return (
    <section style={styles.trendCard}>
      <div style={styles.trendHeader}>
        <h2 style={styles.trendTitle}>
          CI time usage
          {walking && <Spinner size={16} color="var(--color-link)" label="Loading" />}
          {branch && (
            <span style={styles.trendTitleBranch} title={`Runs on ${branch} only`}>
              {branch}
            </span>
          )}
        </h2>
        <p style={styles.trendSubtitle}>
          Which workflows and jobs use the most runner time. Each job adds the
          time it ran on a runner, so jobs that run in parallel all count. This is
          close to what GitHub bills as Actions minutes. Only finished runs are
          counted, and a re-run counts only its latest attempt.
        </p>
      </div>

      <div style={styles.usageControls}>
        <div style={styles.usageSegment} role="group" aria-label="Time window">
          {USAGE_WINDOWS.map((w) => (
            <button
              key={w.value}
              style={{
                ...styles.usageSegmentBtn,
                ...(w.value === usageWindow ? styles.usageSegmentBtnActive : {}),
              }}
              aria-pressed={w.value === usageWindow}
              onClick={() => onWindowChange(w.value)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div style={styles.usageSegment} role="group" aria-label="Rank by">
          {(["workflows", "jobs"] as const).map((m) => (
            <button
              key={m}
              style={{
                ...styles.usageSegmentBtn,
                ...(m === mode ? styles.usageSegmentBtnActive : {}),
              }}
              aria-pressed={m === mode}
              onClick={() => setMode(m)}
            >
              {m === "workflows" ? "By workflow" : "By job"}
            </button>
          ))}
        </div>
        {totalSeconds > 0 && (
          <span style={styles.usageTotal}>
            Total{walking ? " so far" : ""}: <strong>{formatUsageDuration(totalSeconds)}</strong> over{" "}
            {runs.length} run{runs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Shown above the table while older runs are still coming, so the
          ranking is not read as final: the numbers will still grow. */}
      {walking && totalSeconds > 0 && (
        <div style={styles.usageLoadingBanner} role="status">
          <div style={styles.usageLoadingBannerRow}>
            <Spinner size={18} color="var(--color-link)" />
            <span style={styles.usageLoadingText}>
              Still loading older runs — the numbers below will grow.{" "}
              <strong>{runs.length}</strong> run{runs.length === 1 ? "" : "s"} so far
              {reached ? `, back to ${reached}` : ""}.
            </span>
            <button
              style={styles.usageStopBtn}
              onClick={stopLoading}
              title="Stop loading older runs and keep the ranking as it is now"
            >
              Stop loading
            </button>
          </div>
          <div
            style={styles.usageProgressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Share of the time window loaded"
          >
            <div
              className="usage-progress-fill"
              style={{ ...styles.usageProgressFill, width: `${Math.max(4, progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {body}

      {stopped && hasNextPage && (
        <div style={styles.usageStoppedNote}>
          <span>
            Loading stopped: this ranking covers the {runs.length} most recent run
            {runs.length === 1 ? "" : "s"}
            {reached ? `, back to ${reached}` : ""}, not the whole window.
          </span>
          <button style={styles.usageOpenBtn} onClick={resumeLoading}>
            Resume loading
          </button>
        </div>
      )}

      {notes.length > 0 && (
        <div style={styles.trendFooter}>
          <p style={styles.trendNote}>{notes.join(" · ")}</p>
        </div>
      )}
    </section>
  );
}

function jobMeta(job: JobUsage, withMinutes: boolean): string {
  const parts = [
    `${job.runs} run${job.runs === 1 ? "" : "s"}`,
    `${formatUsageDuration(job.seconds / job.runs, withMinutes)} each`,
  ];
  if (job.failures > 0) parts.push(`${job.failures} failed`);
  return parts.join(" · ");
}

function UsageBar({
  name,
  caption,
  seconds,
  max,
  share,
  meta,
  small = false,
  withMinutes = true,
}: {
  name: string;
  caption?: string;
  seconds: number;
  max: number;
  share: string;
  meta: string;
  small?: boolean;
  withMinutes?: boolean;
}) {
  const width = max > 0 ? Math.max(1, (seconds / max) * 100) : 0;
  // The bar starts empty and is given its length one frame later, so a new
  // row fills in rather than appearing full. After that, every new length is
  // reached through the CSS transition on the width, so a batch that changes
  // the numbers makes the bars fill and empty instead of jumping.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(width));
    return () => cancelAnimationFrame(frame);
  }, [width]);
  return (
    <span style={styles.usageBarBody}>
      <span style={styles.usageBarHead}>
        <span style={{ ...styles.usageName, ...(small ? styles.usageNameSmall : {}) }} title={name}>
          {name}
          {caption && <span style={styles.usageCaption}> · {caption}</span>}
        </span>
        <span style={styles.usageValue}>
          {formatUsageDuration(seconds, withMinutes)}
          <span style={styles.usageShare}>{share}</span>
        </span>
      </span>
      <span style={{ ...styles.usageTrack, ...(small ? styles.usageTrackSmall : {}) }}>
        <span
          style={{
            ...styles.usageFill,
            width: `${shown}%`,
            transition: `width ${BAR_TRANSITION_S}s cubic-bezier(0.22, 1, 0.36, 1)`,
          }}
        />
      </span>
      <span style={styles.usageMeta}>{meta}</span>
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        marginTop: 3,
        transition: "transform 0.15s",
        transform: open ? "rotate(90deg)" : "none",
        color: "var(--color-text-secondary)",
      }}
    >
      <path
        d="M4.5 2.5 8 6 4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
