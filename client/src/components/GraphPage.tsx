import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useParams, Link, Navigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatePicker, Dropdown } from "antd";
import dayjs from "dayjs";
import { fetchViewerLogin, fetchContributors, fetchPRsByDateRange, fetchBehindByCounts, buildDependencyGraph } from "../api";
import type { GraphQLPullRequest, Contributor, Orientation, PRStatusFilter, ReviewStateFilter } from "../types";
import { REVIEW_STATE_FILTER_VALUES } from "../types";
import { LOOKBACK_DAYS_KEY } from "../constants";
import { getStoredLookbackDays, buildDefaultRange } from "../utils";
import { pruneStaleShortcut } from "../filterShortcuts";
import type { DateRange } from "../utils";
import { useGithubToken } from "../hooks/useGithubToken";
import { useIsMobile } from "../hooks/useIsMobile";
import GraphView from "./GraphView";
import FeatureAnnouncementPopup from "./FeatureAnnouncement";
import PageTabs from "./PageTabs";
import type { PageTab } from "./PageTabs";
import WorkflowsView from "./WorkflowsView";
import { styles, dropdownStyles } from "./GraphPage.styles";

function looksLikeRepoNotFound(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("could not resolve to a repository") ||
    m.includes("could not resolve to a node")
  );
}

const { RangePicker } = DatePicker;

// Open PRs are kept fresh by refetching on this interval. The graph updates in
// place when newer data arrives, so a tab left open stays current on its own.
const PR_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

// Stable reference for the empty case so dependent memos don't recompute on
// every render before the first page lands.
const EMPTY_PRS: GraphQLPullRequest[] = [];

function useIncrementalPRs(
  token: string | null,
  owner: string | undefined,
  repo: string | undefined,
  startDate: string,
  endDate: string,
  active: boolean,
) {
  const queryClient = useQueryClient();
  const [isFetchingMore, setIsFetchingMore] = useState(false);

  const query = useQuery({
    queryKey: ["prs", owner, repo, startDate, endDate],
    enabled: !!token && !!owner && !!repo && active,
    refetchInterval: PR_REFRESH_INTERVAL_MS,
    queryFn: async ({ queryKey, signal }) => {
      // Stream pages into the cache so the graph renders progressively, but
      // only on the first load. On a background auto-refresh the full graph is
      // already on screen, so we keep it and swap atomically once the refetch
      // finishes — otherwise the graph would collapse to the first page and
      // visibly re-grow every interval.
      const hasExisting =
        (queryClient.getQueryData<GraphQLPullRequest[]>(queryKey)?.length ?? 0) > 0;

      try {
        return await fetchPRsByDateRange(
          token!,
          owner!,
          repo!,
          startDate,
          endDate,
          hasExisting
            ? undefined
            : (accumulated) => {
                queryClient.setQueryData(queryKey, accumulated);
                setIsFetchingMore(true);
              },
          signal,
        );
      } finally {
        setIsFetchingMore(false);
      }
    },
  });

  return {
    prs: query.data ?? EMPTY_PRS,
    isLoading: query.isLoading,
    isFetchingMore,
    error: query.error ? (query.error as Error).message : null,
    refetch: query.refetch,
  };
}

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const queryClient = useQueryClient();
  const { token, source } = useGithubToken();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orientation, setOrientation] = useState<Orientation>("horizontal");

  // The page has two views selected by a tab bar: the PR dependency graph
  // (default) and the GitHub Actions workflows browser. The active tab lives in
  // the URL so a view can be bookmarked or shared; switching pushes history so
  // the back button walks out of the drill-down.
  const activeTab: PageTab =
    searchParams.get("tab") === "workflows" ? "workflows" : "prs";
  const setActiveTab = useCallback(
    (next: PageTab) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "workflows") params.set("tab", "workflows");
        else params.delete("tab");
        return params;
      });
    },
    [setSearchParams],
  );

  const { data: viewerLogin } = useQuery({
    queryKey: ["viewer", token],
    queryFn: () => fetchViewerLogin(token!),
    enabled: !!token,
  });

  // Author, reviewer and status filters live in the URL query string so they
  // survive a refresh and a filtered view can be bookmarked or shared. Editing
  // one by hand drops the `shortcut` marker once the filters no longer match
  // the shortcut it names, so the value counts as manually set from then on.
  const authorFilter = useMemo(() => searchParams.getAll("author"), [searchParams]);
  const setAuthorFilter = useCallback(
    (next: string[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete("author");
          for (const login of next) params.append("author", login);
          return pruneStaleShortcut(params, viewerLogin);
        },
        { replace: true },
      );
    },
    [setSearchParams, viewerLogin],
  );

  const reviewerFilter = useMemo(
    () => searchParams.getAll("reviewer"),
    [searchParams],
  );
  const setReviewerFilter = useCallback(
    (next: string[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete("reviewer");
          for (const login of next) params.append("reviewer", login);
          return pruneStaleShortcut(params, viewerLogin);
        },
        { replace: true },
      );
    },
    [setSearchParams, viewerLogin],
  );

  const statusParam = searchParams.get("status");
  const statusFilter: PRStatusFilter =
    statusParam === "ready" || statusParam === "draft" ? statusParam : "all";
  const setStatusFilter = useCallback(
    (next: PRStatusFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === "all") params.delete("status");
          else params.set("status", next);
          return pruneStaleShortcut(params, viewerLogin);
        },
        { replace: true },
      );
    },
    [setSearchParams, viewerLogin],
  );

  const reviewStateFilter = useMemo<ReviewStateFilter[]>(() => {
    const allowed = new Set<string>(REVIEW_STATE_FILTER_VALUES);
    return searchParams
      .getAll("reviewState")
      .map((v) => v.toUpperCase())
      .filter((v): v is ReviewStateFilter => allowed.has(v));
  }, [searchParams]);
  const setReviewStateFilter = useCallback(
    (next: ReviewStateFilter[]) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.delete("reviewState");
          for (const s of next) params.append("reviewState", s);
          return pruneStaleShortcut(params, viewerLogin);
        },
        { replace: true },
      );
    },
    [setSearchParams, viewerLogin],
  );

  const [lookbackDays, setLookbackDays] = useState(getStoredLookbackDays);
  const [lookbackInput, setLookbackInput] = useState(String(lookbackDays));
  const [dateRange, setDateRange] = useState<DateRange>(() => buildDefaultRange(lookbackDays));

  useEffect(() => {
    const val = parseInt(lookbackInput, 10);
    if (isNaN(val) || val < 1 || val > 365 || val === lookbackDays) return;
    const timer = setTimeout(() => {
      setLookbackDays(val);
      localStorage.setItem(LOOKBACK_DAYS_KEY, String(val));
      setDateRange(buildDefaultRange(val));
    }, 500);
    return () => clearTimeout(timer);
  }, [lookbackInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDate = dateRange[0].toISOString();
  const endDate = dateRange[1].toISOString();

  const {
    prs: allPRs,
    isLoading,
    isFetchingMore,
    error: prError,
    refetch,
  } = useIncrementalPRs(token, owner, repo, startDate, endDate, activeTab === "prs");

  const { data: contributors } = useQuery({
    queryKey: ["contributors", owner, repo],
    queryFn: () => fetchContributors(token!, owner!, repo!),
    enabled: !!owner && !!repo && !!token && activeTab === "prs",
    staleTime: 5 * 60 * 1000,
  });

  const prKeys = allPRs.map((p) => p.number).join(",");
  const { data: behindByData } = useQuery({
    queryKey: ["behindBy", owner, repo, prKeys],
    queryFn: () => fetchBehindByCounts(token!, owner!, repo!, allPRs, queryClient),
    enabled: !!owner && !!repo && !!token && allPRs.length > 0 && activeTab === "prs",
    staleTime: 60 * 1000,
  });

  const prCountByAuthor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of allPRs) {
      counts.set(pr.authorLogin, (counts.get(pr.authorLogin) ?? 0) + 1);
    }
    return counts;
  }, [allPRs]);

  // Everyone who appears as a reviewer on at least one PR in range, with how
  // many PRs are on their plate. Built from the PRs themselves rather than the
  // contributor list because a reviewer need not have committed to the repo.
  // Sorted by PR count so the busiest reviewers are at the top of the menu.
  const reviewerOptions = useMemo(() => {
    const byLogin = new Map<string, { login: string; avatarUrl: string; count: number }>();
    for (const pr of allPRs) {
      for (const reviewer of pr.reviewers) {
        const entry = byLogin.get(reviewer.login);
        if (entry) {
          entry.count += 1;
          if (!entry.avatarUrl) entry.avatarUrl = reviewer.avatarUrl;
        } else {
          byLogin.set(reviewer.login, {
            login: reviewer.login,
            avatarUrl: reviewer.avatarUrl,
            count: 1,
          });
        }
      }
    }
    return [...byLogin.values()].sort(
      (a, b) => b.count - a.count || a.login.localeCompare(b.login),
    );
  }, [allPRs]);

  const data = useMemo(() => {
    if (allPRs.length === 0 || !owner || !repo) return null;
    let prs = allPRs;
    if (authorFilter.length > 0) {
      prs = prs.filter((pr) => authorFilter.includes(pr.authorLogin));
    }
    if (statusFilter === "ready") {
      prs = prs.filter((pr) => !pr.isDraft);
    } else if (statusFilter === "draft") {
      prs = prs.filter((pr) => pr.isDraft);
    }
    // Reviewer filter: keep PRs assigned to any of the selected people, so the
    // graph shows one person's review workload. Logins are compared
    // case-insensitively since the param can be edited by hand in the URL.
    const wantedReviewers =
      reviewerFilter.length > 0
        ? new Set(reviewerFilter.map((l) => l.toLowerCase()))
        : null;
    if (wantedReviewers) {
      prs = prs.filter((pr) =>
        pr.reviewers.some((r) => wantedReviewers.has(r.login.toLowerCase())),
      );
    }
    // Review-state filter: keep PRs where one of the selected states applies.
    // It reads against whoever the reviewer filter names, and falls back to the
    // viewer when no reviewer is picked — so "Alice" + "Review requested"
    // answers "what is still waiting on Alice". The viewer fallback is skipped
    // until viewerLogin loads so it doesn't briefly wipe the graph out on first
    // paint.
    if (reviewStateFilter.length > 0 && (wantedReviewers || viewerLogin)) {
      const wantedStates = new Set<string>(reviewStateFilter);
      prs = prs.filter((pr) =>
        pr.reviewers.some(
          (r) =>
            (wantedReviewers
              ? wantedReviewers.has(r.login.toLowerCase())
              : r.login === viewerLogin) && wantedStates.has(r.state),
        ),
      );
    }
    if (prs.length === 0) return null;
    const graph = buildDependencyGraph(prs, owner, repo);
    if (viewerLogin) graph.viewerLogin = viewerLogin;
    if (contributors) graph.contributors = contributors;
    if (behindByData) {
      for (const node of graph.nodes) {
        if (node.type === "pr") {
          const behind = behindByData.get(node.number);
          if (behind !== undefined) node.behindBy = behind;
        }
      }
    }
    return graph;
  }, [allPRs, owner, repo, viewerLogin, contributors, authorFilter, reviewerFilter, statusFilter, reviewStateFilter, behindByData]);

  const error = prError ?? null;

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div style={styles.page}>
      <header style={{ ...styles.header, ...(isMobile ? styles.headerMobile : {}) }}>
        <Link to="/" style={styles.backLink}>
          &larr; Back
        </Link>
        <h1 style={{ ...styles.title, ...(isMobile ? styles.titleMobile : {}) }}>
          {owner}/{repo}
        </h1>
        {data?.viewerLogin && (
          <span style={styles.viewer}>@{data.viewerLogin}</span>
        )}
        <span style={styles.badge}>
          {activeTab === "prs" && data
            ? `${data.nodes.filter((n) => n.type === "pr").length}${isFetchingMore ? "+" : ""} open PRs`
            : ""}
        </span>
        <div style={isMobile ? styles.controlsMobile : styles.controlsDesktop}>
        {activeTab === "prs" && (
          <>
        <RangePicker
          showTime={!isMobile}
          value={dateRange}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setDateRange([dates[0], dates[1]]);
            }
          }}
          allowClear={false}
          size="small"
          style={{ fontSize: 12, ...(isMobile ? { width: "100%" } : {}) }}
        />
        <ContributorDropdown
          contributors={contributors ?? []}
          prCountByAuthor={prCountByAuthor}
          selected={authorFilter}
          onChange={setAuthorFilter}
          isMobile={isMobile}
        />
        <ReviewerDropdown
          reviewers={reviewerOptions}
          selected={reviewerFilter}
          onChange={setReviewerFilter}
          isMobile={isMobile}
        />
        <StatusDropdown selected={statusFilter} onChange={setStatusFilter} isMobile={isMobile} />
        <ReviewStateDropdown
          selected={reviewStateFilter}
          onChange={setReviewStateFilter}
          isMobile={isMobile}
          viewerLogin={viewerLogin}
          reviewerFilter={reviewerFilter}
        />
          </>
        )}
        <div style={isMobile ? styles.iconRowMobile : styles.iconRowDesktop}>
        {activeTab === "prs" && (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "orientation",
                label: (
                  <div style={styles.menuItemRow}>
                    <span>Orientation</span>
                    <button
                      style={styles.menuToggleBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOrientation((o) => (o === "horizontal" ? "vertical" : "horizontal"));
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        {orientation === "horizontal" ? (
                          <path d="M1 7h10M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <path d="M7 1v10M4 8l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        )}
                      </svg>
                      {orientation === "horizontal" ? "Horizontal" : "Vertical"}
                    </button>
                  </div>
                ),
              },
              {
                key: "lookback",
                label: (
                  <div
                    style={styles.menuItemRow}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>Default range</span>
                    <label style={styles.lookbackLabel}>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={lookbackInput}
                        onChange={(e) => setLookbackInput(e.target.value)}
                        style={styles.lookbackInput}
                      />
                      days
                    </label>
                  </div>
                ),
              },
            ],
          }}
        >
          <button style={styles.settingsBtn} title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </Dropdown>
        )}
        <a
          href="https://github.com/cengizmurat/pr_dependency_graph"
          target="_blank"
          rel="noopener noreferrer"
          style={styles.githubLink}
          title="View on GitHub"
        >
          <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </a>
        </div>
        </div>
      </header>

      <PageTabs active={activeTab} onChange={setActiveTab} />

      <div style={styles.content}>
        {activeTab === "workflows" && owner && repo && (
          <WorkflowsView token={token} owner={owner} repo={repo} isMobile={isMobile} />
        )}
        {activeTab === "prs" && (
          <>
        {isLoading && (
          <div style={styles.statusContainer}>
            <Spinner />
            <p style={styles.status}>Loading pull requests...</p>
          </div>
        )}
        {!isLoading && !error && !data && allPRs.length > 0 && (
          <div style={styles.statusContainer}>
            <p style={styles.status}>
              No pull requests match the active filters.
            </p>
          </div>
        )}
        {error && (
          <div style={styles.errorContainer}>
            <p style={styles.error}>{error}</p>
            {source === "oauth" && looksLikeRepoNotFound(error) && (
              <p style={styles.error}>
                The repository <strong>{owner}/{repo}</strong> wasn't found
                with your current authorization. If it's a private repo in an
                organization, an org owner may need to approve this OAuth app
                under <em>Settings → Third-party access</em>, or you may not be
                a member of that org.
              </p>
            )}
            <button style={styles.retryBtn} onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}
        {data && (
          <>
            <GraphView data={data} orientation={orientation} token={token} />
            <FeatureAnnouncementPopup />
          </>
        )}
        {isFetchingMore && (() => {
          const oldestSoFar = dayjs(allPRs[allPRs.length - 1]?.createdAt);
          const totalMs = dayjs(endDate).diff(dayjs(startDate));
          const elapsedMs = dayjs(endDate).diff(oldestSoFar);
          const progress = totalMs > 0 ? Math.min(1, Math.max(0, elapsedMs / totalMs)) : 0;
          return (
            <div style={styles.fetchingMoreBar}>
              <div style={styles.fetchingMoreContent}>
                <Spinner size={14} />
                <span>
                  Loading PRs created before {oldestSoFar.format("MMM D, YYYY")}...
                </span>
              </div>
              <div style={styles.progressTrack}>
                <div style={{ ...styles.progressFill, width: `${progress * 100}%` }} />
              </div>
            </div>
          );
        })()}
          </>
        )}
      </div>
    </div>
  );
}

function ContributorDropdown({
  contributors,
  prCountByAuthor,
  selected,
  onChange,
  isMobile,
}: {
  contributors: Contributor[];
  prCountByAuthor: Map<string, number>;
  selected: string[];
  onChange: (next: string[]) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    // Capture phase: the d3-zoom graph canvas stops mousedown propagation, so a bubbling listener never sees clicks on it.
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    },
    [],
  );

  const sortedContributors = useMemo(() => {
    return [...contributors]
      .filter((c) => (prCountByAuthor.get(c.login) ?? 0) > 0)
      .sort(
        (a, b) => (prCountByAuthor.get(b.login) ?? 0) - (prCountByAuthor.get(a.login) ?? 0),
      );
  }, [contributors, prCountByAuthor]);

  const toggle = useCallback(
    (login: string) => {
      onChange(
        selected.includes(login)
          ? selected.filter((l) => l !== login)
          : [...selected, login],
      );
    },
    [selected, onChange],
  );

  const soleSelected =
    selected.length === 1
      ? contributors.find((c) => c.login === selected[0])
      : undefined;

  return (
    <div
      ref={ref}
      style={{ ...dropdownStyles.wrapper, ...(isMobile ? dropdownStyles.wrapperMobile : {}) }}
      onKeyDown={handleKeyDown}
    >
      <button
        style={{ ...dropdownStyles.trigger, ...(isMobile ? dropdownStyles.triggerMobile : {}) }}
        onClick={() => setOpen((o) => !o)}
        title="Filter by author"
      >
        <span style={dropdownStyles.triggerLabel}>
        {selected.length === 0 ? (
          <>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
              <path d="M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.005 6.005 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
            </svg>
            All authors
          </>
        ) : soleSelected ? (
          <>
            <img
              src={soleSelected.avatarUrl}
              alt={soleSelected.login}
              style={dropdownStyles.triggerAvatar}
            />
            {soleSelected.login}
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
              <path d="M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.005 6.005 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
            </svg>
            {selected.length} authors
          </>
        )}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 2, flexShrink: 0 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div style={{ ...dropdownStyles.menu, ...(isMobile ? dropdownStyles.menuMobile : {}) }}>
          <button
            className="contributor-dropdown-item"
            style={{
              ...dropdownStyles.item,
              fontWeight: selected.length === 0 ? 600 : 400,
            }}
            onClick={() => onChange([])}
          >
            All authors
          </button>
          <div style={dropdownStyles.divider} />
          <div style={dropdownStyles.list}>
            {sortedContributors.map((c) => {
              const count = prCountByAuthor.get(c.login) ?? 0;
              const isSelected = selected.includes(c.login);
              return (
                <button
                  key={c.login}
                  className="contributor-dropdown-item"
                  style={{
                    ...dropdownStyles.item,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onClick={() => toggle(c.login)}
                >
                  <img
                    src={c.avatarUrl}
                    alt={c.login}
                    style={dropdownStyles.avatar}
                  />
                  <span>{c.login}</span>
                  {count > 0 && (
                    <span style={dropdownStyles.count}>({count})</span>
                  )}
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-ready)" style={{ marginLeft: "auto", flexShrink: 0 }}>
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface ReviewerOption {
  login: string;
  avatarUrl: string;
  count: number;
}

// Eye icon (GitHub Octicon "eye"), the same glyph GitHub uses for reviewers.
function ReviewerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2Zm0 1.5c-1.51 0-2.879.755-4.02 1.73C2.85 6.193 2.02 7.31 1.617 8c.403.69 1.233 1.807 2.363 2.77C5.121 11.745 6.49 12.5 8 12.5c1.51 0 2.879-.755 4.02-1.73 1.13-.963 1.96-2.08 2.363-2.77-.403-.69-1.233-1.807-2.363-2.77C10.879 4.255 9.51 3.5 8 3.5ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
    </svg>
  );
}

function ReviewerDropdown({
  reviewers,
  selected,
  onChange,
  isMobile,
}: {
  reviewers: ReviewerOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    // Capture phase: the d3-zoom graph canvas stops mousedown propagation, so a bubbling listener never sees clicks on it.
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  const toggle = useCallback(
    (login: string) => {
      onChange(
        selected.includes(login)
          ? selected.filter((l) => l !== login)
          : [...selected, login],
      );
    },
    [selected, onChange],
  );

  const soleSelected =
    selected.length === 1
      ? reviewers.find((r) => r.login === selected[0])
      : undefined;

  return (
    <div
      ref={ref}
      style={{ ...dropdownStyles.wrapper, ...(isMobile ? dropdownStyles.wrapperMobile : {}) }}
      onKeyDown={handleKeyDown}
    >
      <button
        style={{ ...dropdownStyles.trigger, ...(isMobile ? dropdownStyles.triggerMobile : {}) }}
        onClick={() => setOpen((o) => !o)}
        title="Filter by reviewer"
      >
        <span style={dropdownStyles.triggerLabel}>
          {soleSelected ? (
            <>
              <img
                src={soleSelected.avatarUrl}
                alt={soleSelected.login}
                style={dropdownStyles.triggerAvatar}
              />
              {soleSelected.login}
            </>
          ) : (
            <>
              <ReviewerIcon />
              {selected.length === 0
                ? "All reviewers"
                : selected.length === 1
                  ? selected[0]
                  : `${selected.length} reviewers`}
            </>
          )}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 2, flexShrink: 0 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div style={{ ...dropdownStyles.menu, ...(isMobile ? dropdownStyles.menuMobile : {}) }}>
          <button
            className="contributor-dropdown-item"
            style={{
              ...dropdownStyles.item,
              fontWeight: selected.length === 0 ? 600 : 400,
            }}
            onClick={() => onChange([])}
          >
            <ReviewerIcon />
            <span>All reviewers</span>
          </button>
          <div style={dropdownStyles.divider} />
          <div style={dropdownStyles.list}>
            {reviewers.length === 0 && (
              <div style={{ ...dropdownStyles.item, color: "var(--color-text-secondary)", cursor: "default" }}>
                No reviewers on these PRs
              </div>
            )}
            {reviewers.map((r) => {
              const isSelected = selected.includes(r.login);
              return (
                <button
                  key={r.login}
                  className="contributor-dropdown-item"
                  style={{
                    ...dropdownStyles.item,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onClick={() => toggle(r.login)}
                  title={`${r.login} is a reviewer on ${r.count} PR${r.count === 1 ? "" : "s"}`}
                >
                  <img src={r.avatarUrl} alt={r.login} style={dropdownStyles.avatar} />
                  <span>{r.login}</span>
                  <span style={dropdownStyles.count}>({r.count})</span>
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-ready)" style={{ marginLeft: "auto", flexShrink: 0 }}>
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_OPTIONS: { value: PRStatusFilter; label: string; color?: string }[] = [
  { value: "all", label: "All PRs" },
  { value: "ready", label: "Ready", color: "var(--color-ready)" },
  { value: "draft", label: "Draft", color: "var(--color-draft)" },
];

const prIconPath =
  "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z";

function StatusIndicator({ color }: { color?: string }) {
  if (color) {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d={prIconPath} />
    </svg>
  );
}

function StatusDropdown({
  selected,
  onChange,
  isMobile,
}: {
  selected: PRStatusFilter;
  onChange: (next: PRStatusFilter) => void;
  isMobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    // Capture phase: the d3-zoom graph canvas stops mousedown propagation, so a bubbling listener never sees clicks on it.
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  const current =
    STATUS_OPTIONS.find((o) => o.value === selected) ?? STATUS_OPTIONS[0];

  return (
    <div
      ref={ref}
      style={{ ...dropdownStyles.wrapper, ...(isMobile ? dropdownStyles.wrapperMobile : {}) }}
      onKeyDown={handleKeyDown}
    >
      <button
        style={{ ...dropdownStyles.trigger, ...(isMobile ? dropdownStyles.triggerMobile : {}) }}
        onClick={() => setOpen((o) => !o)}
        title="Filter by status"
      >
        <span style={dropdownStyles.triggerLabel}>
          <StatusIndicator color={current.color} />
          {current.label}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 2, flexShrink: 0 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div style={{ ...dropdownStyles.menu, ...(isMobile ? dropdownStyles.menuMobile : {}) }}>
          {STATUS_OPTIONS.map((opt) => {
            const isSelected = opt.value === selected;
            return (
              <button
                key={opt.value}
                className="contributor-dropdown-item"
                style={{
                  ...dropdownStyles.item,
                  fontWeight: isSelected ? 600 : 400,
                }}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <StatusIndicator color={opt.color} />
                <span>{opt.label}</span>
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-ready)" style={{ marginLeft: "auto", flexShrink: 0 }}>
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const REVIEW_STATE_OPTIONS: {
  value: ReviewStateFilter;
  label: string;
  color: string;
}[] = [
  { value: "REQUESTED", label: "Review requested", color: "var(--color-review-requested)" },
  { value: "APPROVED", label: "Approved", color: "var(--color-ready)" },
  { value: "CHANGES_REQUESTED", label: "Changes requested", color: "var(--color-conflict)" },
  { value: "COMMENTED", label: "Commented", color: "var(--color-review-commented)" },
  { value: "DISMISSED", label: "Dismissed", color: "var(--color-review-commented)" },
];

function ReviewStateDropdown({
  selected,
  onChange,
  isMobile,
  viewerLogin,
  reviewerFilter,
}: {
  selected: ReviewStateFilter[];
  onChange: (next: ReviewStateFilter[]) => void;
  isMobile: boolean;
  viewerLogin: string | undefined;
  reviewerFilter: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick, true);
    return () => document.removeEventListener("mousedown", handleClick, true);
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  const toggle = useCallback(
    (state: ReviewStateFilter) => {
      onChange(
        selected.includes(state)
          ? selected.filter((s) => s !== state)
          : [...selected, state],
      );
    },
    [selected, onChange],
  );

  const label =
    selected.length === 0
      ? "Any review state"
      : selected.length === 1
        ? REVIEW_STATE_OPTIONS.find((o) => o.value === selected[0])?.label ??
          "Review state"
        : `${selected.length} review states`;

  // The state is read against whoever the reviewer filter names; with no
  // reviewer picked it falls back to the viewer's own review state.
  const subject =
    reviewerFilter.length === 1
      ? `@${reviewerFilter[0]}`
      : reviewerFilter.length > 1
        ? "the selected reviewers"
        : viewerLogin
          ? `you (@${viewerLogin})`
          : "you";
  const triggerTitle = `Filter by the review state of ${subject} on each PR`;

  return (
    <div
      ref={ref}
      style={{ ...dropdownStyles.wrapper, ...(isMobile ? dropdownStyles.wrapperMobile : {}) }}
      onKeyDown={handleKeyDown}
    >
      <button
        style={{ ...dropdownStyles.trigger, ...(isMobile ? dropdownStyles.triggerMobile : {}) }}
        onClick={() => setOpen((o) => !o)}
        title={triggerTitle}
      >
        <span style={dropdownStyles.triggerLabel}>
          <ReviewStateDot />
          {label}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 2, flexShrink: 0 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div style={{ ...dropdownStyles.menu, ...(isMobile ? dropdownStyles.menuMobile : {}) }}>
          <button
            className="contributor-dropdown-item"
            style={{
              ...dropdownStyles.item,
              fontWeight: selected.length === 0 ? 600 : 400,
            }}
            onClick={() => onChange([])}
          >
            <ReviewStateDot />
            <span>Any review state</span>
          </button>
          <div style={dropdownStyles.divider} />
          <div style={dropdownStyles.list}>
            {REVIEW_STATE_OPTIONS.map((opt) => {
              const isSelected = selected.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  className="contributor-dropdown-item"
                  style={{
                    ...dropdownStyles.item,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onClick={() => toggle(opt.value)}
                >
                  <ReviewStateDot color={opt.color} />
                  <span>{opt.label}</span>
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--color-ready)" style={{ marginLeft: "auto", flexShrink: 0 }}>
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewStateDot({ color }: { color?: string }) {
  if (color) {
    return (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z" />
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z" />
    </svg>
  );
}

function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="var(--color-border-subtle)"
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="var(--color-text-secondary)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
