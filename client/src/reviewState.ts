import type { ReviewDecision, ReviewState } from "./types";
import { COLORS } from "./constants";

// A pull request's overall review state: one value per PR, drawn as the node's
// outline colour in the graph and named in the legend.
//
// It is resolved by weight rather than by recency, so a PR reads as the
// strongest thing standing on it. Two voices are weighed: GitHub's own
// `reviewDecision` — the field behind the banner and the merge button on the PR
// page — and the verdict each reviewer still holds. See prReviewState.
export type PRReviewState =
  | "changes_requested"
  | "approved"
  | "commented"
  | "requested"
  | "none";

// Priority order, strongest first: the states that want someone's attention
// before the ones that don't, ending with the PRs nothing is being asked of.
// It settles what a PR carrying several of them reads as, and doubles as the
// order the legend and the review-state filter list them in.
export const PR_REVIEW_STATES: readonly PRReviewState[] = [
  "changes_requested",
  "approved",
  "commented",
  "requested",
  "none",
];

const PR_REVIEW_STATE_RANK: ReadonlyMap<PRReviewState, number> = new Map(
  PR_REVIEW_STATES.map((state, i) => [state, i] as const),
);

// The stronger of two states, by PR_REVIEW_STATES. An unrecognised state ranks
// last, so a value from outside that vocabulary never wins.
function strongerPRReviewState(a: PRReviewState, b: PRReviewState): PRReviewState {
  const rankA = PR_REVIEW_STATE_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
  const rankB = PR_REVIEW_STATE_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
  return rankA <= rankB ? a : b;
}

// What GitHub's verdict says about the PR. REVIEW_REQUIRED is the weakest of
// the three: it says a review is outstanding, which stays true however much has
// already been said, so it is a floor rather than an answer — GitHub reports it
// while a second reviewer is still to look, or once an approver has spoken
// again since approving.
const DECISION_STATE: Record<NonNullable<ReviewDecision>, PRReviewState> = {
  CHANGES_REQUESTED: "changes_requested",
  APPROVED: "approved",
  REVIEW_REQUIRED: "requested",
};

// What one reviewer's standing state says about the PR. DISMISSED is absent: a
// withdrawn verdict is not a verdict, and leaves the PR reading as whatever
// else is on it. (The reviewer's own state is resolved upstream, in
// processRawPR, by REVIEW_STATE_PRIORITY.)
const REVIEWER_STATE: Partial<Record<ReviewState, PRReviewState>> = {
  CHANGES_REQUESTED: "changes_requested",
  APPROVED: "approved",
  COMMENTED: "commented",
  REQUESTED: "requested",
};

// Just the fields prReviewState reads, so it takes either a GraphQLPullRequest
// or the PRNode built from one.
export interface ReviewedPR {
  reviewDecision: ReviewDecision;
  reviewers: readonly { state: ReviewState }[];
}

// The strongest state on the PR, from GitHub's verdict and the reviewers alike.
//
// Weighing both is what keeps an approval visible. `reviewDecision` on its own
// falls back to REVIEW_REQUIRED as soon as anything is still outstanding — an
// approver leaving a comment afterwards, another reviewer yet to look — and the
// PR dropped out of "Approved" even though the approval still stands. Ranking
// the reviewers' own verdicts alongside it puts it back: only changes requested
// outrank an approval, and a comment or a pending request no longer buries one.
export function prReviewState(pr: ReviewedPR): PRReviewState {
  // A null decision means GitHub is asking nobody for a review, which is the
  // weakest starting point rather than the answer: the reviewers may still hold
  // a verdict of their own.
  let state: PRReviewState = pr.reviewDecision
    ? DECISION_STATE[pr.reviewDecision]
    : "none";
  for (const reviewer of pr.reviewers) {
    const held = REVIEWER_STATE[reviewer.state];
    if (held) state = strongerPRReviewState(state, held);
  }
  return state;
}

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

// A review state named in the URL's `reviewState` param. Matched
// case-insensitively so links written against the older uppercase filter values
// (?reviewState=APPROVED) still resolve; anything unrecognised — a hand-edited
// value, or the retired DISMISSED — returns null and is dropped.
export function parsePRReviewState(value: string): PRReviewState | null {
  const lower = value.toLowerCase();
  return (PR_REVIEW_STATES as readonly string[]).includes(lower)
    ? (lower as PRReviewState)
    : null;
}
