import type { ReactNode } from "react";

const styles: Record<string, React.CSSProperties> = {
  toggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 999,
    border: "1px solid var(--color-border-subtle)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
  toggleOpen: {
    color: "var(--color-text)",
    borderColor: "var(--color-link)",
    background: "var(--color-border-subtle)",
  },
  count: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    padding: "0 5px",
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    background: "var(--color-link)",
    color: "var(--color-on-link)",
  },
};

// The chip that folds a set of controls away on a phone: the Pull requests
// filters, the Folder churn parameters. It says what it hides, how many of
// them are in effect when that is worth knowing, and which way it will go.
export default function FoldToggle({
  open,
  onToggle,
  label,
  icon,
  count,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  icon: ReactNode;
  // Shown as a badge when above zero: how many of the folded controls are set.
  count?: number;
  // The id of the panel the chip unfolds, for assistive technology.
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      style={{ ...styles.toggle, ...(open ? styles.toggleOpen : {}) }}
    >
      {icon}
      {label}
      {count !== undefined && count > 0 && (
        <span style={styles.count}>{count}</span>
      )}
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden
        style={{
          transition: "transform 0.15s",
          transform: open ? "rotate(180deg)" : "none",
        }}
      >
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
