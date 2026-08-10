import type { PRNode, PRLabel, PRStack, Orientation, MergeStatus } from "../types";
import {
  EYE_ICON_PATH,
  MAX_REVIEWER_AVATARS,
  SHARE_BADGE_COLOR,
  STACK_ICON_PATH,
  STATE_COLORS,
  STATE_ICONS,
} from "../constants";
import { timeAgo } from "../utils";
import { styles, badgeStyles } from "./PRCard.styles";

function labelTextColor(hex: string): string {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return "#ffffff";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return "#ffffff";
  // Perceived luminance — dark text on light labels, light on dark.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1f2328" : "#ffffff";
}

// The card's age is how long the PR has been in the state it is in now, not how
// long ago it was opened — a PR drafted three days ago and made ready ten
// minutes ago reads "10m ago". The tooltip says which of the two it is, and
// gives the creation date whenever the PR has switched state since.
function ageTitle(pr: PRNode): string {
  const opened = `Opened ${new Date(pr.createdAt).toLocaleString()}`;
  if (pr.stateChangedAt === pr.createdAt) return opened;
  const changed = new Date(pr.stateChangedAt).toLocaleString();
  const label = pr.isDraft ? "Converted to draft" : "Ready for review";
  return `${label} ${changed} — ${opened}`;
}

interface Props {
  pr: PRNode;
  mergeStatus?: MergeStatus;
  isMerging?: boolean;
  isUpdating?: boolean;
  isCurrentlyUpdating?: boolean;
  onMerge?: (prNumber: number, prTitle: string) => void;
  onUpdateBranch?: (prNumber: number) => void;
  onFocus?: (prNumber: number) => void;
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

// Where this PR sits in its GitHub stack, as GitHub's stack icon followed by
// "position/size" — 2/3 is the middle PR of a three-layer stack, counting from
// the bottom (the one that targets the stack's base branch).
function StackBadge({ stack }: { stack: PRStack }) {
  const color = "var(--color-stack)";

  return (
    <span
      title={`Stack #${stack.number} — layer ${stack.position} of ${stack.size}`}
      style={{ ...badgeStyles.box, ...badgeStyles.stackBox, borderColor: color }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill={color} style={{ flexShrink: 0 }}>
        <path d={STACK_ICON_PATH} />
      </svg>
      <span style={badgeStyles.stackPosition}>
        {stack.position}/{stack.size}
      </span>
    </span>
  );
}

function UpdateBadge({
  behindBy,
  onUpdateBranch,
  prNumber,
  isStacked,
  isUpdating,
  isCurrentlyUpdating,
}: {
  behindBy: number;
  onUpdateBranch?: (prNumber: number) => void;
  prNumber: number;
  isStacked?: boolean;
  isUpdating?: boolean;
  isCurrentlyUpdating?: boolean;
}) {
  const color = "var(--color-behind)";
  const clickable = !!onUpdateBranch && !isUpdating;
  const behindLabel = `Behind by ${behindBy} commit${behindBy === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      title={
        isUpdating
          ? "Updating branch…"
          : isStacked
            ? `${behindLabel} — a stacked PR is rebased from its own stack, open the pull request to rebase it`
            : `${behindLabel} — click to update branch`
      }
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
        style={isCurrentlyUpdating ? { animation: "spin 0.8s linear infinite" } : undefined}
      >
        <path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5ZM1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834Z" />
      </svg>
    </button>
  );
}

// Focuses the graph on this PR and the PRs stacked on top of it, which also
// puts the PR in the page address — the link to share. It sits with the other
// badges rather than inside the card body so it can't push the title around.
//
// Grey, unlike the badges beside it: those colors carry meaning about the PR
// (mergeable, conflicted, behind, stacked), while this one is an action that
// says nothing about the PR's state.
function FocusBadge({
  prNumber,
  onFocus,
}: {
  prNumber: number;
  onFocus: (prNumber: number) => void;
}) {
  return (
    <button
      type="button"
      title={`Focus on PR #${prNumber} and the PRs stacked on it — the page link then opens this view`}
      aria-label={`Focus on PR #${prNumber} and the PRs stacked on it`}
      onClick={(evt) => {
        evt.stopPropagation();
        onFocus(prNumber);
      }}
      style={{
        ...badgeStyles.box,
        borderColor: SHARE_BADGE_COLOR,
        cursor: "pointer",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill={SHARE_BADGE_COLOR}>
        <path d={EYE_ICON_PATH} />
      </svg>
    </button>
  );
}

export default function PRCard({ pr, mergeStatus, isMerging, isUpdating, isCurrentlyUpdating, onMerge, onUpdateBranch, onFocus, orientation = "horizontal" }: Props) {
  const visibleReviewers = pr.reviewers.slice(0, MAX_REVIEWER_AVATARS);
  const extraCount = pr.reviewers.length - MAX_REVIEWER_AVATARS;

  const hasMergeBadge = mergeStatus && (mergeStatus.hasConflict || mergeStatus.isMergeable);
  const hasUpdateBadge = isUpdating || (pr.behindBy != null && pr.behindBy > 0);
  const hasBadges = hasMergeBadge || hasUpdateBadge || !!pr.stack || !!onFocus;

  return (
    <div style={styles.card} data-draft={pr.isDraft || undefined}>
      {hasBadges && (
        <div
          style={{
            ...badgeStyles.container,
            flexDirection: orientation === "horizontal" ? "column" : "row",
          }}
        >
          {pr.stack && <StackBadge stack={pr.stack} />}
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
              isStacked={!!pr.stack}
              isUpdating={isUpdating}
              isCurrentlyUpdating={isCurrentlyUpdating}
            />
          )}
          {onFocus && <FocusBadge prNumber={pr.number} onFocus={onFocus} />}
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

      {pr.labels.length > 0 && (
        <div style={styles.labels}>
          {pr.labels.map((label: PRLabel) => (
            <span
              key={label.name}
              title={label.name}
              style={{
                ...styles.label,
                backgroundColor: `#${label.color}`,
                color: labelTextColor(label.color),
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div style={styles.row}>
        <span style={styles.age} title={ageTitle(pr)}>
          {timeAgo(pr.stateChangedAt)}
        </span>
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
