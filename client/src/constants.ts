// --- Graph layout dimensions ---

export const PR_WIDTH = 280;
export const PR_HEIGHT = 120;
export const BRANCH_WIDTH = 140;
export const BRANCH_HEIGHT = 36;

export const SPACING = {
  horizontal: { depth: 370, sibling: 190 },
  vertical: { depth: 260, sibling: 320 },
};

export const COLORS = {
  ready: "var(--color-ready)",
  draft: "var(--color-draft)",
  readyBg: "var(--color-ready-bg)",
  draftBg: "var(--color-draft-bg)",
  branch: "var(--color-branch)",
  branchBg: "var(--color-branch-bg)",
  edge: "var(--color-edge)",
  conflict: "var(--color-conflict)",
  hover: "var(--color-hover)",
  behind: "var(--color-behind)",
  stack: "var(--color-stack)",
  reviewRequested: "var(--color-review-requested)",
  reviewCommented: "var(--color-review-commented)",
};

// --- GraphPage settings ---

export const LOOKBACK_DAYS_KEY = "pr-graph-lookback-days";
export const DEFAULT_LOOKBACK_DAYS = 7;

export const LEGEND_COLLAPSED_KEY = "pr-graph-legend-collapsed";

// --- Workflows tab ---

// Batch sizes for the sidebar lists; a "Load more" button fetches the next
// batch when the repository has more.
export const WORKFLOWS_PAGE_SIZE = 30;
export const WORKFLOW_RUNS_PAGE_SIZE = 20;

// --- PRCard reviewer display ---

export const MAX_REVIEWER_AVATARS = 4;

export const STATE_COLORS: Record<string, string> = {
  APPROVED: "#238636",
  CHANGES_REQUESTED: "#da3633",
  COMMENTED: "#8b949e",
  DISMISSED: "#6e7681",
  REQUESTED: "#d29922",
};

// GitHub's "stack" octicon (16px), the glyph it puts on a stacked pull request.
export const STACK_ICON_PATH =
  "M7.122.392a1.75 1.75 0 0 1 1.756 0l5.003 2.902c.83.481.83 1.68 0 2.162L8.878 8.358a1.75 1.75 0 0 1-1.756 0L2.119 5.456a1.251 1.251 0 0 1 0-2.162ZM8.125 1.69a.248.248 0 0 0-.25 0l-4.63 2.685 4.63 2.685a.248.248 0 0 0 .25 0l4.63-2.685ZM1.601 7.789a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0L1.874 8.814A.75.75 0 0 1 1.6 7.789Zm0 3.5a.75.75 0 0 1 1.025-.273l5.249 3.044a.248.248 0 0 0 .25 0l5.249-3.044a.75.75 0 0 1 .752 1.298l-5.248 3.044a1.75 1.75 0 0 1-1.756 0l-5.248-3.044a.75.75 0 0 1-.273-1.025Z";

export const STATE_ICONS: Record<string, string> = {
  APPROVED: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z",
  CHANGES_REQUESTED: "M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z",
  COMMENTED: "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2v2.189l2.72-2.72.53-.219h4.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25z",
  DISMISSED: "M8 0a8 8 0 110 16A8 8 0 018 0zm3.28 5.78a.75.75 0 00-1.06-1.06L8 6.94 5.78 4.72a.75.75 0 00-1.06 1.06L6.94 8l-2.22 2.22a.75.75 0 101.06 1.06L8 9.06l2.22 2.22a.75.75 0 101.06-1.06L9.06 8z",
  REQUESTED: "M8 2a6 6 0 110 12A6 6 0 018 2zm0 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM8 5a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5v-1.5A.75.75 0 018 5z",
};
