import type { PRNode } from "../types";
import type { Orientation } from "./GraphView";

interface MergeStatus {
  hasConflict: boolean;
  isMergeable: boolean;
}

interface Props {
  pr: PRNode;
  mergeStatus?: MergeStatus;
  isMerging?: boolean;
  onMerge?: (prNumber: number, prTitle: string) => void;
  onUpdateBranch?: (prNumber: number) => void;
  orientation?: Orientation;
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

const STATE_COLORS: Record<string, string> = {
  APPROVED: "#238636",
  CHANGES_REQUESTED: "#da3633",
  COMMENTED: "#8b949e",
  DISMISSED: "#6e7681",
  REQUESTED: "#d29922",
};

const STATE_ICONS: Record<string, string> = {
  APPROVED: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z",
  CHANGES_REQUESTED: "M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z",
  COMMENTED: "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2v2.189l2.72-2.72.53-.219h4.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25z",
  DISMISSED: "M8 0a8 8 0 110 16A8 8 0 018 0zm3.28 5.78a.75.75 0 00-1.06-1.06L8 6.94 5.78 4.72a.75.75 0 00-1.06 1.06L6.94 8l-2.22 2.22a.75.75 0 101.06 1.06L8 9.06l2.22 2.22a.75.75 0 101.06-1.06L9.06 8z",
  REQUESTED: "M8 2a6 6 0 110 12A6 6 0 018 2zm0 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM8 5a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5v-1.5A.75.75 0 018 5z",
};

function MergeBadge({
  status,
  isMerging,
  onMerge,
  prNumber,
  prTitle,
}: {
  status: MergeStatus;
  isMerging: boolean;
  onMerge?: (prNumber: number, prTitle: string) => void;
  prNumber: number;
  prTitle: string;
}) {
  const isConflict = status.hasConflict;
  const clickable = status.isMergeable && !isConflict && !!onMerge;
  const color = isConflict ? "var(--color-conflict)" : "var(--color-ready)";

  return (
    <button
      type="button"
      title={isConflict ? "Merge conflict" : "Merge PR"}
      disabled={!clickable || isMerging}
      onClick={
        clickable
          ? (evt) => {
              evt.stopPropagation();
              onMerge(prNumber, prTitle);
            }
          : undefined
      }
      style={{
        ...badgeStyles.box,
        borderColor: color,
        cursor: clickable ? "pointer" : "default",
        opacity: isMerging ? 0.5 : 1,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
        {isConflict ? (
          <path
            d="M3 3L9 9M9 3L3 9"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <path
            d="M2 6L5 9L10 3"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

function UpdateBadge({
  behindBy,
  onUpdateBranch,
  prNumber,
}: {
  behindBy: number;
  onUpdateBranch?: (prNumber: number) => void;
  prNumber: number;
}) {
  const color = "var(--color-behind)";

  return (
    <button
      type="button"
      title={`Behind by ${behindBy} commit${behindBy === 1 ? "" : "s"} — click to update branch`}
      onClick={
        onUpdateBranch
          ? (evt) => {
              evt.stopPropagation();
              onUpdateBranch(prNumber);
            }
          : undefined
      }
      style={{
        ...badgeStyles.box,
        borderColor: color,
        cursor: onUpdateBranch ? "pointer" : "default",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill={color}>
        <path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5ZM1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834Z" />
      </svg>
    </button>
  );
}

export default function PRCard({ pr, mergeStatus, isMerging, onMerge, onUpdateBranch, orientation = "horizontal" }: Props) {
  const visibleReviewers = pr.reviewers.slice(0, MAX_REVIEWER_AVATARS);
  const extraCount = pr.reviewers.length - MAX_REVIEWER_AVATARS;

  const hasMergeBadge = mergeStatus && (mergeStatus.hasConflict || mergeStatus.isMergeable);
  const hasUpdateBadge = pr.behindBy != null && pr.behindBy > 0;
  const hasBadges = hasMergeBadge || hasUpdateBadge;

  return (
    <div style={styles.card} data-draft={pr.isDraft || undefined}>
      {hasBadges && (
        <div
          style={{
            ...badgeStyles.container,
            flexDirection: orientation === "horizontal" ? "column" : "row",
          }}
        >
          {hasMergeBadge && (
            <MergeBadge
              status={mergeStatus}
              isMerging={!!isMerging}
              onMerge={onMerge}
              prNumber={pr.number}
              prTitle={pr.title}
            />
          )}
          {hasUpdateBadge && (
            <UpdateBadge
              behindBy={pr.behindBy!}
              onUpdateBranch={onUpdateBranch}
              prNumber={pr.number}
            />
          )}
        </div>
      )}
      <div style={styles.header}>
        <span
          style={{
            ...styles.dot,
            backgroundColor: pr.isDraft
              ? "var(--color-draft)"
              : "var(--color-ready)",
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
                <div
                  key={r.login}
                  style={styles.reviewerWrap}
                  title={`${r.login}: ${r.state.toLowerCase().replace("_", " ")}`}
                >
                  <img
                    src={r.avatarUrl}
                    alt={r.login}
                    style={styles.reviewerAvatar}
                  />
                  <span
                    style={{
                      ...styles.stateBadge,
                      backgroundColor: STATE_COLORS[r.state] ?? "#8b949e",
                    }}
                  >
                    <svg width="7" height="7" viewBox="0 0 16 16" fill="#ffffff">
                      <path d={STATE_ICONS[r.state] ?? STATE_ICONS.COMMENTED} />
                    </svg>
                  </span>
                </div>
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
                fill="var(--color-text-secondary)"
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
    position: "relative" as const,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-evenly",
    padding: "8px 12px",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    overflow: "visible",
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
    color: "var(--color-text)",
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
    color: "var(--color-text-secondary)",
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
    color: "var(--color-text-secondary)",
    whiteSpace: "nowrap" as const,
  },
  diff: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  additions: {
    color: "var(--color-additions)",
    fontWeight: 600,
    whiteSpace: "nowrap" as const,
  },
  deletions: {
    color: "var(--color-deletions)",
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
    color: "var(--color-text-secondary)",
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
  reviewerWrap: {
    position: "relative" as const,
    marginLeft: -4,
    width: 19,
    height: 19,
    flexShrink: 0,
  },
  reviewerAvatar: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "1.5px solid var(--color-avatar-border)",
  },
  stateBadge: {
    position: "absolute" as const,
    bottom: -2,
    right: -3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 11,
    height: 11,
    borderRadius: "50%",
    border: "1.5px solid var(--color-avatar-border)",
  },
  extraCount: {
    color: "var(--color-text-secondary)",
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
    color: "var(--color-text-secondary)",
    fontSize: 11,
    whiteSpace: "nowrap" as const,
  },
};

const badgeStyles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    left: 0,
    top: "50%",
    transform: "translate(-50%, -50%)",
    display: "flex",
    alignItems: "center",
    gap: 4,
    zIndex: 10,
  },
  box: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 5,
    border: "2px solid",
    background: "var(--color-page-bg)",
    padding: 0,
    flexShrink: 0,
  },
};
