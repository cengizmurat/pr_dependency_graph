// Focusing the graph on one pull request and the stack sitting on top of it.
//
// The focused PR lives in the `pr` query param, so a focused view is a plain
// link: the share button on a PR card copies it, the landing page builds one
// from a typed PR number, and GraphView zooms to that PR and its descendants
// on load. Everything else on the page keeps working as before — the param
// only changes what the graph is framed on, never which PRs are fetched.

import type { GraphNode } from "./types";
import { collectDescendantPRs } from "./utils";

export const FOCUS_PR_PARAM = "pr";

// A whole GitHub stack can be focused too, by its number, in the `stack`
// param. That is the link the share button on a stack's rectangle copies. It
// names the stack rather than one of its PRs, so it keeps working as layers
// merge, and it takes in the merged layers, which a PR's descendants never do.
// The two params are one choice: setting either drops the other.
export const FOCUS_STACK_PARAM = "stack";

function positiveInt(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const parsed = parseInt(raw, 10);
  return parsed > 0 ? parsed : null;
}

// The PR number the URL asks the graph to focus on, or null when there is
// none. A non-numeric or non-positive value counts as no focus rather than an
// error: the param is hand-editable and a bad one should just show everything.
export function getFocusPR(params: URLSearchParams): number | null {
  return positiveInt(params.get(FOCUS_PR_PARAM));
}

// The stack number the URL asks the graph to focus on, read as leniently as
// the PR number above.
export function getFocusStack(params: URLSearchParams): number | null {
  return positiveInt(params.get(FOCUS_STACK_PARAM));
}

export function withFocusPR(
  params: URLSearchParams,
  prNumber: number | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (prNumber === null) next.delete(FOCUS_PR_PARAM);
  else {
    next.set(FOCUS_PR_PARAM, String(prNumber));
    next.delete(FOCUS_STACK_PARAM);
  }
  return next;
}

export function withFocusStack(
  params: URLSearchParams,
  stackNumber: number | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (stackNumber === null) next.delete(FOCUS_STACK_PARAM);
  else {
    next.set(FOCUS_STACK_PARAM, String(stackNumber));
    next.delete(FOCUS_PR_PARAM);
  }
  return next;
}

// The link the share button copies. Filters are deliberately left out: the
// recipient should land on the stack itself, not on whatever the sharer had
// narrowed the graph down to — a reviewer filter, for instance, would hide the
// very PRs the link is about.
export function buildShareUrl(
  owner: string,
  repo: string,
  prNumber: number,
): string {
  const path = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return `${window.location.origin}${path}?${FOCUS_PR_PARAM}=${prNumber}`;
}

// The link the share button on a stack copies. Free of filters for the same
// reason as the PR link above.
export function buildStackShareUrl(
  owner: string,
  repo: string,
  stackNumber: number,
): string {
  const path = `/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return `${window.location.origin}${path}?${FOCUS_STACK_PARAM}=${stackNumber}`;
}

// Node ids of every layer of a stack that is on the graph, merged ones
// included. Null when none is, which tells the page to show the full view.
export function collectStackIds(
  stackNumber: number,
  nodes: GraphNode[],
): Set<string> | null {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type === "pr" && node.stack?.number === stackNumber) ids.add(node.id);
  }
  return ids.size > 0 ? ids : null;
}

// Node ids of the focused PR plus every PR stacked on top of it — the same
// "following PRs" set the update-branch cascade walks. Null when the PR isn't
// in the graph, which is what tells the page to fall back to the full view.
export function collectFocusIds(
  prNumber: number,
  nodes: GraphNode[],
): Set<string> | null {
  const present = nodes.some((n) => n.type === "pr" && n.number === prNumber);
  if (!present) return null;
  return new Set(
    collectDescendantPRs(prNumber, nodes).map((n) => `pr-${n}`),
  );
}

export interface RepoTarget {
  owner: string;
  repo: string;
  prNumber: number | null;
}

// Parses what someone types on the landing page. Accepts `owner/repo`, the
// same with a PR number attached (`owner/repo#42`, `owner/repo/pull/42`), and
// a pasted github.com pull request URL — so a link copied straight from GitHub
// lands on that PR's stack.
export function parseRepoTarget(raw: string): RepoTarget | null {
  let value = raw.trim();
  if (!value) return null;

  // Drop a scheme and host, so a full GitHub URL reduces to its path.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "");
  value = value.replace(/^\/+|\/+$/g, "");

  let prNumber: number | null = null;
  const withHash = value.match(/^(.*?)\/*#(\d+)$/);
  if (withHash) {
    value = withHash[1].replace(/\/+$/, "");
    prNumber = parseInt(withHash[2], 10);
  }

  const parts = value.split("/").filter(Boolean);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  if (parts.length > 2) {
    // .../pull/42 (and anything after it, such as /files) names a PR; any
    // other deeper path isn't a repository reference we can use.
    if (parts[2] !== "pull" && parts[2] !== "pulls") return null;
    if (!/^\d+$/.test(parts[3] ?? "")) return null;
    prNumber = parseInt(parts[3], 10);
  }

  return { owner: parts[0], repo: parts[1], prNumber };
}
