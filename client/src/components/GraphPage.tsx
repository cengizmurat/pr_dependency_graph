import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchGraph } from "../api";
import type { GraphData } from "../types";
import GraphView from "./GraphView";

export default function GraphPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    fetchGraph(owner, repo)
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
  }, [owner, repo]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <Link to="/" style={styles.backLink}>
          &larr; Back
        </Link>
        <h1 style={styles.title}>
          {owner}/{repo}
        </h1>
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
    background: "#0d1117",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    color: "#e6edf3",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "12px 20px",
    borderBottom: "1px solid #21262d",
    background: "#161b22",
  },
  backLink: {
    color: "#58a6ff",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  },
  badge: {
    fontSize: 12,
    color: "#8b949e",
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
    color: "#8b949e",
    fontSize: 15,
  },
  error: {
    textAlign: "center" as const,
    marginTop: 80,
    color: "#f85149",
    fontSize: 15,
  },
};
