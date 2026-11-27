import { useEffect, useState } from "react";
import dayjs from "dayjs";

const TICK_MS = 30 * 1000;

const styles: Record<string, React.CSSProperties> = {
  label: { whiteSpace: "nowrap" },
  failed: { color: "var(--color-error)" },
};

function timeAgo(updatedAt: number, now: number, compact: boolean): string {
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return compact ? `${minutes}m ago` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return compact ? `${hours}h ago` : `${hours} h ago`;
  return dayjs(updatedAt).format("MMM D");
}

interface LastUpdatedProps {
  // 0 means no fetch has finished yet.
  updatedAt: number;
  isRefreshing: boolean;
  failed: boolean;
  // Short text for a phone header.
  compact?: boolean;
}

export default function LastUpdated({ updatedAt, isRefreshing, failed, compact = false }: LastUpdatedProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  // A finished fetch re-renders with a new updatedAt, so "just now" shows at once.
  const shownNow = Math.max(now, updatedAt);

  if (isRefreshing) {
    return <span style={styles.label} role="status">Updating…</span>;
  }
  if (!updatedAt) return null;
  const exact = dayjs(updatedAt).format("MMM D, YYYY [at] HH:mm");
  return (
    <span
      style={failed ? { ...styles.label, ...styles.failed } : styles.label}
      title={failed ? `Last update failed. Data from ${exact}` : `Updated ${exact}`}
    >
      {failed ? (compact ? "Failed, " : "Update failed, data from ") : compact ? "" : "Updated "}
      <time dateTime={new Date(updatedAt).toISOString()}>{timeAgo(updatedAt, shownNow, compact)}</time>
    </span>
  );
}
