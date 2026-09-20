import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { StepPlayer } from "@/components/ui/step-player";
import { useFeatureAnnouncements } from "./hooks";
import type { FeatureAnnouncement } from "./utils";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function FeatureAnnouncementPopup() {
  const { announcements, markSeen } = useFeatureAnnouncements();
  // Index of the announcement on screen. Dismissing one advances it, so the
  // unseen announcements are read one at a time; the pager can also jump.
  const [index, setIndex] = useState(0);
  const current = announcements[index];

  return (
    <AnimatePresence>
      {current && (
        <FeatureAnnouncementDialog
          key="feature-announcements"
          announcement={current}
          position={index + 1}
          total={announcements.length}
          markSeen={markSeen}
          onDismiss={() => {
            markSeen(current.version);
            setIndex((i) => i + 1);
          }}
          onSeek={(next) => {
            markSeen(current.version);
            setIndex(next);
          }}
        />
      )}
    </AnimatePresence>
  );
}

function Sparkle() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className="shrink-0 text-(--color-branch)"
    >
      <path d="M8 0l1.79 6.21L16 8l-6.21 1.79L8 16l-1.79-6.21L0 8l6.21-1.79z" />
    </svg>
  );
}

function FeatureAnnouncementDialog({
  announcement,
  position,
  total,
  markSeen,
  onDismiss,
  onSeek,
}: {
  announcement: FeatureAnnouncement;
  position: number;
  total: number;
  markSeen: (version: number) => void;
  onDismiss: () => void;
  onSeek: (index: number) => void;
}) {
  const reduced = useReducedMotion() ?? false;

  // Leaving the page with the dialog open counts whatever was on screen as
  // read, the way each dismissal does; the ref keeps the cleanup tied to the
  // announcement showing at that moment rather than the first one.
  const shownVersion = useRef(announcement.version);
  shownVersion.current = announcement.version;
  useEffect(() => () => markSeen(shownVersion.current), [markSeen]);

  const multiple = total > 1;
  const isLast = position >= total;

  return (
    <motion.div
      role="presentation"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.2 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="New feature"
        className="flex w-[400px] max-w-[calc(100vw-40px)] flex-col gap-4 rounded-2xl border border-line bg-popover p-5 text-foreground shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={
          reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }
        }
      >
        <div className="flex items-center gap-2">
          <Sparkle />
          <span className="text-[15px] font-semibold">New feature</span>
          {multiple && (
            <span className="text-xs font-medium text-muted-foreground">
              {position} / {total}
            </span>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="ml-auto grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-line hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        {/* The card keeps its place while one announcement slides out and the
            next slides in; popLayout lifts the leaving one out of the flow. */}
        <div className="relative">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={announcement.version}
              className="flex flex-col gap-1"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: EASE }}
            >
              <div className="text-sm font-semibold">{announcement.title}</div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {announcement.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3">
          {multiple ? (
            <StepPlayer
              steps={total}
              value={position - 1}
              onValueChange={onSeek}
              playing={false}
              showControl={false}
              seekable
              size={32}
            />
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded-lg bg-(--color-button-bg) px-4 py-1.5 text-[13px] font-semibold text-(--color-button-text) outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
