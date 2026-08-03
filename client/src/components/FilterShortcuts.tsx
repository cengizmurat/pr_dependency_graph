import { useSearchParams } from "react-router-dom";
import {
  SHORTCUT_KEYS,
  SHORTCUT_LABELS,
  applyShortcut,
  getActiveShortcut,
} from "../filterShortcuts";

interface Props {
  viewerLogin: string | undefined;
}

// Filter shortcuts next to the Legend. Each button is a mutually exclusive
// one-click filter preset: clicking one clears the values the previously
// active shortcut had put in the URL and applies its own, while filters the
// user picked by hand in the dropdowns stay exactly as they are — bar the ones
// a shortcut owns outright, such as the reviewer "Requested reviews" resets to
// the viewer. The URL records which shortcut is active in the `shortcut`
// param, which is what makes that distinction possible. Clicking the active
// shortcut clears it.
export default function FilterShortcuts({ viewerLogin }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  if (!viewerLogin) return null;

  const active = getActiveShortcut(searchParams, viewerLogin);

  const apply = (key: (typeof SHORTCUT_KEYS)[number]) => {
    setSearchParams((prev) => applyShortcut(prev, key, viewerLogin), {
      replace: true,
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.section}>Shortcuts</div>
      {SHORTCUT_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => apply(key)}
          aria-pressed={active === key}
          style={{
            ...styles.button,
            ...(active === key ? styles.buttonActive : {}),
          }}
        >
          {SHORTCUT_LABELS[key]}
        </button>
      ))}
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
