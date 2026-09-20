import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getSeenVersion, markSeenVersion, subscribeSeenVersion } from "./store";
import { CURRENT_FEATURE_VERSION, FEATURE_ANNOUNCEMENTS } from "./utils";
import type { FeatureAnnouncement } from "./utils";

export function useFeatureAnnouncements() {
  // Snapshot the stored version exactly once so the list stays stable for the
  // whole session regardless of re-renders.
  const [seen] = useState(getSeenVersion);
  const [announcements] = useState<FeatureAnnouncement[]>(() => {
    // First-time user (nothing stored): show nothing — they don't need to be
    // told about features that already existed when they first arrived.
    if (seen === null) return [];
    // Oldest unseen first: the popup walks them in release order and the
    // stored "seen" version advances one step at a time as each is dismissed.
    return FEATURE_ANNOUNCEMENTS.filter((f) => f.version > seen).sort(
      (a, b) => a.version - b.version,
    );
  });

  // First-time users get no popup, so record the current version up front;
  // returning users are recorded as each announcement is dismissed (markSeen).
  useEffect(() => {
    if (seen === null) markSeenVersion(CURRENT_FEATURE_VERSION);
  }, [seen]);

  // Stable identity so an unmount cleanup that calls it runs only on a real
  // unmount, not on every render.
  const markSeen = useCallback((version: number) => {
    markSeenVersion(version);
  }, []);

  return { announcements, markSeen };
}

const getServerSnapshot = () => null;

// How many announcements the user has not acknowledged yet, live: the number
// on the bell, which counts down as the popups are dismissed.
export function useUnseenAnnouncementCount(): number {
  const seen = useSyncExternalStore(
    subscribeSeenVersion,
    getSeenVersion,
    getServerSnapshot,
  );
  if (seen === null) return 0;
  return FEATURE_ANNOUNCEMENTS.filter((f) => f.version > seen).length;
}
