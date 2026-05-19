import { useCallback, useState } from "react";
import {
  CURRENT_FEATURE_VERSION,
  FEATURE_ANNOUNCEMENTS,
  getSeenFeatureVersion,
  setSeenFeatureVersion,
} from "./utils";
import type { FeatureAnnouncement } from "./utils";

export function useFeatureAnnouncements() {
  // Snapshot localStorage exactly once so the set of announcements stays
  // stable for the whole session regardless of re-renders.
  const [announcements] = useState<FeatureAnnouncement[]>(() => {
    const seen = getSeenFeatureVersion();
    // First-time user (nothing stored): only announcements explicitly opted
    // in via `showWithoutStorage`.
    const isUnseen =
      seen === null
        ? (f: FeatureAnnouncement) => f.showWithoutStorage === true
        : (f: FeatureAnnouncement) => f.version > seen;
    return FEATURE_ANNOUNCEMENTS.filter(isUnseen).sort(
      (a, b) => b.version - a.version,
    );
  });

  // Stable identity so the popup's unmount cleanup runs only on real unmount,
  // not on every render. The version is recorded only when that fires.
  const markSeen = useCallback(() => {
    setSeenFeatureVersion(CURRENT_FEATURE_VERSION);
  }, []);

  return { announcements, markSeen };
}
