// Filter shortcut presets, shared by FilterShortcuts (which applies them) and
// GraphPage (which keeps the URL marker honest when a filter is edited by
// hand).
//
// A shortcut writes its values into the regular filter params so a shared or
// bookmarked link keeps working, and records which shortcut produced them in
// the `shortcut` param. That marker is what lets a later shortcut click
// override only the values it put in the URL itself and leave manually picked
// filters untouched — except for params a shortcut declares `exclusive`, which
// it takes over completely (see `Entry`).
//
// A link can also carry the marker on its own (`?shortcut=requested`), naming
// the preset without the filters it stands for. Those depend on who is looking,
// so `hydrateShortcut` fills them in once the viewer's login is known.

export const SHORTCUT_PARAM = "shortcut";

export const SHORTCUT_KEYS = ["requested", "mine"] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

export const SHORTCUT_LABELS: Record<ShortcutKey, string> = {
  requested: "Requested reviews",
  mine: "My PRs",
};

// A single filter param/value pair contributed by a shortcut. An `exclusive`
// entry means the shortcut owns that param outright: applying it replaces
// whatever was selected instead of adding to it, and any other value showing
// up there later makes the shortcut marker stale.
interface Entry {
  param: string;
  value: string;
  exclusive?: boolean;
}

function entriesFor(key: ShortcutKey, viewerLogin: string): Entry[] {
  switch (key) {
    case "requested":
      // The reviewer is pinned to the viewer (exclusively, so the shortcut
      // resets a reviewer picked by hand) and the PR's own state to a pending
      // request: together they mean "PRs I review that are still waiting on a
      // first look". Note that a PR someone else has already approved or
      // commented on reads as that stronger state, so it drops out even while
      // the viewer's own review is outstanding.
      return [
        { param: "reviewer", value: viewerLogin, exclusive: true },
        { param: "reviewState", value: "requested" },
      ];
    case "mine":
      return [{ param: "author", value: viewerLogin }];
  }
}

function isShortcutKey(value: string | null): value is ShortcutKey {
  return value !== null && (SHORTCUT_KEYS as readonly string[]).includes(value);
}

// Whether the entry's value is still in the URL. An exclusive entry also
// requires that nothing else was added to the param, since the shortcut claims
// all of it.
function hasEntry(
  params: URLSearchParams,
  { param, value, exclusive }: Entry,
): boolean {
  const values = params.getAll(param);
  if (exclusive) {
    return values.length === 1 && values[0].toLowerCase() === value.toLowerCase();
  }
  return values.some((v) => v.toLowerCase() === value.toLowerCase());
}

// Drops a single occurrence of the value, so a manually selected duplicate of
// another param value survives. An exclusive entry clears the param outright.
function removeEntry(
  params: URLSearchParams,
  { param, value, exclusive }: Entry,
): void {
  if (exclusive) {
    params.delete(param);
    return;
  }
  const remaining = params.getAll(param);
  const idx = remaining.findIndex(
    (v) => v.toLowerCase() === value.toLowerCase(),
  );
  if (idx === -1) return;
  remaining.splice(idx, 1);
  params.delete(param);
  for (const v of remaining) params.append(param, v);
}

// Writes a shortcut's values into the params, in place.
function writeEntries(params: URLSearchParams, entries: Entry[]): void {
  for (const entry of entries) {
    // `set` drops any value already there, which is what makes an exclusive
    // entry a reset rather than an addition.
    if (entry.exclusive) params.set(entry.param, entry.value);
    else if (!hasEntry(params, entry)) params.append(entry.param, entry.value);
  }
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
    writeEntries(params, entriesFor(key, viewerLogin));
  }
  return params;
}

// Turns a bare `?shortcut=...` link into the filters it stands for. A
// `requested` link means "waiting on *my* review", so the reviewer it wants
// isn't knowable until the viewer's login has been fetched — and the preset is
// applied whole or not at all, so its static filters wait for that too. When
// the login arrives everything goes in at once, exactly as clicking the button
// would: reviewer (or author) resolved to the viewer, plus `reviewState`.
//
// Returns null when there is nothing to write — no marker, an unknown one, no
// viewer yet, or a shortcut whose values are already in the URL — so callers
// can leave the address bar alone.
export function hydrateShortcut(
  params: URLSearchParams,
  viewerLogin: string | undefined,
): URLSearchParams | null {
  const key = params.get(SHORTCUT_PARAM);
  if (!isShortcutKey(key) || !viewerLogin) return null;
  const entries = entriesFor(key, viewerLogin);
  if (entries.every((entry) => hasEntry(params, entry))) return null;
  const next = new URLSearchParams(params);
  writeEntries(next, entries);
  return next;
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
