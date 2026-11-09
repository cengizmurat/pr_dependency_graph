export default function Spinner({
  size = 24,
  color = "var(--color-text-secondary)",
  label,
}: {
  size?: number;
  // The moving arc; the track behind it stays the subtle border colour.
  color?: string;
  // Read out by screen readers; without it the spinner is decoration.
  label?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx="12" cy="12" r="10"
        stroke="var(--color-border-subtle)"
        strokeWidth="3"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
