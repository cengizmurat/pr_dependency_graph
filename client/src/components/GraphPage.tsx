import { useMemo, useRef, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchOpenPRs, fetchViewerLogin, buildDependencyGraph } from "../api";
import type { PRPageResult } from "../api";
import { useGithubToken } from "../hooks/useGithubToken";
import GraphView from "./GraphView";
import type { Orientation } from "./GraphView";

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useGithubToken();
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
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

  const data = useMemo(() => {
    if (!prPages || !owner || !repo) return null;
    const allPRs = prPages.pages.flatMap((page) => page.prs);
    const graph = buildDependencyGraph(allPRs, owner, repo);
    if (viewerLogin) graph.viewerLogin = viewerLogin;
    return graph;
  }, [prPages, owner, repo, viewerLogin]);

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
