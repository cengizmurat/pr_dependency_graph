// Filter shortcut presets, shared by FilterShortcuts (which applies them) and
// GraphPage (which keeps the URL marker honest when a filter is edited by
// hand).
//
// A shortcut writes its values into the regular filter params so a shared or
// bookmarked link keeps working, and records which shortcut produced them in
// the `shortcut` param. That marker is what lets a later shortcut click
// override only the values it put in the URL itself and leave manually picked
// filters untouched.

export const SHORTCUT_PARAM = "shortcut";

export const SHORTCUT_KEYS = ["requested", "mine"] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

export const SHORTCUT_LABELS: Record<ShortcutKey, string> = {
  requested: "Requested reviews",
  mine: "My PRs",
};

// A single filter param/value pair contributed by a shortcut.
type Entry = [param: string, value: string];

function entriesFor(key: ShortcutKey, viewerLogin: string): Entry[] {
  switch (key) {
    case "requested":
      return [["reviewState", "REQUESTED"]];
    case "mine":
      return [["author", viewerLogin]];
  }
}

function isShortcutKey(value: string | null): value is ShortcutKey {
  return value !== null && (SHORTCUT_KEYS as readonly string[]).includes(value);
}

function hasEntry(params: URLSearchParams, [param, value]: Entry): boolean {
  return params
    .getAll(param)
    .some((v) => v.toLowerCase() === value.toLowerCase());
}

// Drops a single occurrence of the value, so a manually selected duplicate of
// another param value survives.
function removeEntry(params: URLSearchParams, [param, value]: Entry): void {
  const remaining = params.getAll(param);
  const idx = remaining.findIndex(
    (v) => v.toLowerCase() === value.toLowerCase(),
  );
  if (idx === -1) return;
  remaining.splice(idx, 1);
  params.delete(param);
  for (const v of remaining) params.append(param, v);
}

// The shortcut the URL currently claims, but only while every value it
// contributed is still there. Once a filter dropdown drops one of them the
// marker is stale and the shortcut counts as inactive.
export function getActiveShortcut(
  params: URLSearchParams,
  viewerLogin: string | undefined,
): ShortcutKey | null {
  const key = params.get(SHORTCUT_PARAM);
  if (!isShortcutKey(key) || !viewerLogin) return null;
  return entriesFor(key, viewerLogin).every((entry) => hasEntry(params, entry))
    ? key
    : null;
}

// Applies (or toggles off) a shortcut: only the previous shortcut's own values
// are cleared, everything else in the query string is left as the user set it.
export function applyShortcut(
  prev: URLSearchParams,
  key: ShortcutKey,
  viewerLogin: string,
): URLSearchParams {
  const params = new URLSearchParams(prev);
  const active = getActiveShortcut(params, viewerLogin);
  if (active) {
    for (const entry of entriesFor(active, viewerLogin)) {
      removeEntry(params, entry);
    }
  }
  params.delete(SHORTCUT_PARAM);
  // Clicking the active shortcut again just clears it.
  if (active !== key) {
    params.set(SHORTCUT_PARAM, key);
    for (const entry of entriesFor(key, viewerLogin)) {
      if (!hasEntry(params, entry)) params.append(entry[0], entry[1]);
    }
  }
  return params;
}

// Removes the marker once the filters it described no longer match, so a
// hand-edited filter can't be silently attributed to a shortcut.
export function pruneStaleShortcut(
  params: URLSearchParams,
  viewerLogin: string | undefined,
): URLSearchParams {
  const key = params.get(SHORTCUT_PARAM);
  if (key === null) return params;
  if (!isShortcutKey(key)) {
    params.delete(SHORTCUT_PARAM);
    return params;
  }
  // Without the viewer login the marker can't be checked yet; leave it alone
  // rather than dropping a shortcut that is still valid.
  if (!viewerLogin) return params;
  if (!getActiveShortcut(params, viewerLogin)) params.delete(SHORTCUT_PARAM);
  return params;
}
