import { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from "react";
import { useParams, Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatePicker, Dropdown } from "antd";
import dayjs from "dayjs";
import { fetchViewerLogin, fetchContributors, fetchPRsByDateRange, fetchPullRequestSummary, fetchBehindByCounts, buildDependencyGraph } from "../api";
import type { GraphQLPullRequest, Contributor, Orientation, PRNode, PRStatusFilter } from "../types";
import type { PRReviewState } from "../reviewState";
import {
  prReviewState,
  parsePRReviewState,
  PR_REVIEW_STATES,
  PR_REVIEW_STATE_COLOR,
  PR_REVIEW_STATE_LABEL,
} from "../reviewState";
import { EYE_ICON_PATH, LOOKBACK_DAYS_KEY } from "../constants";
import { getStoredLookbackDays, buildDefaultRange, collectDescendantPRs, copyToClipboard } from "../utils";
import { buildShareUrl, getFocusPR, withFocusPR } from "../prFocus";
import { hydrateShortcut, pruneStaleShortcut, SHORTCUT_PARAM } from "../filterShortcuts";
import type { DateRange } from "../utils";
import { useGithubToken } from "../hooks/useGithubToken";
import { useIsMobile } from "../hooks/useIsMobile";
import GraphView from "./GraphView";
import FeatureAnnouncementPopup from "./FeatureAnnouncement";
import PageTabs from "./PageTabs";
import type { PageTab } from "./PageTabs";
import WorkflowsView from "./WorkflowsView";
import FolderChurnView from "./FolderChurnView";
import { styles, dropdownStyles, BANNER_EDGE_GAP } from "./GraphPage.styles";

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

// --- Toolbar filters -------------------------------------------------------

interface PRFilters {
  authors: string[];
  reviewers: string[];
  status: PRStatusFilter;
  reviewStates: PRReviewState[];
}

type FilterName = "author" | "reviewer" | "status" | "reviewState";

function matchesAuthorFilter(pr: GraphQLPullRequest, authors: string[]): boolean {
  return authors.length === 0 || authors.includes(pr.authorLogin);
}

function matchesStatusFilter(pr: GraphQLPullRequest, status: PRStatusFilter): boolean {
  if (status === "ready") return !pr.isDraft;
  if (status === "draft") return pr.isDraft;
  return true;
}

// Reviewer filter: keep PRs assigned to any of the selected people, so the
// graph shows one person's review workload. Logins are compared
// case-insensitively since the param can be edited by hand in the URL.
function matchesReviewerFilter(
  pr: GraphQLPullRequest,
  wantedReviewers: ReadonlySet<string> | null,
): boolean {
  return (
    !wantedReviewers ||
    pr.reviewers.some((r) => wantedReviewers.has(r.login.toLowerCase()))
  );
}

// Review-state filter: keep PRs whose own review state is one of the selected
// ones — the same state that colours the node, so picking "Approved" leaves
// exactly the PRs outlined green.
function matchesReviewStateFilter(
  pr: GraphQLPullRequest,
  states: PRReviewState[],
): boolean {
  return states.length === 0 || states.includes(prReviewState(pr));
}

// Applies the toolbar filters to a PR list. `skip` names filters to leave out,
// which is how a dropdown counts what each of its options would yield without
// counting its own selection against itself.
function filterPRs(
  prs: GraphQLPullRequest[],
  f: PRFilters,
  skip?: ReadonlySet<FilterName>,
): GraphQLPullRequest[] {
  const wantedReviewers =
    f.reviewers.length > 0 && !skip?.has("reviewer")
      ? new Set(f.reviewers.map((l) => l.toLowerCase()))
      : null;
  return prs.filter(
    (pr) =>
      (skip?.has("author") || matchesAuthorFilter(pr, f.authors)) &&
      (skip?.has("status") || matchesStatusFilter(pr, f.status)) &&
      matchesReviewerFilter(pr, wantedReviewers) &&
      (skip?.has("reviewState") || matchesReviewStateFilter(pr, f.reviewStates)),
  );
}

// A dropdown's own filter is left out of its option counts, otherwise picking
// one option would zero out every other option in the same menu.
const AUTHOR_FACET_SKIP: ReadonlySet<FilterName> = new Set<FilterName>(["author"]);
const REVIEWER_FACET_SKIP: ReadonlySet<FilterName> = new Set<FilterName>(["reviewer"]);
const STATUS_FACET_SKIP: ReadonlySet<FilterName> = new Set<FilterName>(["status"]);
const REVIEW_STATE_FACET_SKIP: ReadonlySet<FilterName> = new Set<FilterName>([
  "reviewState",
]);

// --- Focused PR --------------------------------------------------------

// How long the focus banner confirms that the link went to the clipboard.
const COPY_FEEDBACK_MS = 2500;

// Why the focused PR is or isn't on screen, which is what the focus banner
// reports. Anything other than "visible" means the graph is showing everything
// it has, so the banner also has to explain what happened to the link.
type FocusState =
  | { kind: "visible"; title: string; following: number }
  | { kind: "filtered" }
  | { kind: "loading" }
  | { kind: "closed"; state: "CLOSED" | "MERGED" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orientation, setOrientation] = useState<Orientation>("horizontal");

  // The page has three views selected by a tab bar: the PR dependency graph
  // (default), the GitHub Actions workflows browser and the folder churn
  // report. The active tab lives in the URL so a view can be bookmarked or
  // shared; switching pushes history so the back button walks out of the
  // drill-down.
  const tabParam = searchParams.get("tab");
  const activeTab: PageTab =
    tabParam === "workflows" || tabParam === "churn" ? tabParam : "prs";
  const setActiveTab = useCallback(
    (next: PageTab) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        if (next === "prs") params.delete("tab");
        else params.set("tab", next);
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

  const reviewStateFilter = useMemo<PRReviewState[]>(() => {
    return searchParams
      .getAll("reviewState")
      .map(parsePRReviewState)
      .filter((v): v is PRReviewState => v !== null);
  }, [searchParams]);
  const setReviewStateFilter = useCallback(
    (next: PRReviewState[]) => {
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

  // A link can name a shortcut on its own (`?shortcut=requested`) without the
  // filters it stands for, since those depend on who opens it. As soon as the
  // viewer's login resolves — which, arriving from the API, is the first moment
  // "me" means anything — the preset is written into the filter params, so the
  // graph ends up in the same state as clicking the shortcut button. Editing a
  // filter by hand drops the marker first (see `pruneStaleShortcut`), so this
  // can't undo a deliberate change.
  useEffect(() => {
    if (!hydrateShortcut(searchParams, viewerLogin)) return;
    setSearchParams((prev) => hydrateShortcut(prev, viewerLogin) ?? prev, {
      replace: true,
    });
  }, [searchParams, viewerLogin, setSearchParams]);

  // A shared link carries the PR its stack is about in the `pr` param, which
  // is what the graph frames itself on once the data lands.
  const focusPR = useMemo(() => getFocusPR(searchParams), [searchParams]);
  const setFocusPR = useCallback(
    (next: number | null) => {
      setSearchParams((prev) => withFocusPR(prev, next), { replace: true });
    },
    [setSearchParams],
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

  const filters = useMemo<PRFilters>(
    () => ({
      authors: authorFilter,
      reviewers: reviewerFilter,
      status: statusFilter,
      reviewStates: reviewStateFilter,
    }),
    [authorFilter, reviewerFilter, statusFilter, reviewStateFilter],
  );

  // How many PRs each author would leave on screen — every other filter still
  // applies, so the number beside a name matches what picking it actually
  // shows rather than the author's whole PR count for the date range.
  const prCountByAuthor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of filterPRs(allPRs, filters, AUTHOR_FACET_SKIP)) {
      counts.set(pr.authorLogin, (counts.get(pr.authorLogin) ?? 0) + 1);
    }
    return counts;
  }, [allPRs, filters]);

  // Everyone who appears as a reviewer on at least one PR that clears the other
  // filters, with how many of those PRs are on their plate. Built from the PRs
  // themselves rather than the contributor list because a reviewer need not
  // have committed to the repo. Sorted by PR count so the busiest reviewers are
  // at the top of the menu.
  const reviewerOptions = useMemo(() => {
    const byLogin = new Map<string, ReviewerOption>();
    for (const pr of filterPRs(allPRs, filters, REVIEWER_FACET_SKIP)) {
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
    // A selected reviewer whose count fell to zero still needs a row, or there
    // would be no way to switch them off from the menu.
    for (const login of reviewerFilter) {
      if (byLogin.has(login)) continue;
      const avatarUrl =
        allPRs
          .flatMap((pr) => pr.reviewers)
          .find((r) => r.login === login)?.avatarUrl ?? "";
      byLogin.set(login, { login, avatarUrl, count: 0 });
    }
    return [...byLogin.values()].sort(
      (a, b) => b.count - a.count || a.login.localeCompare(b.login),
    );
  }, [allPRs, filters, reviewerFilter]);

  // Draft/ready split of the PRs the other filters leave, so each status shows
  // what picking it would put on screen. "All PRs" is the whole pool, which is
  // also what the two halves add up to.
  const prCountByStatus = useMemo<Record<PRStatusFilter, number>>(() => {
    const pool = filterPRs(allPRs, filters, STATUS_FACET_SKIP);
    const draft = pool.reduce((n, pr) => n + (pr.isDraft ? 1 : 0), 0);
    return { all: pool.length, ready: pool.length - draft, draft };
  }, [allPRs, filters]);

  // How many PRs each review state would leave on screen. As with the author
  // counts, every other filter still applies, so the number beside a state is
  // what picking it actually shows rather than its share of the whole range.
  const prCountByReviewState = useMemo(() => {
    const counts = new Map<PRReviewState, number>();
    for (const pr of filterPRs(allPRs, filters, REVIEW_STATE_FACET_SKIP)) {
      const state = prReviewState(pr);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return counts;
  }, [allPRs, filters]);

  // The graph is always built from every PR in the date range: filters pick
  // out which of them to highlight, they don't decide who is on the graph.
  // Dependencies stay drawn either way, so a highlighted PR is still shown in
  // the context of the stack it belongs to.
  const data = useMemo(() => {
    if (allPRs.length === 0 || !owner || !repo) return null;
    const graph = buildDependencyGraph(allPRs, owner, repo);
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
  }, [allPRs, owner, repo, viewerLogin, contributors, behindByData]);

  // Which PRs the toolbar filters keep, and so which ones the graph
  // highlights. Null while no filter is set — then nothing is singled out and
  // the whole graph reads at full strength.
  const hasActiveFilters =
    authorFilter.length > 0 ||
    reviewerFilter.length > 0 ||
    statusFilter !== "all" ||
    reviewStateFilter.length > 0;

  const matchedPRs = useMemo(() => {
    if (!hasActiveFilters) return null;
    return new Set(filterPRs(allPRs, filters).map((pr) => pr.number));
  }, [hasActiveFilters, allPRs, filters]);

  // --- Focused PR (shared link) -------------------------------------------

  const focusPRLoaded =
    focusPR !== null && allPRs.some((p) => p.number === focusPR);

  // A shared link opens with the reader's own default date range, which may
  // well start after the PR was created — so when the focused PR isn't among
  // the loaded ones, look it up directly to find out why.
  const {
    data: focusSummary,
    isFetching: focusLookupFetching,
    error: focusLookupError,
  } = useQuery({
    queryKey: ["prSummary", owner, repo, focusPR],
    queryFn: () => fetchPullRequestSummary(token!, owner!, repo!, focusPR!),
    enabled:
      !!token &&
      !!owner &&
      !!repo &&
      activeTab === "prs" &&
      focusPR !== null &&
      !focusPRLoaded &&
      !isLoading &&
      !isFetchingMore,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Widen the range back to the day the focused PR was opened, so a link to an
  // older stack works without the reader having to touch the date picker. Done
  // once per PR: if it still doesn't show up afterwards, something else is
  // keeping it out and re-widening wouldn't help.
  const widenedForPR = useRef<number | null>(null);
  useEffect(() => {
    if (focusPR === null || !focusSummary || focusSummary.state !== "OPEN") return;
    if (widenedForPR.current === focusPR) return;
    const createdAt = dayjs(focusSummary.createdAt);
    if (!createdAt.isBefore(dateRange[0])) return;
    widenedForPR.current = focusPR;
    setDateRange([createdAt.startOf("day"), dateRange[1]]);
  }, [focusPR, focusSummary, dateRange]);

  const focusState = useMemo<FocusState | null>(() => {
    if (focusPR === null) return null;

    const node = data?.nodes.find(
      (n): n is PRNode => n.type === "pr" && n.number === focusPR,
    );
    if (node && data) {
      // The PR is on the graph, but the filters have to agree with the focus
      // for it to be picked out — otherwise the whole graph reads as dimmed
      // and the banner has to say why.
      if (matchedPRs && !matchedPRs.has(focusPR)) return { kind: "filtered" };
      return {
        kind: "visible",
        title: node.title,
        following: collectDescendantPRs(focusPR, data.nodes).length - 1,
      };
    }
    if (isLoading || isFetchingMore || focusLookupFetching) {
      return { kind: "loading" };
    }
    if (focusLookupError) {
      return { kind: "error", message: (focusLookupError as Error).message };
    }
    if (focusSummary === null) return { kind: "missing" };
    if (focusSummary && focusSummary.state !== "OPEN") {
      return { kind: "closed", state: focusSummary.state };
    }
    return { kind: "loading" };
  }, [
    focusPR,
    data,
    matchedPRs,
    isLoading,
    isFetchingMore,
    focusLookupFetching,
    focusLookupError,
    focusSummary,
  ]);

  // The focused view is a shareable link, so the banner offers to put the page
  // address on the clipboard. `false` after an attempt means the browser
  // refused the clipboard — the address bar still holds the link.
  const [linkCopied, setLinkCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  // A change of focus invalidates any "Link copied" note still on screen.
  useEffect(() => setLinkCopied(false), [focusPR]);

  const copyShareLink = useCallback(async () => {
    if (!owner || !repo || focusPR === null) return;
    const copied = await copyToClipboard(buildShareUrl(owner, repo, focusPR));
    setLinkCopied(copied);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    if (copied) {
      copyResetTimer.current = setTimeout(() => setLinkCopied(false), COPY_FEEDBACK_MS);
    }
  }, [owner, repo, focusPR]);

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        for (const key of ["author", "reviewer", "status", "reviewState", SHORTCUT_PARAM]) {
          params.delete(key);
        }
        return params;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const error = prError ?? null;

  // Signing in happens on the home page, so a visitor who opens a link to a
  // repository without credentials is sent there — carrying where they meant to
  // go, so the sign-in can put them back on it. Without that the query string
  // is lost at the door, and a link like `?shortcut=requested` never gets the
  // chance to resolve.
  if (!token) {
    return (
      <Navigate to="/" replace state={{ from: location.pathname + location.search }} />
    );
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
            ? matchedPRs
              ? `${matchedPRs.size} of ${allPRs.length}${isFetchingMore ? "+" : ""} open PRs`
              : `${allPRs.length}${isFetchingMore ? "+" : ""} open PRs`
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
        <StatusDropdown
          selected={statusFilter}
          onChange={setStatusFilter}
          isMobile={isMobile}
          prCountByStatus={prCountByStatus}
        />
        <ReviewStateDropdown
          selected={reviewStateFilter}
          onChange={setReviewStateFilter}
          isMobile={isMobile}
          prCountByState={prCountByReviewState}
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
        {activeTab === "churn" && owner && repo && (
          <FolderChurnView token={token} owner={owner} repo={repo} />
        )}
        {activeTab === "prs" && (
          <>
        {isLoading && (
          <div style={styles.statusContainer}>
            <Spinner />
            <p style={styles.status}>Loading pull requests...</p>
          </div>
        )}
        {!isLoading && !error && data && matchedPRs?.size === 0 && (
          <div style={styles.filterNotice}>
            No pull request matches the active filters — the graph is shown
            as it is.
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
            <GraphView
              data={data}
              orientation={orientation}
              token={token}
              focusPR={focusPR}
              onFocusPR={setFocusPR}
              highlightPRs={matchedPRs}
            />
            <FeatureAnnouncementPopup />
          </>
        )}
        {focusPR !== null && focusState && (
          <FocusBanner
            prNumber={focusPR}
            state={focusState}
            isMobile={isMobile}
            isFetchingMore={isFetchingMore}
            linkCopied={linkCopied}
            onCopyLink={copyShareLink}
            onClear={() => setFocusPR(null)}
            onClearFilters={clearFilters}
          />
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

// Sits above the graph whenever a PR is focused: it says what the view is
// framed on and, when the focused PR can't be shown, why. The focused PR is in
// the page address, so the banner also invites copying that link to share the
// stack; "Show all PRs" leads back to the unfocused graph.
// Where the focus banner sits horizontally, in pixels from the left edge of
// the graph area (null until the first measurement).
//
// The banner is centred on the graph, not on what is left beside the legend
// and shortcut panels — but it must not run into them either, so it gives way
// only by however much it overlaps, and only while sharing their row. Both
// widths change at runtime (the legend collapses, the message varies, the
// window resizes), which is why this is measured rather than declared.
function useCentredBannerLeft(isMobile: boolean, stateKind: FocusState["kind"]) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    maxWidth: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const area = el?.offsetParent as HTMLElement | null;
    if (!el || !area) return;

    const measure = () => {
      const areaWidth = area.clientWidth;
      const width = el.offsetWidth;
      // On a narrow screen the banner is along the bottom, clear of the panels.
      const panels = isMobile
        ? null
        : area.querySelector<HTMLElement>("[data-graph-overlay]");
      const panelsRight = panels
        ? panels.getBoundingClientRect().right -
          area.getBoundingClientRect().left +
          BANNER_EDGE_GAP
        : BANNER_EDGE_GAP;

      const centred = (areaWidth - width) / 2;
      const nextLeft = Math.max(BANNER_EDGE_GAP, Math.max(centred, panelsRight));
      // Between a wide banner and narrow window the banner gives up width
      // rather than clearance, so its text ellipsizes instead of sliding under
      // the panels. Once it is pinned beside them the centred position can no
      // longer overtake that, so this settles in one pass.
      const nextMaxWidth = Math.max(0, areaWidth - nextLeft - BANNER_EDGE_GAP);

      // Only a real move is written back, so a sub-pixel jitter can't bounce
      // between render and observer.
      setPlacement((prev) =>
        prev &&
        Math.abs(prev.left - nextLeft) < 1 &&
        Math.abs(prev.maxWidth - nextMaxWidth) < 1
          ? prev
          : { left: nextLeft, maxWidth: nextMaxWidth },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(area);
    const panels = area.querySelector<HTMLElement>("[data-graph-overlay]");
    if (panels) observer.observe(panels);
    return () => observer.disconnect();
    // The graph (and with it the panels) mounts after the banner in some
    // states, so the element lookup is redone whenever the banner re-renders
    // for a new state.
  }, [isMobile, stateKind]);

  return { ref, placement };
}

function FocusBanner({
  prNumber,
  state,
  isMobile,
  isFetchingMore,
  linkCopied,
  onCopyLink,
  onClear,
  onClearFilters,
}: {
  prNumber: number;
  state: FocusState;
  isMobile: boolean;
  isFetchingMore: boolean;
  linkCopied: boolean;
  onCopyLink: () => void;
  onClear: () => void;
  onClearFilters: () => void;
}) {
  const isProblem = state.kind !== "visible" && state.kind !== "loading";
  const { ref, placement } = useCentredBannerLeft(isMobile, state.kind);

  let message: string;
  switch (state.kind) {
    case "visible":
      message =
        state.following > 0
          ? `Focused on #${prNumber} ${state.title} and ${state.following} following PR${state.following === 1 ? "" : "s"}`
          : `Focused on #${prNumber} ${state.title}`;
      break;
    case "loading":
      message = `Looking for PR #${prNumber}...`;
      break;
    case "filtered":
      message = `PR #${prNumber} doesn\u2019t match the active filters`;
      break;
    case "closed":
      message = `PR #${prNumber} is ${state.state === "MERGED" ? "merged" : "closed"} — the graph only shows open pull requests`;
      break;
    case "missing":
      message = `PR #${prNumber} wasn't found in this repository`;
      break;
    case "error":
      message = `PR #${prNumber} couldn't be looked up: ${state.message}`;
      break;
  }

  return (
    <div
      ref={ref}
      style={{
        ...styles.focusBanner,
        ...(isMobile
          ? isFetchingMore
            ? styles.focusBannerMobileRaised
            : styles.focusBannerMobile
          : {}),
        // Once measured, the banner is placed by hand — the declared 50% /
        // translate centring only covers the first layout pass.
        ...(placement ? { ...placement, transform: "none" } : {}),
        ...(isProblem ? styles.focusBannerProblem : {}),
      }}
      role="status"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
        <path d={EYE_ICON_PATH} />
      </svg>
      <span style={styles.focusBannerText}>{message}</span>
      {state.kind === "visible" && (
        <button
          type="button"
          className="focus-banner-btn"
          style={{
            ...styles.focusBannerBtn,
            ...(linkCopied ? styles.focusBannerBtnDone : {}),
          }}
          title="Copy this page's link — it opens the graph on this stack"
          onClick={onCopyLink}
        >
          {linkCopied ? "Link copied" : "Copy link to share"}
        </button>
      )}
      {state.kind === "filtered" && (
        <button
          type="button"
          className="focus-banner-btn"
          style={styles.focusBannerBtn}
          onClick={onClearFilters}
        >
          Clear filters
        </button>
      )}
      <button
        type="button"
        className="focus-banner-btn"
        style={styles.focusBannerBtn}
        onClick={onClear}
      >
        Show all PRs
      </button>
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

  // Authors with nothing left under the other filters drop out of the menu,
  // except one that is currently selected — that row has to stay so it can be
  // switched off again.
  const sortedContributors = useMemo(() => {
    return [...contributors]
      .filter(
        (c) => (prCountByAuthor.get(c.login) ?? 0) > 0 || selected.includes(c.login),
      )
      .sort(
        (a, b) => (prCountByAuthor.get(b.login) ?? 0) - (prCountByAuthor.get(a.login) ?? 0),
      );
  }, [contributors, prCountByAuthor, selected]);

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
                  <span style={dropdownStyles.count}>({count})</span>
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
      <path d={EYE_ICON_PATH} />
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
  prCountByStatus,
}: {
  selected: PRStatusFilter;
  onChange: (next: PRStatusFilter) => void;
  isMobile: boolean;
  prCountByStatus: Record<PRStatusFilter, number>;
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
            const count = prCountByStatus[opt.value];
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
                title={`${count} PR${count === 1 ? "" : "s"}`}
              >
                <StatusIndicator color={opt.color} />
                <span>{opt.label}</span>
                <span style={dropdownStyles.count}>({count})</span>
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
  value: PRReviewState;
  label: string;
  color: string;
}[] = PR_REVIEW_STATES.map((state) => ({
  value: state,
  label: PR_REVIEW_STATE_LABEL[state],
  color: PR_REVIEW_STATE_COLOR[state],
}));

function ReviewStateDropdown({
  selected,
  onChange,
  isMobile,
  prCountByState,
}: {
  selected: PRReviewState[];
  onChange: (next: PRReviewState[]) => void;
  isMobile: boolean;
  prCountByState: Map<PRReviewState, number>;
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
    (state: PRReviewState) => {
      onChange(
        selected.includes(state)
          ? selected.filter((s) => s !== state)
          : [...selected, state],
      );
    },
    [selected, onChange],
  );

  const soleSelected =
    selected.length === 1
      ? REVIEW_STATE_OPTIONS.find((o) => o.value === selected[0])
      : undefined;

  const label =
    selected.length === 0
      ? "Any review state"
      : selected.length === 1
        ? soleSelected?.label ?? "Review state"
        : `${selected.length} review states`;

  const triggerTitle =
    "Filter by each PR's review state — the state its node is outlined with";

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
          <ReviewStateDot color={soleSelected?.color} />
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
              const count = prCountByState.get(opt.value) ?? 0;
              return (
                <button
                  key={opt.value}
                  className="contributor-dropdown-item"
                  style={{
                    ...dropdownStyles.item,
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onClick={() => toggle(opt.value)}
                  title={`${count} PR${count === 1 ? "" : "s"} in this state`}
                >
                  <ReviewStateDot color={opt.color} />
                  <span>{opt.label}</span>
                  <span style={dropdownStyles.count}>({count})</span>
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
