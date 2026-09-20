import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import {
  fetchBranches,
  fetchWorkflows,
  fetchWorkflowRun,
  fetchWorkflowRunJobs,
  fetchWorkflowRuns,
  searchBranches,
} from "../api";
import type { WorkflowRunInfo } from "../types";
import {
  BRANCH_SEARCH_DEBOUNCE_MS,
  BRANCH_SEARCH_LIMIT,
  WORKFLOWS_PAGE_SIZE,
  WORKFLOW_RUNS_PAGE_SIZE,
} from "../constants";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useThemeColor } from "../hooks/useThemeColor";
import { timeAgo } from "../utils";
import { HookSidebar } from "@/components/ui/hook-sidebar";
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
  // The rail that hooks into the selected workflow is drawn in the accent.
  const accent = useThemeColor("--color-link", "#0969da");

  const wfParam = parseInt(searchParams.get("wf") ?? "", 10);
  const selectedWorkflowId = isNaN(wfParam) ? null : wfParam;
  const runParam = parseInt(searchParams.get("run") ?? "", 10);
  const selectedRunId = isNaN(runParam) ? null : runParam;
  // Its own parameter rather than the folder-churn tab's `branch`: the two
  // views share one query string, and a branch picked for churn is not a
  // filter the viewer asked this tab for.
  const branchFilter = searchParams.get("wfBranch") || null;

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

  // Changing the filter drops the open run: it belongs to the branch that was
  // listed before, so keeping it open would show a run the list no longer has.
  // The expanded workflow stays, so the viewer lands on its trend for the new
  // branch.
  const selectBranch = useCallback(
    (name: string | null) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (name) params.set("wfBranch", name);
        else params.delete("wfBranch");
        params.delete("run");
        return params;
      });
    },
    [setSearchParams],
  );

  const workflowsQuery = useInfiniteQuery({
    queryKey: ["workflows", owner, repo],
    queryFn: ({ pageParam }) =>
      fetchWorkflows(token, owner, repo, pageParam, WORKFLOWS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.hasMore ? lastPageParam + 1 : undefined,
    staleTime: 5 * 60 * 1000,
  });

  // Same key as the folder-churn tab's branch list, so whichever tab is opened
  // first pays for it and the other is served from cache. It fills the closed
  // dropdown; searching goes to GitHub, below.
  const branchesQuery = useQuery({
    queryKey: ["branches", owner, repo],
    queryFn: () => fetchBranches(token, owner, repo),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  const [branchSearch, setBranchSearch] = useState("");
  const settledSearch = useDebouncedValue(branchSearch.trim(), BRANCH_SEARCH_DEBOUNCE_MS);

  // The search goes to GitHub so a branch past the end of the fetched list is
  // still findable. Only the settled text is a query key, so a burst of
  // keystrokes costs one request; the previous matches stay on screen while
  // the next ones load, so the dropdown never blinks empty mid-word.
  const branchSearchQuery = useQuery({
    queryKey: ["branchSearch", owner, repo, settledSearch],
    queryFn: () => searchBranches(token, owner, repo, settledSearch, BRANCH_SEARCH_LIMIT),
    enabled: !!token && settledSearch !== "",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  });

  const pendingSearch = branchSearch.trim();
  const searching =
    pendingSearch !== "" &&
    (pendingSearch !== settledSearch || branchSearchQuery.isFetching);

  const runsQuery = useInfiniteQuery({
    queryKey: ["workflowRuns", owner, repo, selectedWorkflowId, branchFilter],
    queryFn: ({ pageParam }) =>
      fetchWorkflowRuns(
        token,
        owner,
        repo,
        selectedWorkflowId!,
        pageParam,
        WORKFLOW_RUNS_PAGE_SIZE,
        branchFilter,
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

  // What GitHub returned for the current search. Held apart from the options so
  // the local filter below can let these through on their own account.
  const matched = useMemo(
    () => new Set(settledSearch === "" ? [] : (branchSearchQuery.data ?? [])),
    [branchSearchQuery.data, settledSearch],
  );

  const branchOptions = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    // Matches first, so a branch found by searching heads the dropdown; with no
    // search they are empty and the fetched list keeps its own order.
    for (const name of [...matched, ...(branchesQuery.data?.names ?? [])]) {
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    // A filter can name a branch neither list holds: a merged pull request
    // leaves runs behind after its branch is deleted, and a repository with
    // many branches hands back a truncated list. Keeping the current filter as
    // an option means such a link still reads as the branch it filters on
    // instead of an empty box.
    if (branchFilter && !seen.has(branchFilter)) names.unshift(branchFilter);
    return names.map((name) => ({ value: name, label: name }));
  }, [branchesQuery.data, matched, branchFilter]);

  const selectedWorkflow =
    workflows?.find((w) => w.id === selectedWorkflowId) ?? null;
  const seedRun = runs?.find((r) => r.id === selectedRunId) ?? undefined;

  return (
    <div style={{ ...styles.container, ...(isMobile ? styles.containerMobile : {}) }}>
      <aside style={{ ...styles.sidebar, ...(isMobile ? styles.sidebarMobile : {}) }}>
        <div style={styles.sidebarTop}>
          <div style={styles.sidebarHeader}>Workflows</div>
          <div style={styles.branchFilter}>
            <label style={styles.branchFilterLabel} htmlFor="workflow-branch-filter">
              Branch
            </label>
            <Select
              id="workflow-branch-filter"
              size="small"
              style={styles.branchFilterSelect}
              showSearch
              allowClear
              value={branchFilter ?? undefined}
              loading={branchesQuery.isLoading || searching}
              placeholder="All branches"
              options={branchOptions}
              searchValue={branchSearch}
              onSearch={setBranchSearch}
              onChange={(value) => {
                setBranchSearch("");
                selectBranch(value ?? null);
              }}
              // Closing drops the typed text, so reopening starts from the
              // whole list rather than the last search.
              onOpenChange={(open) => {
                if (!open) setBranchSearch("");
              }}
              filterOption={(input, option) => {
                const needle = input.trim().toLowerCase();
                if (needle === "") return true;
                const name = option?.value ?? "";
                // Whatever GitHub matched belongs in the list on its own
                // account; the rest of the fetched list is filtered here, on
                // any part of the name, so a viewer who knows only the middle
                // of a long branch name still finds it while typing.
                return matched.has(name) || name.toLowerCase().includes(needle);
              }}
              notFoundContent={
                branchesQuery.isLoading
                  ? "Loading branches..."
                  : searching
                    ? "Searching branches..."
                    : "No branch matches."
              }
            />
          </div>
          {branchesQuery.error && (
            <div style={styles.branchFilterError}>
              Could not load branches: {(branchesQuery.error as Error).message}
            </div>
          )}
          {branchSearchQuery.error && (
            <div style={styles.branchFilterError}>
              Could not search branches: {(branchSearchQuery.error as Error).message}
            </div>
          )}
          {branchesQuery.data?.truncated && (
            <div style={styles.branchFilterNote}>
              This repository has more branches than the list could fetch — type to
              search all of them.
            </div>
          )}
        </div>
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
        {workflows && workflows.length > 0 && (
          // The workflow names, with a dashed rail that hooks into the one
          // that is open; its runs unfold straight under it, inside the hook.
          <HookSidebar
            aria-label="Workflows"
            items={workflows.map((wf) => ({
              label: wf.name,
              title: wf.path,
              badge: wf.state !== "active" ? "disabled" : undefined,
            }))}
            value={workflows.findIndex((wf) => wf.id === selectedWorkflowId)}
            onChange={(index) => selectWorkflow(workflows[index].id)}
            color={accent}
            style={styles.workflowList}
            renderBelow={(index) =>
              workflows[index].id === selectedWorkflowId ? (
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
                    <div style={styles.sidebarMessage}>
                      {branchFilter
                        ? `No run of this workflow on ${branchFilter}.`
                        : "No runs for this workflow yet."}
                    </div>
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
              ) : null
            }
          />
        )}
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
            // Keyed by workflow and branch so nothing from the previous chart
            // lingers while the new one measures.
            key={`${selectedWorkflowId}:${branchFilter ?? ""}`}
            token={token}
            owner={owner}
            repo={repo}
            workflowName={selectedWorkflow?.name}
            branch={branchFilter}
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
            <span>
              {branchFilter
                ? `Pick a workflow to browse its recent runs on ${branchFilter}.`
                : "Pick a workflow to browse its recent runs."}
            </span>
          </div>
        )}
      </main>
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
