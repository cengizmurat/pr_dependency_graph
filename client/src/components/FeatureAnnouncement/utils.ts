// localStorage key holding the highest feature-announcement version the user
// has already seen. When the key is absent (a brand-new / pre-existing user)
// no announcement is shown; the current version is recorded immediately so
// they are only notified about features released from then on.
export const SEEN_FEATURE_VERSION_KEY = "pr-graph-seen-feature-version";

export interface FeatureAnnouncement {
  version: number;
  title: string;
  description: string;
  date: string;
}

// To announce a newly released feature, prepend an entry whose `version` is
// strictly greater than every existing one. Returning users whose stored
// version is lower see the popup once, after which it is marked as seen.
export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    version: 10,
    title: "Filters highlight instead of hiding",
    description:
      "Picking an author, a reviewer or any other filter no longer takes pull requests off the graph. The whole graph stays on screen with its dependencies intact — the pull requests you filtered for are highlighted, and the rest fade into the background.",
    date: "2026-08-06",
  },
  {
    version: 9,
    title: "Focus on a stack of PRs, and share it",
    description:
      "The eye button on a pull request card zooms the graph onto that PR and the ones stacked on top of it. You can also share this view to share a specific stack of PRs to your teammates!",
    date: "2026-08-06",
  },
  {
    version: 8,
    title: "GitHub Stacks are recognized",
    description:
      "A pull request in a GitHub stack now shows a stack badge with its layer, such as \"2/3\".",
    date: "2026-08-06",
  },
  {
    version: 7,
    title: "Filter pull requests by reviewer",
    description:
      "A new reviewer dropdown next to the author filter narrows the graph to the pull requests assigned to the reviewers you pick.",
    date: "2026-08-03",
  },
  {
    version: 6,
    title: "Browse GitHub Actions workflows and run timelines",
    description:
      "A new tab bar at the top of the page switches between the PR dependency graph and a Workflows view. Pick a workflow to list its recent runs, then pick a run to see a Gantt-style timeline of every job and step, including time spent waiting for a runner.",
    date: "2026-07-31",
  },
  {
    version: 5,
    title: "Filter pull requests by your review state",
    description:
      "Pick one or more review states (Review requested, Approved, Changes requested, Commented, Dismissed) in the header to narrow the graph to PRs where you are involved as a reviewer. Two shortcut buttons next to the legend jump straight to \"Requested reviews\" or \"My PRs\".",
    date: "2026-07-07",
  },
  {
    version: 4,
    title: "Focus on PRs waiting for your review",
    description:
      "The graph is now split into two tabs: pull requests that have requested your review, and everything else.",
    date: "2026-07-07",
  },
  {
    version: 3,
    title: "Pull requests refresh automatically",
    description:
      "The graph now refreshes on its own every 15 minutes, so open pull requests stay up to date without reloading the page.",
    date: "2026-05-21",
  },
  {
    version: 2,
    title: "Your filters are remembered",
    description:
      "Your author and PR status (Ready/Draft) selections are now kept in the page URL, so they're restored after a refresh and you can bookmark or share a filtered view.",
    date: "2026-05-21",
  },
  {
    version: 1,
    title: "Filter pull requests by status",
    description:
      "Use the new status dropdown in the menu (top right corner) to focus on Ready or Draft pull requests.",
    date: "2026-05-19",
  },
];

export const CURRENT_FEATURE_VERSION = FEATURE_ANNOUNCEMENTS.reduce(
  (max, f) => Math.max(max, f.version),
  0,
);

// Returns the highest feature version the user has acknowledged, or null when
// nothing is stored yet (a first-time / pre-existing user).
export function getSeenFeatureVersion(): number | null {
  try {
    const stored = localStorage.getItem(SEEN_FEATURE_VERSION_KEY);
    if (stored === null) return null;
    const parsed = parseInt(stored, 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export function setSeenFeatureVersion(version: number): void {
  try {
    localStorage.setItem(SEEN_FEATURE_VERSION_KEY, String(version));
  } catch {
    // localStorage unavailable (e.g. private mode); notifications won't persist.
  }
}
