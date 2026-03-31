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
}

export interface BranchNode {
  type: "branch";
  id: string;
  name: string;
  url: string;
}

export type GraphNode = PRNode | BranchNode;

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  owner: string;
  repo: string;
}
