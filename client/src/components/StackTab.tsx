import { useEffect, useRef, useState } from "react";
import type { StackBox } from "../types";
import { STACK_ICON_PATH } from "../constants";

// How long the tab confirms that the link went to the clipboard.
const COPY_FEEDBACK_MS = 2500;

// How far along the rectangle's top border the tab starts, and its height. It
// sits astride the border, the way a legend sits on a fieldset.
const TAB_INSET = 14;
export const STACK_TAB_HEIGHT = 26;

interface Props {
  box: StackBox;
  // How many of the stack's layers are merged.
  merged: number;
  dimmed: boolean;
  // Puts the stack's link on the clipboard, resolving to whether it worked.
  onShare: (stackNumber: number) => Promise<boolean>;
  // Frames the graph on the stack — the view the shared link opens.
  onFocus?: (stackNumber: number) => void;
}

// The name tab on the rectangle around a stack: which stack it is, how much of
// it has merged, and the button that shares the whole stack as a link.
export default function StackTab({ box, merged, dimmed, onShare, onFocus }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const share = async () => {
    const ok = await onShare(box.number);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  const summary =
    merged > 0
      ? `${merged} of ${box.size} merged`
      : `${box.size} PR${box.size === 1 ? "" : "s"}`;

  return (
    <div
      data-stack-tab={box.number}
      style={{
        ...styles.tab,
        left: box.x + TAB_INSET,
        top: box.y - STACK_TAB_HEIGHT / 2,
        opacity: dimmed ? 0.18 : 1,
      }}
      // The graph underneath pans on a drag and opens a PR on a click; neither
      // should start from the tab.
      onClick={(evt) => evt.stopPropagation()}
    >
      <button
        type="button"
        style={{ ...styles.name, cursor: onFocus ? "pointer" : "default" }}
        title={`Stack #${box.number} — focus the graph on it`}
        aria-label={`Focus on stack #${box.number}`}
        onClick={onFocus ? () => onFocus(box.number) : undefined}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d={STACK_ICON_PATH} />
        </svg>
        <span>Stack #{box.number}</span>
        <span style={styles.summary}>{summary}</span>
      </button>
      <span style={styles.divider} aria-hidden />
      <button
        type="button"
        className="stack-share-btn"
        style={styles.share}
        title={
          copied
            ? "Link copied"
            : `Share stack #${box.number} — copies a link that opens the graph on this stack`
        }
        aria-label={`Copy a link to stack #${box.number}`}
        onClick={share}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2 6.2L4.8 9L10 3.4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          // Three joined dots: the usual sign for sharing with other people.
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M5.7 7.1l4.6-2.6M5.7 8.9l4.6 2.6" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="12.25" cy="3.5" r="2.25" fill="currentColor" />
            <circle cx="3.75" cy="8" r="2.25" fill="currentColor" />
            <circle cx="12.25" cy="12.5" r="2.25" fill="currentColor" />
          </svg>
        )}
        {copied && <span>Link copied</span>}
      </button>
    </div>
  );
}

const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  whiteSpace: "nowrap",
};

const styles: Record<string, React.CSSProperties> = {
  tab: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    height: STACK_TAB_HEIGHT,
    boxSizing: "border-box",
    borderRadius: STACK_TAB_HEIGHT / 2,
    background: "var(--color-stack)",
    color: "var(--color-on-stack)",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    whiteSpace: "nowrap",
    cursor: "default",
    zIndex: 11,
  },
  name: {
    ...button,
    paddingLeft: 10,
    paddingRight: 8,
  },
  summary: {
    fontWeight: 500,
    opacity: 0.85,
  },
  divider: {
    width: 1,
    height: 12,
    background: "currentColor",
    opacity: 0.4,
  },
  share: {
    ...button,
    minWidth: 28,
    justifyContent: "center",
    padding: "0 9px 0 7px",
    borderRadius: `0 ${STACK_TAB_HEIGHT / 2}px ${STACK_TAB_HEIGHT / 2}px 0`,
    cursor: "pointer",
  },
};
