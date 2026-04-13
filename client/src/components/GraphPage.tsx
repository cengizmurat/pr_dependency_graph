import { useEffect, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { fetchGraph } from "../api";
import { useGithubToken } from "../hooks/useGithubToken";
import type { GraphData } from "../types";
import GraphView from "./GraphView";
import type { Orientation } from "./GraphView";

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useGithubToken();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [orientation, setOrientation] = useState<Orientation>("horizontal");

  useEffect(() => {
    if (!owner || !repo || !token) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    fetchGraph(owner, repo, token)
      .then((graph) => {
        if (!cancelled) setData(graph);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo, token]);

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
            ? `${data.nodes.filter((n) => n.type === "pr").length} open PRs`
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
        {loading && <p style={styles.status}>Loading pull requests...</p>}
        {error && <p style={styles.error}>{error}</p>}
        {data && !loading && (
          <GraphView data={data} orientation={orientation} token={token} />
        )}
      </div>
    </div>
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
  status: {
    textAlign: "center" as const,
    marginTop: 80,
    color: "var(--color-text-secondary)",
    fontSize: 15,
  },
  error: {
    textAlign: "center" as const,
    marginTop: 80,
    color: "var(--color-error)",
    fontSize: 15,
  },
};
