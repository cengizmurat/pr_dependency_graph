import type { PRNode } from "../types";

interface Props {
  pr: PRNode;
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
      <span style={styles.branch}>{pr.headBranch}</span>
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
  branch: {
    color: "#8b949e",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    paddingLeft: 18,
  },
};
