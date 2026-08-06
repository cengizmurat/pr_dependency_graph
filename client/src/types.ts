// --- GitHub API types ---

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "REQUESTED";

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export interface Reviewer {
  login: string;
  avatarUrl: string;
  state: ReviewState;
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
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  authorLogin: string;
  authorAvatarUrl: string;
  labels: PRLabel[];
  reviewers: Reviewer[];
  commentCount: number;
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: ReviewDecision;
  stack: PRStack | null;
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
  additions: number;
  deletions: number;
  reviewers: {
    login: string;
    avatarUrl: string;
    state: ReviewState;
  }[];
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

export const REVIEW_STATE_FILTER_VALUES = [
  "REQUESTED",
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
] as const;
export type ReviewStateFilter = (typeof REVIEW_STATE_FILTER_VALUES)[number];

export interface MergeStatus {
  hasConflict: boolean;
  isMergeable: boolean;
}
