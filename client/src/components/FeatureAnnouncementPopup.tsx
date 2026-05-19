import { useFeatureAnnouncements } from "../hooks/useFeatureAnnouncements";
import { styles } from "./FeatureAnnouncementPopup.styles";

export default function FeatureAnnouncementPopup() {
  const { announcements, dismiss } = useFeatureAnnouncements();

  if (announcements.length === 0) return null;

  const multiple = announcements.length > 1;

  return (
    <div style={styles.popup} role="dialog" aria-label="New features">
      <div style={styles.header}>
        <span style={styles.sparkle} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0l1.79 6.21L16 8l-6.21 1.79L8 16l-1.79-6.21L0 8l6.21-1.79z" />
          </svg>
        </span>
        <span style={styles.headerTitle}>
          {multiple ? "What's new" : "New feature"}
        </span>
        <button
          type="button"
          onClick={dismiss}
          style={styles.closeBtn}
          aria-label="Dismiss"
          className="feature-popup-close"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
          </svg>
        </button>
      </div>
      <ul style={styles.list}>
        {announcements.map((f) => (
          <li key={f.version} style={styles.item}>
            <div style={styles.itemTitle}>{f.title}</div>
            <div style={styles.itemDesc}>{f.description}</div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={dismiss}
        style={styles.dismissBtn}
        className="feature-popup-dismiss"
      >
        Got it
      </button>
    </div>
  );
}
