// localStorage key holding the highest feature-announcement version the user
// has already seen. When the key is absent (a brand-new / pre-existing user)
// only announcements with `showWithoutStorage` are shown; the version is then
// recorded so they are notified about features released from then on.
export const SEEN_FEATURE_VERSION_KEY = "pr-graph-seen-feature-version";

export interface FeatureAnnouncement {
  version: number;
  title: string;
  description: string;
  date: string;
  // Also show this one to users who have nothing stored yet (first-time /
  // pre-existing users). Defaults to hidden for them; opt in deliberately.
  showWithoutStorage?: boolean;
}

// To announce a newly released feature, prepend an entry whose `version` is
// strictly greater than every existing one. Returning users whose stored
// version is lower see the popup once, after which it is marked as seen.
export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [
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
    showWithoutStorage: true,
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
