import { useEffect, useState } from "react";
import { useFeatureAnnouncements } from "./hooks";
import type { FeatureAnnouncement } from "./utils";

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(0, 0, 0, 0.45)",
    zIndex: 1000,
    animation: "featureBackdropIn 0.2s ease",
  },
  card: {
    width: 380,
    maxWidth: "calc(100vw - 40px)",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 20,
    background: "var(--color-header-bg)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 12,
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
    color: "var(--color-text)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    animation: "featurePopupIn 0.22s ease",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sparkle: {
    display: "flex",
    alignItems: "center",
    color: "var(--color-branch)",
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
  },
  closeBtn: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    borderRadius: 4,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  itemDesc: {
    fontSize: 13,
    color: "var(--color-text-secondary)",
    lineHeight: 1.5,
  },
  dismissBtn: {
    alignSelf: "flex-end",
    padding: "7px 18px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    border: "none",
    background: "var(--color-button-bg)",
    color: "var(--color-button-text)",
    cursor: "pointer",
  },
};

export default function FeatureAnnouncementPopup() {
  const { announcements, markSeen } = useFeatureAnnouncements();
  const [open, setOpen] = useState(true);

  if (announcements.length === 0 || !open) return null;

  return (
    <FeatureAnnouncementModal
      announcements={announcements}
      onClose={() => setOpen(false)}
      onUnmount={markSeen}
    />
  );
}

function FeatureAnnouncementModal({
  announcements,
  onClose,
  onUnmount,
}: {
  announcements: FeatureAnnouncement[];
  onClose: () => void;
  onUnmount: () => void;
}) {
  // Record the announcements as seen only when this modal unmounts, i.e. after
  // the user closes it (Got it / X / click outside) or leaves the page.
  useEffect(() => onUnmount, [onUnmount]);

  const multiple = announcements.length > 1;

  return (
    <div
      style={styles.backdrop}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-label="New features"
      >
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
            onClick={onClose}
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
          onClick={onClose}
          style={styles.dismissBtn}
          className="feature-popup-dismiss"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
