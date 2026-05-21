import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { GraphNode, PRNode } from "./types";
import { LOOKBACK_DAYS_KEY, DEFAULT_LOOKBACK_DAYS } from "./constants";

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

export type DateRange = [Dayjs, Dayjs];

export function buildDefaultRange(days: number): DateRange {
  return [dayjs().subtract(days, "day").startOf("day"), dayjs().endOf("day")];
}
