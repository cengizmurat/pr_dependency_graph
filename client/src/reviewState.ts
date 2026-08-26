import type { ReviewDecision, ReviewState } from "./types";
import { COLORS } from "./constants";

// A pull request's overall review state: one value per PR, drawn as the node's
// outline colour in the graph and named in the legend.
//
// The two verdicts come straight from GitHub's own `reviewDecision` — the field
// behind the banner and the merge button on the PR page — so the graph says
// what GitHub says rather than recomputing a verdict from individual reviews.
// `reviewDecision` is silent about comments though: a PR still waiting on
// review reads REVIEW_REQUIRED whether or not anyone has written on it, so that
// one case is split by looking at the reviews themselves.
export type PRReviewState =
  | "changes_requested"
  | "approved"
  | "commented"
  | "requested"
  | "none";

// Just the fields prReviewState reads, so it takes either a GraphQLPullRequest
// or the PRNode built from one.
export interface ReviewedPR {
  reviewDecision: ReviewDecision;
  reviewers: readonly { state: ReviewState }[];
}

export function prReviewState(pr: ReviewedPR): PRReviewState {
  switch (pr.reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return pr.reviewers.some((r) => r.state === "COMMENTED")
        ? "commented"
        : "requested";
    case null:
      // GitHub is asking nobody for a review and nobody has been added as a
      // reviewer, so there is no verdict pending or given.
      return "none";
  }
}

// Legend order: the states that want someone's attention first, ending with the
// PRs nothing is being asked of.
export const PR_REVIEW_STATES: readonly PRReviewState[] = [
  "changes_requested",
  "approved",
  "commented",
  "requested",
  "none",
];

export const PR_REVIEW_STATE_LABEL: Record<PRReviewState, string> = {
  changes_requested: "Changes requested",
  approved: "Approved",
  commented: "Commented",
  requested: "Review requested",
  none: "No review requested",
};

export const PR_REVIEW_STATE_COLOR: Record<PRReviewState, string> = {
  changes_requested: COLORS.conflict,
  approved: COLORS.ready,
  commented: COLORS.reviewCommented,
  requested: COLORS.reviewRequested,
  none: COLORS.reviewNone,
};
