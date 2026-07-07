import { useSearchParams } from "react-router-dom";

interface Props {
  viewerLogin: string | undefined;
}

// Filter shortcuts next to the Legend. Each button represents a mutually
// exclusive one-click filter preset. Clicking a shortcut wipes all
// author/status/reviewState filters first and then applies just its own — the
// two shortcuts can never be active at the same time, and there is never a
// leftover filter from a previous selection sneaking in. Clicking an already
// active shortcut clears back to no filters.
export default function FilterShortcuts({ viewerLogin }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  if (!viewerLogin) return null;

  const authorParams = searchParams.getAll("author");
  const reviewStateParams = searchParams
    .getAll("reviewState")
    .map((v) => v.toUpperCase());
  const statusParam = searchParams.get("status");
  const hasStatus = statusParam === "ready" || statusParam === "draft";

  const requestedActive =
    !hasStatus &&
    authorParams.length === 0 &&
    reviewStateParams.length === 1 &&
    reviewStateParams[0] === "REQUESTED";
  const mineActive =
    !hasStatus &&
    reviewStateParams.length === 0 &&
    authorParams.length === 1 &&
    authorParams[0] === viewerLogin;

  const apply = (kind: "requested" | "mine") => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("author");
        params.delete("status");
        params.delete("reviewState");
        if (kind === "requested" && !requestedActive) {
          params.append("reviewState", "REQUESTED");
        } else if (kind === "mine" && !mineActive) {
          params.append("author", viewerLogin);
        }
        return params;
      },
      { replace: true },
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>Shortcuts</div>
      <button
        type="button"
        onClick={() => apply("requested")}
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
        onClick={() => apply("mine")}
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
