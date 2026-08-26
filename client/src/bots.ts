import type { GraphQLPullRequest } from "./types";

// Whether a reviewer is a GitHub App rather than a person.
//
// `__typename` is the authority: GitHub types an App's actor as `Bot`, and that
// holds however the App presents itself. The login check is a fallback for the
// places a payload arrives without a typename, where an App still carries
// GitHub's "[bot]" suffix.
export function isBotActor(
  typename: string | undefined,
  login: string | undefined,
): boolean {
  if (typename === "Bot") return true;
  return !!login && /\[bot\]$/i.test(login);
}

// The PRs as they read with bot activity hidden: bot reviewers dropped, and the
// inline comments they left taken off the comment count.
//
// This runs over the fetched PRs rather than at fetch time, so flipping the
// setting is immediate and costs no requests — the bots stay in the cache,
// they just stop being counted. A PR nothing but a bot has commented on drops
// back from "Commented" to "Review requested", since its review state is read
// from the reviewers left here.
export function withoutBotContributions(
  prs: GraphQLPullRequest[],
): GraphQLPullRequest[] {
  return prs.map((pr) =>
    pr.botCommentCount === 0 && !pr.reviewers.some((r) => r.isBot)
      ? pr
      : {
          ...pr,
          reviewers: pr.reviewers.filter((r) => !r.isBot),
          commentCount: pr.commentCount - pr.botCommentCount,
          botCommentCount: 0,
        },
  );
}
