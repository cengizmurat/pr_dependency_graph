import type { PRNode } from "../types";

interface Props {
  pr: PRNode;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export default function PRCard({ pr }: Props) {
  return (
    <div style={styles.card} data-draft={pr.isDraft || undefined}>
      <div style={styles.header}>
        <span
          style={{
            ...styles.dot,
            backgroundColor: pr.isDraft ? "#6e7681" : "#238636",
          }}
        />
        <span style={styles.title}>
          #{pr.number} {pr.title}
        </span>
      </div>
      <div style={styles.meta}>
        <span style={styles.branch}>{pr.headBranch}</span>
        <div style={styles.stats}>
          <span style={styles.age}>{timeAgo(pr.createdAt)}</span>
          <span style={styles.additions}>+{pr.additions}</span>
          <span style={styles.deletions}>&minus;{pr.deletions}</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 12px",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    minWidth: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 3,
  },
  title: {
    color: "#e6edf3",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: "1.3",
    wordBreak: "break-word" as const,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  },
  meta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingLeft: 18,
    minWidth: 0,
  },
  branch: {
    color: "#8b949e",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flexShrink: 1,
    minWidth: 0,
  },
  stats: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    fontSize: 11,
  },
  age: {
    color: "#8b949e",
    whiteSpace: "nowrap" as const,
  },
  additions: {
    color: "#3fb950",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },
  deletions: {
    color: "#f85149",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },
};
