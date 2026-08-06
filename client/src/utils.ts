import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { GraphNode, PRNode } from "./types";
import { LOOKBACK_DAYS_KEY, DEFAULT_LOOKBACK_DAYS, LEGEND_COLLAPSED_KEY } from "./constants";

export function isPR(d: GraphNode): d is PRNode {
  return d.type === "pr";
}

export function collectDescendantPRs(startPrNumber: number, nodes: GraphNode[]): number[] {
  const prNodes = nodes.filter(
    (n): n is PRNode => n.type === "pr",
  );
  const startPR = prNodes.find((n) => n.number === startPrNumber);
  if (!startPR) return [startPrNumber];

  const result: number[] = [startPrNumber];
  const visited = new Set<number>([startPrNumber]);
  let currentHeadBranches = [startPR.headBranch];

  while (currentHeadBranches.length > 0) {
    const nextHeadBranches: string[] = [];
    for (const headBranch of currentHeadBranches) {
      for (const child of prNodes) {
        if (child.baseBranch === headBranch && !visited.has(child.number)) {
          visited.add(child.number);
          result.push(child.number);
          nextHeadBranches.push(child.headBranch);
        }
      }
    }
    currentHeadBranches = nextHeadBranches;
  }

  return result;
}

// Copies text to the clipboard, reporting whether it worked. The async
// Clipboard API needs a secure context and a permission the browser can
// refuse, so a hidden-textarea copy stands in when it isn't available — and a
// false return lets the caller fall back to showing the link instead.
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea copy below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function getStoredLookbackDays(): number {
  const stored = localStorage.getItem(LOOKBACK_DAYS_KEY);
  if (stored !== null) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_LOOKBACK_DAYS;
}

export function getStoredLegendCollapsed(): boolean {
  try {
    return localStorage.getItem(LEGEND_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function hasStoredLegendPreference(): boolean {
  try {
    return localStorage.getItem(LEGEND_COLLAPSED_KEY) !== null;
  } catch {
    return false;
  }
}

export function setStoredLegendCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(LEGEND_COLLAPSED_KEY, String(collapsed));
  } catch {
    // localStorage unavailable (e.g. private mode); preference won't persist.
  }
}

export type DateRange = [Dayjs, Dayjs];

export function buildDefaultRange(days: number): DateRange {
  return [dayjs().subtract(days, "day").startOf("day"), dayjs().endOf("day")];
}
