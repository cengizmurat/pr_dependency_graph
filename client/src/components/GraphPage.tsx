import { useEffect, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { fetchGraph } from "../api";
import { useGithubToken } from "../hooks/useGithubToken";
import type { GraphData } from "../types";
import GraphView from "./GraphView";

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { token } = useGithubToken();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      </header>

      <div style={styles.content}>
        {loading && <p style={styles.status}>Loading pull requests...</p>}
        {error && <p style={styles.error}>{error}</p>}
        {data && !loading && <GraphView data={data} />}
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
