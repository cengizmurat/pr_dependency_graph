import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  fetchWorkflows,
  fetchWorkflowRun,
  fetchWorkflowRunJobs,
  fetchWorkflowRuns,
} from "../api";
import type { WorkflowInfo, WorkflowRunInfo } from "../types";
import { WORKFLOWS_PAGE_SIZE, WORKFLOW_RUNS_PAGE_SIZE } from "../constants";
import { timeAgo } from "../utils";
import RunTimeline, { formatDuration } from "./RunTimeline";
import RuntimeTrendChart, { BackArrow } from "./RuntimeTrendChart";
import { styles } from "./WorkflowsView.styles";

// Runs of the expanded workflow refresh on this interval so new pushes show up
// while the tab sits open; an in-progress run's details refresh faster so its
// timeline grows live.
const RUNS_REFRESH_MS = 30_000;
const ACTIVE_RUN_REFRESH_MS = 10_000;

function dedupeById<T extends { id: number }>(items: T[] | undefined): T[] | undefined {
  if (!items) return undefined;
  const seen = new Set<number>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function runDurationSeconds(run: WorkflowRunInfo): number {
  const start = Date.parse(run.runStartedAt);
  const end =
    run.status === "completed" ? Date.parse(run.updatedAt) : Date.now();
  if (isNaN(start) || isNaN(end)) return 0;
  return Math.max(0, (end - start) / 1000);
}

export default function WorkflowsView({
  token,
  owner,
  repo,
  isMobile,
}: {
  token: string;
  owner: string;
  repo: string;
  isMobile: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const wfParam = parseInt(searchParams.get("wf") ?? "", 10);
  const selectedWorkflowId = isNaN(wfParam) ? null : wfParam;
  const runParam = parseInt(searchParams.get("run") ?? "", 10);
  const selectedRunId = isNaN(runParam) ? null : runParam;

  const selectWorkflow = useCallback(
    (id: number) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (params.get("wf") === String(id)) {
          // Clicking the expanded workflow collapses it (and drops the run).
          params.delete("wf");
          params.delete("run");
        } else {
          params.set("wf", String(id));
          params.delete("run");
        }
        return params;
      });
    },
    [setSearchParams],
  );

  const selectRun = useCallback(
    (id: number) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("run", String(id));
        return params;
      });
    },
    [setSearchParams],
  );

  // Dropping the run keeps the workflow expanded, so the detail pane falls back
  // to the workflow's run-time trend.
  const clearRun = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete("run");
      return params;
    });
  }, [setSearchParams]);

  const workflowsQuery = useInfiniteQuery({
    queryKey: ["workflows", owner, repo],
    queryFn: ({ pageParam }) =>
      fetchWorkflows(token, owner, repo, pageParam, WORKFLOWS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + 1 : undefined,
    staleTime: 5 * 60 * 1000,
  });

  const runsQuery = useInfiniteQuery({
    queryKey: ["workflowRuns", owner, repo, selectedWorkflowId],
    queryFn: ({ pageParam }) =>
      fetchWorkflowRuns(
        token,
        owner,
        repo,
        selectedWorkflowId!,
        pageParam,
        WORKFLOW_RUNS_PAGE_SIZE,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + 1 : undefined,
    enabled: selectedWorkflowId !== null,
    refetchInterval: RUNS_REFRESH_MS,
    staleTime: 10_000,
  });

  const workflows = useMemo(
    () => dedupeById(workflowsQuery.data?.pages.flatMap((p) => p.workflows)),
    [workflowsQuery.data],
  );
  // New runs pushed while paging shift the page boundaries, so the same run
  // can appear at the tail of one page and the head of the next; keep the
  // first occurrence.
  const runs = useMemo(
    () => dedupeById(runsQuery.data?.pages.flatMap((p) => p.runs)),
    [runsQuery.data],
  );

  const selectedWorkflow =
    workflows?.find((w) => w.id === selectedWorkflowId) ?? null;
  const seedRun = runs?.find((r) => r.id === selectedRunId) ?? undefined;

  return (
    <div style={{ ...styles.container, ...(isMobile ? styles.containerMobile : {}) }}>
      <aside style={{ ...styles.sidebar, ...(isMobile ? styles.sidebarMobile : {}) }}>
        <div style={styles.sidebarHeader}>Workflows</div>
        {workflowsQuery.isLoading && (
          <div style={styles.sidebarMessage}>Loading workflows...</div>
        )}
        {workflowsQuery.error && (
          <div style={styles.sidebarError}>
            <span>{(workflowsQuery.error as Error).message}</span>
            <button style={styles.retryBtn} onClick={() => workflowsQuery.refetch()}>
              Retry
            </button>
          </div>
        )}
        {workflows && workflows.length === 0 && (
          <div style={styles.sidebarMessage}>
            This repository has no GitHub Actions workflows.
          </div>
        )}
        {workflows?.map((wf) => (
          <WorkflowListItem
            key={wf.id}
            workflow={wf}
            expanded={wf.id === selectedWorkflowId}
            onToggle={() => selectWorkflow(wf.id)}
          >
            {wf.id === selectedWorkflowId && (
              <div style={styles.runsList}>
                {runsQuery.isLoading && (
                  <div style={styles.sidebarMessage}>Loading runs...</div>
                )}
                {runsQuery.error && (
                  <div style={styles.sidebarError}>
                    <span>{(runsQuery.error as Error).message}</span>
                    <button style={styles.retryBtn} onClick={() => runsQuery.refetch()}>
                      Retry
                    </button>
                  </div>
                )}
                {runs && runs.length === 0 && (
                  <div style={styles.sidebarMessage}>No runs for this workflow yet.</div>
                )}
                {runs?.map((run) => (
                  <RunListItem
                    key={run.id}
                    run={run}
                    selected={run.id === selectedRunId}
                    onSelect={() => selectRun(run.id)}
                  />
                ))}
                {runsQuery.hasNextPage && (
                  <button
                    className="workflow-run-item"
                    style={styles.loadMoreRunsBtn}
                    onClick={() => runsQuery.fetchNextPage()}
                    disabled={runsQuery.isFetchingNextPage}
                  >
                    {runsQuery.isFetchingNextPage ? "Loading…" : "Load more runs"}
                  </button>
                )}
              </div>
            )}
          </WorkflowListItem>
        ))}
        {workflowsQuery.hasNextPage && (
          <button
            className="workflow-list-item"
            style={styles.loadMoreBtn}
            onClick={() => workflowsQuery.fetchNextPage()}
            disabled={workflowsQuery.isFetchingNextPage}
          >
            {workflowsQuery.isFetchingNextPage ? "Loading…" : "Load more workflows"}
          </button>
        )}
      </aside>

      <main style={{ ...styles.detail, ...(isMobile ? styles.detailMobile : {}) }}>
        {/* A run wins over the trend chart, so a shared link carrying only a
            run id still opens that run. */}
        {selectedRunId !== null ? (
          <RunDetail
            token={token}
            owner={owner}
            repo={repo}
            runId={selectedRunId}
            seed={seedRun}
            workflowName={selectedWorkflow?.name}
            onBack={clearRun}
          />
        ) : selectedWorkflowId !== null ? (
          <RuntimeTrendChart
            // Keyed by workflow so nothing from the previous workflow's chart
            // lingers while the new one measures.
            key={selectedWorkflowId}
            token={token}
            owner={owner}
            repo={repo}
            workflowName={selectedWorkflow?.name}
            runs={runs}
            runsLoading={runsQuery.isLoading}
            hasOlderRuns={!!runsQuery.hasNextPage}
            loadingOlderRuns={runsQuery.isFetchingNextPage}
            onLoadOlderRuns={() => runsQuery.fetchNextPage()}
            onSelectRun={selectRun}
          />
        ) : (
          <div style={styles.emptyState}>
            <WorkflowIcon size={28} />
            <span>Pick a workflow to browse its recent runs.</span>
          </div>
        )}
      </main>
    </div>
  );
}

function WorkflowListItem({
  workflow,
  expanded,
  onToggle,
  children,
}: {
  workflow: WorkflowInfo;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <button
        className="workflow-list-item"
        style={styles.workflowItem}
        onClick={onToggle}
        title={workflow.path}
        aria-expanded={expanded}
      >
        <Chevron open={expanded} />
        <WorkflowIcon size={15} />
        <span style={styles.workflowName}>{workflow.name}</span>
        {workflow.state !== "active" && (
          <span style={styles.workflowDisabledBadge}>disabled</span>
        )}
      </button>
      {children}
    </div>
  );
}

function RunListItem({
  run,
  selected,
  onSelect,
}: {
  run: WorkflowRunInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className="workflow-run-item"
      style={{ ...styles.runItem, ...(selected ? styles.runItemSelected : {}) }}
      onClick={onSelect}
      aria-current={selected}
    >
      <span style={styles.runItemIcon}>
        <RunStatusIcon status={run.status} conclusion={run.conclusion} size={14} />
      </span>
      <span style={styles.runItemBody}>
        <span style={styles.runItemTitle}>{run.displayTitle}</span>
        <span style={styles.runItemMeta}>
          #{run.runNumber}
          {run.headBranch ? ` · ${run.headBranch}` : ""} · {timeAgo(run.createdAt)} ·{" "}
          {formatDuration(runDurationSeconds(run))}
        </span>
      </span>
    </button>
  );
}

function RunDetail({
  token,
  owner,
  repo,
  runId,
  seed,
  workflowName,
  onBack,
}: {
  token: string;
  owner: string;
  repo: string;
  runId: number;
  seed: WorkflowRunInfo | undefined;
  workflowName: string | undefined;
  onBack: () => void;
}) {
  const runQuery = useQuery({
    queryKey: ["workflowRun", owner, repo, runId],
    queryFn: () => fetchWorkflowRun(token, owner, repo, runId),
    placeholderData: seed,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "completed"
        ? ACTIVE_RUN_REFRESH_MS
        : false,
  });

  const run = runQuery.data;
  const runInProgress = !!run && run.status !== "completed";

  const jobsQuery = useQuery({
    queryKey: ["workflowRunJobs", owner, repo, runId],
    queryFn: () => fetchWorkflowRunJobs(token, owner, repo, runId),
    refetchInterval: runInProgress ? ACTIVE_RUN_REFRESH_MS : false,
  });

  const jobs = jobsQuery.data;

  return (
    <div>
      <div style={styles.backRow}>
        <button
          className="workflow-back-btn"
          style={styles.backBtn}
          onClick={onBack}
          title="Back to this workflow's run time over time"
        >
          <BackArrow />
          Run time over time
        </button>
      </div>
      {run && (
        <header style={styles.runHeader}>
          <div style={styles.runTitleRow}>
            <RunStatusIcon status={run.status} conclusion={run.conclusion} size={18} />
            <h2 style={styles.runTitle}>{run.displayTitle}</h2>
            <span style={styles.runNumber}>#{run.runNumber}</span>
            <a
              href={run.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.githubRunLink}
            >
              View on GitHub ↗
            </a>
          </div>
          <div style={styles.runMetaRow}>
            {workflowName && <span style={styles.metaItem}>{workflowName}</span>}
            {run.headBranch && <span style={styles.branchChip}>{run.headBranch}</span>}
            <span style={styles.metaItem}>{run.event}</span>
            {run.actorLogin && (
              <span style={styles.metaItem}>
                {run.actorAvatarUrl && (
                  <img src={run.actorAvatarUrl} alt="" style={styles.actorAvatar} />
                )}
                {run.actorLogin}
              </span>
            )}
            <span style={styles.metaItem}>{timeAgo(run.runStartedAt)}</span>
            <span style={styles.metaItem}>
              {runInProgress ? "Running for " : ""}
              {formatDuration(runDurationSeconds(run))}
            </span>
          </div>
        </header>
      )}
      {runQuery.error && !run && (
        <p style={styles.cardError}>{(runQuery.error as Error).message}</p>
      )}

      <div style={styles.timelineCard}>
        {jobsQuery.isLoading && <p style={styles.cardMessage}>Loading run timeline...</p>}
        {jobsQuery.error && (
          <p style={styles.cardError}>{(jobsQuery.error as Error).message}</p>
        )}
        {jobs && jobs.length === 0 && (
          <p style={styles.cardMessage}>This run has no jobs.</p>
        )}
        {jobs && jobs.length > 0 && (
          <RunTimeline
            // Keyed by run so per-job expansion state resets when the viewer
            // switches to a different run.
            key={runId}
            jobs={jobs}
            title={workflowName ?? run?.displayTitle ?? `Run #${runId}`}
          />
        )}
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        flexShrink: 0,
        transition: "transform 0.12s",
        transform: open ? "rotate(90deg)" : "none",
      }}
    >
      <path
        d="M3.5 2L6.5 5L3.5 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkflowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z" />
    </svg>
  );
}

// GitHub-style status icon for a run, job, or step: colored by conclusion once
// completed, otherwise an animated in-progress / queued indicator.
export function RunStatusIcon({
  status,
  conclusion,
  size = 16,
}: {
  status: string;
  conclusion: string | null;
  size?: number;
}) {
  if (status !== "completed") {
    if (status === "in_progress") {
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 16 16"
          fill="none"
          style={{ flexShrink: 0, animation: "spin 1s linear infinite" }}
          aria-label="in progress"
        >
          <circle
            cx="8"
            cy="8"
            r="6.5"
            stroke="var(--color-review-requested)"
            strokeOpacity="0.35"
            strokeWidth="2"
          />
          <path
            d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
            stroke="var(--color-review-requested)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    }
    // queued / waiting / pending / requested
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="var(--color-review-requested)"
        style={{ flexShrink: 0 }}
        aria-label={status}
      >
        <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
      </svg>
    );
  }

  let color = "var(--color-draft)";
  let path =
    // dot in circle (neutral / unknown)
    "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm8.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z";

  switch (conclusion) {
    case "success":
      color = "var(--color-ready)";
      path =
        "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0Z";
      break;
    case "failure":
    case "timed_out":
      color = "var(--color-error)";
      path =
        "M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z";
      break;
    case "cancelled":
      color = "var(--color-draft)";
      path =
        "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM4.25 7.25a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5Z";
      break;
    case "skipped":
      color = "var(--color-draft)";
      path =
        "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.28-2.78a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0Z";
      break;
    case "action_required":
      color = "var(--color-review-requested)";
      path =
        "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm2.293 4.078a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z";
      break;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={color}
      style={{ flexShrink: 0 }}
      aria-label={conclusion ?? status}
    >
      <path d={path} />
    </svg>
  );
}
