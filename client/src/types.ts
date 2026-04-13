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
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "REQUESTED";
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

export interface Contributor {
  login: string;
  avatarUrl: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  owner: string;
  repo: string;
  viewerLogin?: string;
  contributors?: Contributor[];
}
