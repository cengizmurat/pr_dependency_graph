import type { PRNode, Orientation, MergeStatus } from "../types";
import { MAX_REVIEWER_AVATARS, STATE_COLORS, STATE_ICONS } from "../constants";
import { timeAgo } from "../utils";
import { styles, badgeStyles } from "./PRCard.styles";

interface Props {
  pr: PRNode;
  mergeStatus?: MergeStatus;
  isMerging?: boolean;
  isUpdating?: boolean;
  onMerge?: (prNumber: number, prTitle: string) => void;
  onUpdateBranch?: (prNumber: number) => void;
  orientation?: Orientation;
}

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
  isUpdating,
}: {
  behindBy: number;
  onUpdateBranch?: (prNumber: number) => void;
  prNumber: number;
  isUpdating?: boolean;
}) {
  const color = "var(--color-behind)";
  const clickable = !!onUpdateBranch && !isUpdating;

  return (
    <button
      type="button"
      title={isUpdating ? "Updating branch…" : `Behind by ${behindBy} commit${behindBy === 1 ? "" : "s"} — click to update branch`}
      disabled={isUpdating}
      onClick={
        clickable
          ? (evt) => {
              evt.stopPropagation();
              onUpdateBranch(prNumber);
            }
          : undefined
      }
      style={{
        ...badgeStyles.box,
        borderColor: color,
        cursor: clickable ? "pointer" : "default",
      }}
    >
      {!isUpdating && <span style={badgeStyles.notificationBubble}>{behindBy}</span>}
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill={color}
        style={isUpdating ? { animation: "spin 0.8s linear infinite" } : undefined}
      >
        <path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5ZM1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834Z" />
      </svg>
    </button>
  );
}

export default function PRCard({ pr, mergeStatus, isMerging, isUpdating, onMerge, onUpdateBranch, orientation = "horizontal" }: Props) {
  const visibleReviewers = pr.reviewers.slice(0, MAX_REVIEWER_AVATARS);
  const extraCount = pr.reviewers.length - MAX_REVIEWER_AVATARS;

  const hasMergeBadge = mergeStatus && (mergeStatus.hasConflict || mergeStatus.isMergeable);
  const hasUpdateBadge = isUpdating || (pr.behindBy != null && pr.behindBy > 0);
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
              behindBy={pr.behindBy ?? 0}
              onUpdateBranch={onUpdateBranch}
              prNumber={pr.number}
              isUpdating={isUpdating}
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

      <span style={styles.branch}>{pr.headBranch}</span>

      <div style={styles.row}>
        <span style={styles.age}>{timeAgo(pr.createdAt)}</span>
        <div style={styles.diff}>
          <span style={styles.additions}>+{pr.additions}</span>
          <span style={styles.deletions}>&minus;{pr.deletions}</span>
        </div>
      </div>

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
