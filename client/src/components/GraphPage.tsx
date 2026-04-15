import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatePicker, Dropdown } from "antd";
import dayjs from "dayjs";
import { fetchViewerLogin, fetchContributors, fetchPRsByDateRange, fetchBehindByCounts, buildDependencyGraph } from "../api";
import type { GraphQLPullRequest, Contributor, Orientation } from "../types";
import { LOOKBACK_DAYS_KEY } from "../constants";
import { getStoredLookbackDays, buildDefaultRange } from "../utils";
import type { DateRange } from "../utils";
import { useGithubToken } from "../hooks/useGithubToken";
import GraphView from "./GraphView";
import { styles, dropdownStyles } from "./GraphPage.styles";

const { RangePicker } = DatePicker;

function useIncrementalPRs(
  token: string | null,
  owner: string | undefined,
  repo: string | undefined,
  startDate: string,
  endDate: string,
) {
  const [prs, setPRs] = useState<GraphQLPullRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    if (!token || !owner || !repo) return;

    const controller = new AbortController();
    let receivedFirstPage = false;

    setIsLoading(true);
    setIsFetchingMore(false);
    setError(null);
    setPRs([]);

    fetchPRsByDateRange(
      token,
      owner,
      repo,
      startDate,
      endDate,
      (accumulated) => {
        setPRs(accumulated);
        if (!receivedFirstPage) {
          receivedFirstPage = true;
          setIsLoading(false);
          setIsFetchingMore(true);
        }
      },
      controller.signal,
    )
      .then(() => {
        if (!receivedFirstPage) setIsLoading(false);
        setIsFetchingMore(false);
      })
      .catch((err) => {
        if ((err as DOMException).name === "AbortError") return;
        setError((err as Error).message);
        setIsLoading(false);
        setIsFetchingMore(false);
      });

    return () => controller.abort();
  }, [token, owner, repo, startDate, endDate, fetchKey]);

  return { prs, isLoading, isFetchingMore, error, refetch };
}

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const queryClient = useQueryClient();
  const { token } = useGithubToken();
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
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
  } = useIncrementalPRs(token, owner, repo, startDate, endDate);

  const { data: viewerLogin } = useQuery({
    queryKey: ["viewer", token],
    queryFn: () => fetchViewerLogin(token!),
    enabled: !!token,
  });

  const { data: contributors } = useQuery({
    queryKey: ["contributors", owner, repo],
    queryFn: () => fetchContributors(token!, owner!, repo!),
    enabled: !!owner && !!repo && !!token,
    staleTime: 5 * 60 * 1000,
  });

  const prKeys = allPRs.map((p) => p.number).join(",");
  const { data: behindByData } = useQuery({
    queryKey: ["behindBy", owner, repo, prKeys],
    queryFn: () => fetchBehindByCounts(token!, owner!, repo!, allPRs, queryClient),
    enabled: !!owner && !!repo && !!token && allPRs.length > 0,
    staleTime: 60 * 1000,
  });

  const prCountByAuthor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pr of allPRs) {
      counts.set(pr.authorLogin, (counts.get(pr.authorLogin) ?? 0) + 1);
    }
    return counts;
  }, [allPRs]);

  const data = useMemo(() => {
    if (allPRs.length === 0 || !owner || !repo) return null;
    let prs = allPRs;
    if (authorFilter) {
      prs = prs.filter((pr) => pr.authorLogin === authorFilter);
    }
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
  }, [allPRs, owner, repo, viewerLogin, contributors, authorFilter, behindByData]);

  const error = prError ?? null;

  if (!token) {
    return <Navigate to="/" replace />;
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <Link to="/" style={styles.backLink}>
          &larr; Back
        </Link>
        <h1 style={styles.title}>
          {owner}/{repo}
        </h1>
        {data?.viewerLogin && (
          <span style={styles.viewer}>@{data.viewerLogin}</span>
        )}
        <span style={styles.badge}>
          {data
            ? `${data.nodes.filter((n) => n.type === "pr").length}${isFetchingMore ? "+" : ""} open PRs`
            : ""}
        </span>
        <RangePicker
          showTime
          value={dateRange}
          onChange={(dates) => {
            if (dates && dates[0] && dates[1]) {
              setDateRange([dates[0], dates[1]]);
            }
          }}
          allowClear={false}
          size="small"
          style={{ fontSize: 12 }}
        />
        <ContributorDropdown
          contributors={contributors ?? []}
          prCountByAuthor={prCountByAuthor}
          selected={authorFilter}
          onSelect={setAuthorFilter}
        />
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
      </header>

      <div style={styles.content}>
        {isLoading && (
          <div style={styles.statusContainer}>
            <Spinner />
            <p style={styles.status}>Loading pull requests...</p>
          </div>
        )}
        {error && (
          <div style={styles.errorContainer}>
            <p style={styles.error}>{error}</p>
            <button style={styles.retryBtn} onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}
        {data && (
          <GraphView data={data} orientation={orientation} token={token} />
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
      </div>
    </div>
  );
}

function ContributorDropdown({
  contributors,
  prCountByAuthor,
  selected,
  onSelect,
}: {
  contributors: Contributor[];
  prCountByAuthor: Map<string, number>;
  selected: string | null;
  onSelect: (login: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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

  const selectedContributor = contributors.find((c) => c.login === selected);

  return (
    <div ref={ref} style={dropdownStyles.wrapper} onKeyDown={handleKeyDown}>
      <button
        style={dropdownStyles.trigger}
        onClick={() => setOpen((o) => !o)}
        title="Filter by author"
      >
        {selectedContributor ? (
          <>
            <img
              src={selectedContributor.avatarUrl}
              alt={selectedContributor.login}
              style={dropdownStyles.triggerAvatar}
            />
            {selectedContributor.login}
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.561 8.073a6.005 6.005 0 0 1 3.432 5.142.75.75 0 1 1-1.498.07 4.5 4.5 0 0 0-8.99 0 .75.75 0 0 1-1.498-.07 6.005 6.005 0 0 1 3.431-5.142 3.999 3.999 0 1 1 5.123 0ZM10.5 5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
            </svg>
            All authors
          </>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 2 }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div style={dropdownStyles.menu}>
          <button
            className="contributor-dropdown-item"
            style={{
              ...dropdownStyles.item,
              fontWeight: selected === null ? 600 : 400,
            }}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            All authors
          </button>
          <div style={dropdownStyles.divider} />
          <div style={dropdownStyles.list}>
            {sortedContributors.map((c) => {
              const count = prCountByAuthor.get(c.login) ?? 0;
              return (
                <button
                  key={c.login}
                  className="contributor-dropdown-item"
                  style={{
                    ...dropdownStyles.item,
                    fontWeight: selected === c.login ? 600 : 400,
                  }}
                  onClick={() => {
                    onSelect(c.login);
                    setOpen(false);
                  }}
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
                  {selected === c.login && (
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
