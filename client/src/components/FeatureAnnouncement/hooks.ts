import { useCallback, useEffect, useState } from "react";
import {
  CURRENT_FEATURE_VERSION,
  FEATURE_ANNOUNCEMENTS,
  getSeenFeatureVersion,
  setSeenFeatureVersion,
} from "./utils";
import type { FeatureAnnouncement } from "./utils";

export function useFeatureAnnouncements() {
  // Snapshot localStorage exactly once so the values stay stable for the whole
  // session regardless of re-renders.
  const [seen] = useState(getSeenFeatureVersion);
  const [announcements] = useState<FeatureAnnouncement[]>(() => {
    // First-time user (nothing stored): show nothing — they don't need to be
    // told about features that already existed when they first arrived.
    if (seen === null) return [];
    // Oldest unseen first: the modals appear in release order and the stored
    // "seen" version advances one step at a time as each is dismissed.
    return FEATURE_ANNOUNCEMENTS.filter((f) => f.version > seen).sort(
      (a, b) => a.version - b.version,
    );
  });

  // First-time users get no popup, so record the current version up front;
  // returning users are recorded as each popup unmounts (markSeen).
  useEffect(() => {
    if (seen === null) setSeenFeatureVersion(CURRENT_FEATURE_VERSION);
  }, [seen]);

  // Stable identity so a popup's unmount cleanup runs only on real unmount, not
  // on every render. Records the single announcement that was just dismissed so
  // the stored version advances one step at a time.
  const markSeen = useCallback((version: number) => {
    setSeenFeatureVersion(version);
  }, []);

  return { announcements, markSeen };
}
