import { useEffect, useState } from "react";
import {
  CURRENT_FEATURE_VERSION,
  FEATURE_ANNOUNCEMENTS,
  getSeenFeatureVersion,
  setSeenFeatureVersion,
} from "./utils";
import type { FeatureAnnouncement } from "./utils";

export function useFeatureAnnouncements() {
  // Snapshot localStorage exactly once so StrictMode's double render and the
  // bootstrap write below don't change what we decided to show this session.
  const [announcements, setAnnouncements] = useState<FeatureAnnouncement[]>(
    () => {
      const seen = getSeenFeatureVersion();
      // First-time user (nothing stored): only announcements explicitly opted
      // in via `showWithoutStorage`. The effect below records the version.
      const isUnseen =
        seen === null
          ? (f: FeatureAnnouncement) => f.showWithoutStorage === true
          : (f: FeatureAnnouncement) => f.version > seen;
      return FEATURE_ANNOUNCEMENTS.filter(isUnseen).sort(
        (a, b) => b.version - a.version,
      );
    },
  );

  useEffect(() => {
    // A brand-new (or pre-existing) user has nothing stored yet. Silently
    // record the current version so the popup is NOT shown to them, and they
    // are only notified about features released from now on.
    if (getSeenFeatureVersion() === null) {
      setSeenFeatureVersion(CURRENT_FEATURE_VERSION);
    }
  }, []);

  const dismiss = () => {
    setSeenFeatureVersion(CURRENT_FEATURE_VERSION);
    setAnnouncements([]);
  };

  return { announcements, dismiss };
}
