// --- GitHub API types ---

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "REQUESTED";

// Review states from strongest to weakest, used to collapse one reviewer's
// several reviews into the single state shown against their avatar. A reviewer
// can hold more than one at a time — an approval followed by a comment, a fresh
// review request on top of an earlier verdict — and this order resolves it
// rather than recency, so a passing comment never buries the approval
// underneath it. (The PR's own state is settled the same way, across every
// reviewer and GitHub's verdict together: see prReviewState.)
export const REVIEW_STATE_PRIORITY: readonly ReviewState[] = [
  "CHANGES_REQUESTED",
  "APPROVED",
  "COMMENTED",
  "DISMISSED",
  "REQUESTED",
];

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export interface Reviewer {
  login: string;
  avatarUrl: string;
  state: ReviewState;
  // A GitHub App rather than a person. Bot reviewers are fetched either way and
  // hidden downstream when the setting says so — see withoutBotContributions.
  isBot: boolean;
}

export interface PRLabel {
  name: string;
  color: string;
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

// Membership in a native GitHub stack, read from the `stack` / `stackEntry`
// fields on the GraphQL PullRequest type. Null for a PR that isn't stacked.
export interface PRStack {
  // Stack number, scoped to the repository — the one GitHub shows in its UI.
  number: number;
  // 1-based position from the bottom, where 1 targets the stack's base branch.
  position: number;
  size: number;
}

export interface GraphQLPullRequest {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  // When the PR last entered its current draft/ready state — the most recent
  // "ready for review" or "convert to draft" event, or the creation time for a
  // PR that has never switched. This is the age the card shows and the graph
  // sorts on, so a three-day draft opened ten minutes ago reads as ten minutes.
  stateChangedAt: string;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  authorLogin: string;
  authorAvatarUrl: string;
  labels: PRLabel[];
  reviewers: Reviewer[];
  commentCount: number;
  // The share of commentCount that came from bot reviews, so hiding bots is a
  // subtraction rather than a refetch.
  botCommentCount: number;
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: ReviewDecision;
  stack: PRStack | null;
}

// The little that is needed about a PR the graph didn't load: enough to say
// why it isn't on screen, and when it was opened so the date range can be
// widened to reach it.
export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  state: "OPEN" | "CLOSED" | "MERGED";
}

export interface CascadeResult {
  merged: number;
  updated: { number: number; title: string }[];
  errors: { number: number; message: string }[];
}

export interface PRPageResult {
  prs: GraphQLPullRequest[];
  hasNextPage: boolean;
  endCursor: string | null;
  pageSize: number;
}

export interface Contributor {
  login: string;
  avatarUrl: string;
}

export interface UserRepo {
  owner: string;
  repo: string;
  fullName: string;
  isPrivate: boolean;
  ownerType: "User" | "Organization";
  pushedAt: string | null;
}

// --- GitHub Actions types ---

export interface WorkflowInfo {
  id: number;
  name: string;
  // Repo-relative file path, e.g. ".github/workflows/ci.yml".
  path: string;
  state: string;
  htmlUrl: string;
}

export interface WorkflowRunInfo {
  id: number;
  runNumber: number;
  event: string;
  status: string;
  conclusion: string | null;
  headBranch: string | null;
  displayTitle: string;
  actorLogin: string;
  actorAvatarUrl: string;
  createdAt: string;
  runStartedAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WorkflowsPage {
  workflows: WorkflowInfo[];
  hasMore: boolean;
}

export interface WorkflowRunsPage {
  runs: WorkflowRunInfo[];
  hasMore: boolean;
}

export interface WorkflowStep {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  // When the job was queued; started_at - created_at is the runner wait.
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  steps: WorkflowStep[];
}

// --- Folder churn ---

export interface BranchList {
  names: string[];
  defaultBranch: string | null;
  // True when the repository has more branches than the selector fetched.
  truncated: boolean;
}

// One commit as the history query returns it, before its file list is known.
// `isMerge` comes from the parent count: a merge's file changes are already
// attributed to the commits it brings in, so counting it too double-counts.
export interface HistoryCommit {
  sha: string;
  committedDate: string;
  isMerge: boolean;
}

export interface CommitHistoryPage {
  commits: HistoryCommit[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

// A path touched by a commit, with the size of the change. `changes` is
// additions + deletions as GitHub reports them.
export interface CommitFile {
  path: string;
  changes: number;
}

// What is left of the token's hourly REST budget. Read from /rate_limit,
// which is itself free — it does not spend a request — so the cost of a
// pending fetch can be weighed against the budget before starting it.
export interface RateLimitStatus {
  limit: number;
  remaining: number;
  // Epoch ms when the window resets.
  resetAt: number;
}

// Every directory that exists at a branch tip, used to tell folders that are
// still there from ones that only exist in the history. `truncated` is
// GitHub's flag for a tree too large to return in one response — the GONE
// badge is suppressed rather than guessed when it is set.
export interface RepoTreeDirs {
  dirs: Set<string>;
  truncated: boolean;
}

// --- Graph data model types ---

export interface PRNode {
  type: "pr";
  id: string;
  number: number;
  title: string;
  url: string;
  author: string;
  avatarUrl: string;
  baseBranch: string;
  headBranch: string;
  isDraft: boolean;
  labels: PRLabel[];
  createdAt: string;
  // See GraphQLPullRequest.stateChangedAt.
  stateChangedAt: string;
  additions: number;
  deletions: number;
  reviewers: {
    login: string;
    avatarUrl: string;
    state: ReviewState;
  }[];
  // GitHub's own verdict on the PR, which is what its review state is read
  // from — see prReviewState.
  reviewDecision: ReviewDecision;
  commentCount: number;
  behindBy?: number;
  stack?: PRStack | null;
}

export interface BranchNode {
  type: "branch";
  id: string;
  name: string;
  url: string;
}

export type GraphNode = PRNode | BranchNode;

export type EdgeReviewStatus = "approved" | "changes_requested" | null;

export interface GraphEdge {
  source: string;
  target: string;
  hasConflict: boolean;
  isMergeable: boolean;
  reviewStatus: EdgeReviewStatus;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  owner: string;
  repo: string;
  viewerLogin?: string;
  contributors?: Contributor[];
}

// --- Layout types ---

export type Orientation = "horizontal" | "vertical";

export interface LayoutNode {
  data: GraphNode;
  x: number;
  y: number;
  children: LayoutNode[];
}

export interface FlatEdge {
  source: LayoutNode;
  target: LayoutNode;
  hasConflict: boolean;
  isMergeable: boolean;
  reviewStatus: EdgeReviewStatus;
}

export interface EdgeFlags {
  hasConflict: boolean;
  isMergeable: boolean;
  reviewStatus: EdgeReviewStatus;
}

// --- Component types ---

export type PRStatusFilter = "all" | "ready" | "draft";

export interface MergeStatus {
  hasConflict: boolean;
  isMergeable: boolean;
}
