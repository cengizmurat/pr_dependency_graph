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
  reviewNone: "var(--color-review-none)",
};

// --- GraphPage settings ---

export const LOOKBACK_DAYS_KEY = "pr-graph-lookback-days";
export const DEFAULT_LOOKBACK_DAYS = 7;

export const LEGEND_COLLAPSED_KEY = "pr-graph-legend-collapsed";

// Whether reviews left by GitHub Apps are counted. Off by default: a bot that
// reviews every PR would otherwise top the reviewer list and leave PRs reading
// "Commented" on the strength of its comment alone.
export const INCLUDE_BOTS_KEY = "pr-graph-include-bots";
export const DEFAULT_INCLUDE_BOTS = false;

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

// The focus badge is grey: the other badge colors say something about the PR,
// this one is just an action.
export const SHARE_BADGE_COLOR = "var(--color-text-secondary)";

// GitHub's "eye" octicon (16px) — the glyph for focusing on a PR's stack, on
// the card badge, in the legend and in the focus banner.
export const EYE_ICON_PATH =
  "M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2Zm0 1.5c-1.51 0-2.879.755-4.02 1.73C2.85 6.193 2.02 7.31 1.617 8c.403.69 1.233 1.807 2.363 2.77C5.121 11.745 6.49 12.5 8 12.5c1.51 0 2.879-.755 4.02-1.73 1.13-.963 1.96-2.08 2.363-2.77-.403-.69-1.233-1.807-2.363-2.77C10.879 4.255 9.51 3.5 8 3.5ZM8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z";

// GitHub's "tag" octicon (16px), the glyph it puts beside a pull request label.
export const TAG_ICON_PATH =
  "M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z";

export const STATE_ICONS: Record<string, string> = {
  APPROVED: "M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z",
  CHANGES_REQUESTED: "M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z",
  COMMENTED: "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.458 1.458 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2v2.189l2.72-2.72.53-.219h4.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25z",
  DISMISSED: "M8 0a8 8 0 110 16A8 8 0 018 0zm3.28 5.78a.75.75 0 00-1.06-1.06L8 6.94 5.78 4.72a.75.75 0 00-1.06 1.06L6.94 8l-2.22 2.22a.75.75 0 101.06 1.06L8 9.06l2.22 2.22a.75.75 0 101.06-1.06L9.06 8z",
  REQUESTED: "M8 2a6 6 0 110 12A6 6 0 018 2zm0 1.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM8 5a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5v-1.5A.75.75 0 018 5z",
};

// --- Folder churn tab ---

// A folder's file lists are fetched one REST request per commit, so the
// request count is the commit count. Eight at a time keeps a few-hundred-commit
// window to a few seconds without tripping GitHub's secondary rate limit.
export const CHURN_CONCURRENCY = 8;

// A fetch is flagged as likely to run out of budget once it needs more than
// this share of what is left of the hourly quota. Below 1 so the warning
// arrives while a narrower interval is still worth choosing, rather than at
// the moment the requests start failing.
export const CHURN_RATE_LIMIT_HEADROOM = 0.9;

export const CHURN_MAX_RETRIES = 4;

// History pages read in the background to work out exactly how many commits a
// window still needs. Each page is one cheap GraphQL request covering 100
// commits; past this the total is reported without the cached/missing split
// rather than paging a very long history nobody has asked to fetch yet.
export const CHURN_HISTORY_PAGE_LIMIT = 20;

// Commits between cache checkpoints during a long fetch.
export const CHURN_SAVE_EVERY = 200;

// Shortest gap between progress renders while commits stream in. Publishing
// every commit would re-aggregate the whole history once per commit.
export const CHURN_PROGRESS_MS = 250;

// The trend chart holds at most this many folders — the length of the colour
// palette, and about as many lines as stay readable at once.
export const CHURN_MAX_SERIES = 8;

// Folders charted automatically when a new folder prefix is opened. Below the
// cap, so there is room to add a few by hand before anything has to be dropped.
export const CHURN_DEFAULT_SERIES = 5;

// Colour follows the folder, never its rank: a slot is claimed when a folder
// joins the chart and held until it leaves, so changing the interval, branch,
// measure or bucket size never repaints a series. The values behind these
// custom properties are a palette validated for colour-vision-deficiency
// separation and for contrast against both the light and the dark surface.
export const CHURN_SERIES_VARS = [
  "--churn-series-1",
  "--churn-series-2",
  "--churn-series-3",
  "--churn-series-4",
  "--churn-series-5",
  "--churn-series-6",
  "--churn-series-7",
  "--churn-series-8",
] as const;

export function churnSeriesColor(slot: number): string {
  return `var(${CHURN_SERIES_VARS[slot % CHURN_SERIES_VARS.length]})`;
}

export const CHURN_INTERVAL_PRESETS = [
  { id: "all", label: "All time", days: null },
  { id: "12m", label: "12 months", days: 365 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "90d", label: "90 days", days: 90 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

export type ChurnIntervalPreset = (typeof CHURN_INTERVAL_PRESETS)[number]["id"];

export const CHURN_DEFAULT_PRESET: ChurnIntervalPreset = "12m";

// GitHub's "file-directory" octicon (16px), the tab's glyph.
export const FOLDER_ICON_PATH =
  "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z";
