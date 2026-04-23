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

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;

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
  labels: string[];
  reviewers: Reviewer[];
  commentCount: number;
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: ReviewDecision;
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
  labels: string[];
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

export interface MergeStatus {
  hasConflict: boolean;
  isMergeable: boolean;
}
