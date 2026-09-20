import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NotificationBell } from "@/components/ui/notification-bell";
import { useUnseenAnnouncementCount } from "./hooks";
import { getSeenVersion, markSeenVersion } from "./store";
import { CURRENT_FEATURE_VERSION, FEATURE_ANNOUNCEMENTS } from "./utils";
import type { FeatureAnnouncement } from "./utils";

// Newest first: the panel reads like a changelog.
const NEWEST_FIRST: FeatureAnnouncement[] = [...FEATURE_ANNOUNCEMENTS].sort(
  (a, b) => b.version - a.version,
);

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// A bell in the header carrying the number of announcements not yet read. It
// rings when that number goes up and opens a panel listing every announcement
// so far, so a popup closed too quickly can always be reread.
export default function WhatsNewBell() {
  const [open, setOpen] = useState(false);
  // What was unread when the panel opened: those rows keep their "New" mark
  // while the panel is read, even though opening it records them as seen.
  const [freshAtOpen, setFreshAtOpen] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const unseen = useUnseenAnnouncementCount();
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open) {
      const seen = getSeenVersion();
      setFreshAtOpen(
        new Set(
          NEWEST_FIRST.filter((a) => seen !== null && a.version > seen).map(
            (a) => a.version,
          ),
        ),
      );
      markSeenVersion(CURRENT_FEATURE_VERSION);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Capture phase, like the filter dropdowns: the graph canvas stops
    // mousedown from bubbling, so a bubbling listener never sees a click on it.
    document.addEventListener("mousedown", handleClick, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center">
      <NotificationBell
        count={unseen}
        size={30}
        color="red"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unseen > 0 ? `What's new, ${unseen} unread` : "What's new"}
        title="What's new"
        className="cursor-pointer"
      />
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="What's new"
            className="absolute top-full right-0 z-[120] mt-2 w-[360px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-popover text-foreground shadow-[0_12px_40px_var(--color-shadow)]"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden
                className="shrink-0 text-(--color-branch)"
              >
                <path d="M8 0l1.79 6.21L16 8l-6.21 1.79L8 16l-1.79-6.21L0 8l6.21-1.79z" />
              </svg>
              <span className="text-sm font-semibold">What's new</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ml-auto grid size-6 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-line hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                </svg>
              </button>
            </div>
            <ol className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
              {NEWEST_FIRST.map((a) => (
                <li key={a.version} className="rounded-lg px-3 py-2.5 hover:bg-line/60">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-semibold">{a.title}</span>
                    {freshAtOpen.has(a.version) && (
                      <span className="ml-auto shrink-0 rounded-full bg-accent/15 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-accent">
                        New
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDate(a.date)}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {a.description}
                  </p>
                </li>
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
