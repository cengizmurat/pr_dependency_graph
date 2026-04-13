import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchOpenPRs, fetchViewerLogin, fetchContributors, buildDependencyGraph } from "../api";
import type { PRPageResult } from "../api";
import type { Contributor } from "../types";
import { useGithubToken } from "../hooks/useGithubToken";
import GraphView from "./GraphView";
import type { Orientation } from "./GraphView";

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useGithubToken();
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const pageSizeRef = useRef<number | undefined>(undefined);

  const {
    data: prPages,
    error: prError,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery<PRPageResult, Error>({
    queryKey: ["prs", owner, repo],
    queryFn: async ({ pageParam }) => {
      const result = await fetchOpenPRs(
        token!, owner!, repo!,
        pageParam as string | null,
        pageSizeRef.current,
      );
      pageSizeRef.current = result.pageSize;
      return result;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.hasNextPage ? lastPage.endCursor : undefined,
    enabled: !!owner && !!repo && !!token,
  });

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

  const prCountByAuthor = useMemo(() => {
    const counts = new Map<string, number>();
    if (!prPages) return counts;
    for (const page of prPages.pages) {
      for (const pr of page.prs) {
        counts.set(pr.authorLogin, (counts.get(pr.authorLogin) ?? 0) + 1);
      }
    }
    return counts;
  }, [prPages]);

  const data = useMemo(() => {
    if (!prPages || !owner || !repo) return null;
    let allPRs = prPages.pages.flatMap((page) => page.prs);
    if (authorFilter) {
      allPRs = allPRs.filter((pr) => pr.authorLogin === authorFilter);
    }
    const graph = buildDependencyGraph(allPRs, owner, repo);
    if (viewerLogin) graph.viewerLogin = viewerLogin;
    if (contributors) graph.contributors = contributors;
    return graph;
  }, [prPages, owner, repo, viewerLogin, contributors, authorFilter]);

  const error = prError?.message ?? null;

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
            ? `${data.nodes.filter((n) => n.type === "pr").length}${hasNextPage ? "+" : ""} open PRs`
            : ""}
        </span>
        <ContributorDropdown
          contributors={contributors ?? []}
          prCountByAuthor={prCountByAuthor}
          selected={authorFilter}
          onSelect={setAuthorFilter}
        />
        <span style={styles.toggleLabel}>Orientation:</span>
        <button
          style={styles.toggleBtn}
          onClick={() =>
            setOrientation((o) => (o === "horizontal" ? "vertical" : "horizontal"))
          }
          title={`Switch to ${orientation === "horizontal" ? "vertical" : "horizontal"} layout`}
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
        {data && !isLoading && (
          <>
            <GraphView data={data} orientation={orientation} token={token} />
            {hasNextPage && (
              <div style={styles.loadMoreContainer}>
                <button
                  style={styles.loadMoreBtn}
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <><Spinner size={14} /> Loading...</>
                  ) : (
                    `Load next ${pageSizeRef.current ?? 50} PRs`
                  )}
                </button>
              </div>
            )}
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

const dropdownStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
  },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    cursor: "pointer",
    background: "transparent",
    color: "var(--color-text-secondary)",
    transition: "background 0.15s, color 0.15s",
    whiteSpace: "nowrap",
  },
  triggerAvatar: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    flexShrink: 0,
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    minWidth: 200,
    background: "var(--color-header-bg)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 8,
    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
    zIndex: 100,
    overflow: "hidden",
  },
  list: {
    maxHeight: 280,
    overflowY: "auto" as const,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 12px",
    fontSize: 13,
    border: "none",
    background: "transparent",
    color: "var(--color-text)",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.1s",
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    flexShrink: 0,
  },
  count: {
    color: "var(--color-text-secondary)",
    fontSize: 12,
    fontWeight: 400,
    flexShrink: 0,
  },
  divider: {
    height: 1,
    background: "var(--color-border-subtle)",
  },
};

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

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "var(--color-page-bg)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    color: "var(--color-text)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "12px 20px",
    borderBottom: "1px solid var(--color-border-subtle)",
    background: "var(--color-header-bg)",
  },
  backLink: {
    color: "var(--color-link)",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },
  viewer: {
    fontSize: 13,
    color: "var(--color-text-secondary)",
    fontWeight: 500,
  },
  badge: {
    fontSize: 12,
    color: "var(--color-text-secondary)",
    marginLeft: "auto",
  },
  toggleLabel: {
    fontSize: 12,
    color: "var(--color-text-secondary)",
    fontWeight: 500,
  },
  toggleBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    cursor: "pointer",
    background: "transparent",
    color: "var(--color-text-secondary)",
    transition: "background 0.15s, color 0.15s",
  } as React.CSSProperties,
  githubLink: {
    color: "var(--color-text-secondary)",
    display: "flex",
    alignItems: "center",
    marginLeft: 8,
    opacity: 0.7,
    transition: "opacity 0.15s",
  },
  content: {
    flex: 1,
    position: "relative" as const,
    overflow: "hidden",
  },
  statusContainer: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    marginTop: 80,
    gap: 12,
  },
  status: {
    textAlign: "center" as const,
    margin: 0,
    color: "var(--color-text-secondary)",
    fontSize: 15,
  },
  errorContainer: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    marginTop: 80,
    gap: 12,
  },
  error: {
    textAlign: "center" as const,
    margin: 0,
    color: "var(--color-error)",
    fontSize: 15,
  },
  retryBtn: {
    padding: "6px 16px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    background: "transparent",
    color: "var(--color-text)",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  loadMoreContainer: {
    position: "absolute" as const,
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 10,
  },
  loadMoreBtn: {
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-header-bg)",
    color: "var(--color-text)",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    transition: "background 0.15s, opacity 0.15s",
  },
};
