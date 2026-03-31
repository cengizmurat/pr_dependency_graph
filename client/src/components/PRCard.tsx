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

const MAX_REVIEWER_AVATARS = 4;

export default function PRCard({ pr }: Props) {
  const visibleReviewers = pr.reviewers.slice(0, MAX_REVIEWER_AVATARS);
  const extraCount = pr.reviewers.length - MAX_REVIEWER_AVATARS;

  return (
    <div style={styles.card} data-draft={pr.isDraft || undefined}>
      {/* Row 1: title */}
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

      {/* Row 2: branch */}
      <span style={styles.branch}>{pr.headBranch}</span>

      {/* Row 3: time since open + diff stats */}
      <div style={styles.row}>
        <span style={styles.age}>{timeAgo(pr.createdAt)}</span>
        <div style={styles.diff}>
          <span style={styles.additions}>+{pr.additions}</span>
          <span style={styles.deletions}>&minus;{pr.deletions}</span>
        </div>
      </div>

      {/* Row 4: author, reviewers, comments */}
      <div style={styles.row}>
        <div style={styles.authorBlock}>
          <img src={pr.avatarUrl} alt={pr.author} style={styles.avatar} />
          <span style={styles.authorName}>{pr.author}</span>
        </div>

        <div style={styles.rowRight}>
          {visibleReviewers.length > 0 && (
            <div style={styles.reviewers}>
              {visibleReviewers.map((r) => (
                <img
                  key={r.login}
                  src={r.avatarUrl}
                  alt={r.login}
                  title={r.login}
                  style={styles.reviewerAvatar}
                />
              ))}
              {extraCount > 0 && (
                <span style={styles.extraCount}>+{extraCount}</span>
              )}
            </div>
          )}

          {pr.commentCount > 0 && (
            <div style={styles.comments}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="#8b949e"
                style={{ flexShrink: 0 }}
              >
                <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2v2.189l2.72-2.72.53-.219h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
              </svg>
              <span style={styles.commentCount}>{pr.commentCount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-evenly",
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
    alignItems: "center",
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
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingLeft: 18,
    minWidth: 0,
    fontSize: 11,
  },
  age: {
    color: "#8b949e",
    whiteSpace: "nowrap" as const,
  },
  diff: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
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
  authorBlock: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    flexShrink: 1,
  },
  avatar: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    flexShrink: 0,
  },
  authorName: {
    color: "#8b949e",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  rowRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  reviewers: {
    display: "flex",
    alignItems: "center",
  },
  reviewerAvatar: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "1.5px solid #0d1117",
    marginLeft: -4,
  },
  extraCount: {
    color: "#8b949e",
    fontSize: 10,
    marginLeft: 2,
    whiteSpace: "nowrap" as const,
  },
  comments: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  commentCount: {
    color: "#8b949e",
    fontSize: 11,
    whiteSpace: "nowrap" as const,
  },
};
