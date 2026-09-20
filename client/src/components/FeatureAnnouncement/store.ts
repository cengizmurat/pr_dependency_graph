import { getSeenFeatureVersion, setSeenFeatureVersion } from "./utils";

// The highest announcement version the user has acknowledged, shared between
// the popup that walks through the unseen ones and the bell that counts them,
// so dismissing a popup takes one off the bell's badge as it happens.
let cached: number | null | undefined;
const listeners = new Set<() => void>();

export function getSeenVersion(): number | null {
  if (cached === undefined) cached = getSeenFeatureVersion();
  return cached;
}

export function subscribeSeenVersion(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Never lowers what is stored: reading the whole list in the bell's panel
// marks everything, and a popup dismissed afterwards must not undo that.
export function markSeenVersion(version: number): void {
  const current = getSeenVersion();
  const next = current === null ? version : Math.max(current, version);
  if (current === next) return;
  cached = next;
  setSeenFeatureVersion(next);
  for (const listener of listeners) listener();
}
