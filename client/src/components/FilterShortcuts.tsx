import type { ReviewStateFilter } from "../types";

interface Props {
  viewerLogin: string | undefined;
  authorFilter: string[];
  onAuthorFilterChange: (next: string[]) => void;
  reviewStateFilter: ReviewStateFilter[];
  onReviewStateFilterChange: (next: ReviewStateFilter[]) => void;
}

// Sits next to the Legend on the graph canvas and offers one-click toggles for
// the two filters the user reaches for most: "PRs where my review is pending"
// and "PRs I authored". Each button applies the underlying filter exactly when
// pressed and clears it when pressed again.
export default function FilterShortcuts({
  viewerLogin,
  authorFilter,
  onAuthorFilterChange,
  reviewStateFilter,
  onReviewStateFilterChange,
}: Props) {
  if (!viewerLogin) return null;

  const requestedActive =
    reviewStateFilter.length === 1 && reviewStateFilter[0] === "REQUESTED";
  const mineActive =
    authorFilter.length === 1 && authorFilter[0] === viewerLogin;

  const toggleRequested = () => {
    onReviewStateFilterChange(requestedActive ? [] : ["REQUESTED"]);
  };
  const toggleMine = () => {
    onAuthorFilterChange(mineActive ? [] : [viewerLogin]);
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>Shortcuts</div>
      <button
        type="button"
        onClick={toggleRequested}
        aria-pressed={requestedActive}
        style={{
          ...styles.button,
          ...(requestedActive ? styles.buttonActive : {}),
        }}
      >
        Requested reviews
      </button>
      <button
        type="button"
        onClick={toggleMine}
        aria-pressed={mineActive}
        style={{
          ...styles.button,
          ...(mineActive ? styles.buttonActive : {}),
        }}
      >
        My PRs
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 8,
    padding: "8px 12px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: 11,
    color: "var(--color-text)",
    boxShadow: "0 1px 3px var(--color-shadow)",
    pointerEvents: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 6,
    minWidth: 140,
  },
  section: {
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    fontSize: 10,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  button: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
  buttonActive: {
    color: "var(--color-text)",
    borderColor: "var(--color-link, #58a6ff)",
    background: "var(--color-border-subtle)",
  },
};
