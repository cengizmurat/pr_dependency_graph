import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { fetchRepoWorkflowRuns, fetchRunJobTimings } from "../api";
import type { WorkflowInfo, WorkflowJob, WorkflowRunInfo } from "../types";
import { formatDuration } from "./RunTimeline";
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

// The run list is paged through REST, 100 runs a request, and GitHub stops a
// filtered run list at 1000 results. The note under the table says when the
// window held more than this.
const MAX_MEASURED_RUNS = 1000;
// Runs whose jobs are fetched in one GraphQL request. At 50 runs of up to 100
// jobs each, a request stays far below GitHub's node limit and costs about one
// point of the GraphQL rate limit.
const JOBS_BATCH_SIZE = 50;
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
}) {
  const [mode, setMode] = useState<"workflows" | "jobs">("workflows");
  const [expanded, setExpanded] = useState<number | null>(null);

  const days = USAGE_WINDOWS.find((w) => w.value === usageWindow)?.days ?? 7;

  const runsQuery = useQuery({
    queryKey: ["repoWorkflowRuns", owner, repo, usageWindow, branch],
    queryFn: () => {
      // Rounded to the hour so the key's data matches what was asked for, and
      // a refetch a minute later does not walk a slightly different window.
      const since = new Date(Date.now() - days * 86_400_000);
      since.setMinutes(0, 0, 0);
      return fetchRepoWorkflowRuns(token, owner, repo, since, branch, MAX_MEASURED_RUNS);
    },
    staleTime: 5 * 60 * 1000,
  });

  const runs = runsQuery.data?.runs;

  // The window's runs, cut into batches. A batch is keyed by the runs it
  // holds, so the same window opened again is served from cache, and a refetch
  // that brings a new run only fetches the batches that changed.
  const batches = useMemo(() => {
    const out: WorkflowRunInfo[][] = [];
    for (let i = 0; i < (runs?.length ?? 0); i += JOBS_BATCH_SIZE) {
      out.push(runs!.slice(i, i + JOBS_BATCH_SIZE));
    }
    return out;
  }, [runs]);

  const batchQueries = useQueries({
    queries: batches.map((batch) => ({
      queryKey: ["runJobTimings", owner, repo, batch.map((r) => r.id).join(",")],
      queryFn: () => fetchRunJobTimings(token, owner, repo, batch),
      // A completed run's jobs do not change.
      staleTime: Infinity,
    })),
  });

  // One entry per run, in the order of `runs`, so the counts and the loop
  // below read the same way they would with one query per run.
  const jobQueries = batches.flatMap((batch, b) => {
    const q = batchQueries[b];
    return batch.map((run) => ({
      isPending: !!q?.isPending,
      isError: !!q?.isError,
      isSuccess: !!q?.isSuccess,
      data: q?.data?.get(run.id),
    }));
  });

  const pendingCount = jobQueries.filter((q) => q.isPending).length;
  const failedCount = jobQueries.filter((q) => q.isError).length;
  const measuredCount = jobQueries.filter((q) => q.isSuccess).length;

  const workflowNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const wf of workflows ?? []) names.set(wf.id, wf.name);
    return names;
  }, [workflows]);

  // Rebuilt on every render: the query array is new each time anyway, and the
  // work is a single pass over at most a few thousand jobs.
  const byWorkflow = new Map<number, WorkflowUsage>();
  const jobMap = new Map<string, JobUsage>();
  let totalSeconds = 0;

  (runs ?? []).forEach((run: WorkflowRunInfo, i) => {
    const jobs = jobQueries[i]?.data;
    if (!jobs) return;
    const name =
      workflowNames.get(run.workflowId) ?? run.workflowName ?? `Workflow ${run.workflowId}`;
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
  });

  const allJobs = [...jobMap.values()].sort((a, b) => b.seconds - a.seconds);
  for (const job of allJobs) byWorkflow.get(job.workflowId)?.jobs.push(job);
  const workflowRows = [...byWorkflow.values()]
    .filter((wf) => wf.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
  const jobRows = allJobs.slice(0, TOP_JOBS_OVERALL);

  const topSeconds = mode === "workflows" ? (workflowRows[0]?.seconds ?? 0) : (jobRows[0]?.seconds ?? 0);
  const knownWorkflow = (id: number) => workflowNames.has(id);

  const totalCount = runsQuery.data?.totalCount ?? 0;
  const cutOff = runs ? Math.max(0, totalCount - runs.length) : 0;

  let body: React.ReactNode;
  if (runsQuery.isLoading) {
    body = <p style={styles.cardMessage}>Loading runs...</p>;
  } else if (runsQuery.error) {
    body = (
      <div style={{ ...styles.cardError, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <span>{(runsQuery.error as Error).message}</span>
        <button style={styles.retryBtn} onClick={() => runsQuery.refetch()}>
          Retry
        </button>
      </div>
    );
  } else if (runs && runs.length === 0) {
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
        {pendingCount > 0
          ? `Measuring runs... ${measuredCount}/${runs?.length ?? 0}`
          : "None of these runs reported job timings, so there is no run time to rank."}
      </p>
    );
  } else if (mode === "workflows") {
    body = (
      <ol style={styles.usageList}>
        {workflowRows.map((wf) => {
          const open = expanded === wf.workflowId;
          return (
            <li key={wf.workflowId} style={styles.usageItem}>
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
                  meta={`${wf.runs} run${wf.runs === 1 ? "" : "s"} · ${formatDuration(wf.seconds / wf.runs)} per run`}
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
                        meta={jobMeta(job)}
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
            </li>
          );
        })}
      </ol>
    );
  } else {
    body = (
      <ol style={styles.usageList}>
        {jobRows.map((job) => (
          <li key={job.key} style={styles.usageItem}>
            <div style={{ ...styles.usageRow, cursor: "default" }}>
              <UsageBar
                name={job.name}
                caption={job.workflowName}
                seconds={job.seconds}
                max={topSeconds}
                share={percent(job.seconds, totalSeconds)}
                meta={jobMeta(job)}
              />
            </div>
          </li>
        ))}
      </ol>
    );
  }

  const notes = [
    pendingCount > 0 ? `measuring ${pendingCount} more run${pendingCount === 1 ? "" : "s"}…` : null,
    failedCount > 0
      ? `${failedCount} run${failedCount === 1 ? "" : "s"} could not be measured`
      : null,
    cutOff > 0 ? `only the ${runs?.length} most recent of ${totalCount} runs are counted` : null,
  ].filter(Boolean);

  return (
    <section style={styles.trendCard}>
      <div style={styles.trendHeader}>
        <h2 style={styles.trendTitle}>
          CI time usage
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
            Total: <strong>{formatDuration(totalSeconds)}</strong> over {measuredCount} run
            {measuredCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {body}

      {notes.length > 0 && (
        <div style={styles.trendFooter}>
          <p style={styles.trendNote}>{notes.join(" · ")}</p>
        </div>
      )}
    </section>
  );
}

function jobMeta(job: JobUsage): string {
  const parts = [
    `${job.runs} run${job.runs === 1 ? "" : "s"}`,
    `${formatDuration(job.seconds / job.runs)} each`,
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
}: {
  name: string;
  caption?: string;
  seconds: number;
  max: number;
  share: string;
  meta: string;
  small?: boolean;
}) {
  const width = max > 0 ? Math.max(1, (seconds / max) * 100) : 0;
  return (
    <span style={styles.usageBarBody}>
      <span style={styles.usageBarHead}>
        <span style={{ ...styles.usageName, ...(small ? styles.usageNameSmall : {}) }} title={name}>
          {name}
          {caption && <span style={styles.usageCaption}> · {caption}</span>}
        </span>
        <span style={styles.usageValue}>
          {formatDuration(seconds)}
          <span style={styles.usageShare}>{share}</span>
        </span>
      </span>
      <span style={{ ...styles.usageTrack, ...(small ? styles.usageTrackSmall : {}) }}>
        <span style={{ ...styles.usageFill, width: `${width}%` }} />
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
