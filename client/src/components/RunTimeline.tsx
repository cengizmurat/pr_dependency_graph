import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowJob } from "../types";

// Gantt-style timeline of a workflow run, in the spirit of a Mermaid gantt
// chart. Jobs sharing a matrix-style name ("build (ubuntu, 18.x)") are grouped
// under their base name. Everything starts collapsed for an at-a-glance view
// and drills down on click: group -> member jobs -> steps. Collapsed rows keep
// a timeline bar — the queue wait plus an overall bar colored by outcome.

const TITLE_H = 34;
const ROW_H = 24;
const BAR_H = 16;
const AXIS_H = 30;
// Wide enough that the last centered axis label ("00:00:45") stays inside the
// SVG instead of clipping at the right edge.
const RIGHT_PAD = 30;
const GUTTER_MIN = 56;
// The gutter grows to fit the longest job name, up to this share of the
// chart's width.
const GUTTER_MAX_FRACTION = 0.35;
const MIN_CHART_W = 480;
const LABEL_FONT = 11;
const LINE_H = 14;
const CHEVRON_SPACE = 13;
const GROUP_INDENT = 12;
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const SECTION_FONT = `600 ${LABEL_FONT}px ${FONT_STACK}`;
const MEMBER_FONT = `${LABEL_FONT}px ${FONT_STACK}`;

type BarKind = "bar" | "active" | "failed" | "muted";

interface TimelineRow {
  label: string;
  // ms epoch; end === start renders as a label-only row (zero duration).
  start: number;
  end: number;
  kind: BarKind;
  tooltip: string;
}

// Collapsed representation of a job or group: the queue wait plus one bar
// covering the whole span, colored by outcome.
interface SectionSummary {
  waitStart: number | null;
  waitEnd: number | null;
  mainStart: number | null;
  mainEnd: number | null;
  kind: BarKind;
  label: string;
  tooltip: string;
}

interface TimelineSection {
  jobId: number;
  name: string;
  status: string;
  conclusion: string | null;
  rows: TimelineRow[];
  summary: SectionSummary;
}

interface SectionGroup {
  key: string;
  name: string;
  members: TimelineSection[];
  summary: SectionSummary;
}

type TopNode =
  | { type: "single"; section: TimelineSection }
  | { type: "group"; group: SectionGroup };

// Candidate axis-tick steps in seconds; the first one producing a readable
// number of grid lines wins.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
const MAX_TICKS = 9;

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return isNaN(t) ? null : t;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

// Canvas-based text measurement so inside/outside label placement is accurate;
// falls back to a per-character estimate if canvas is unavailable.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureText(text: string, font = `${LABEL_FONT}px ${FONT_STACK}`): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * 6.1;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function truncateToWidth(text: string, maxWidth: number, font?: string): string {
  if (measureText(text, font) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(text.slice(0, mid) + "…", font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

// Word-wraps a label for the gutter. Lines may break after whitespace or a
// hyphen/underscore/slash/comma (job names are often hyphenated with no
// spaces); a single chunk wider than the column is hard-broken. When the text
// needs more than maxLines, the last line is ellipsized.
function wrapToWidth(
  text: string,
  maxWidth: number,
  font: string,
  maxLines: number,
): string[] {
  if (maxLines <= 1) return [truncateToWidth(text, maxWidth, font)];

  const chunks = text.split(/(?<=[\s\-_/,])/);
  const lines: string[] = [];
  let current = "";
  let overflowed = false;

  outer: for (let chunk of chunks) {
    while (chunk.length > 0) {
      const candidate = current + chunk;
      if (measureText(candidate.trimEnd(), font) <= maxWidth) {
        current = candidate;
        break;
      }
      if (current.trimEnd()) {
        lines.push(current.trimEnd());
        current = "";
        chunk = chunk.trimStart();
        if (lines.length >= maxLines) {
          overflowed = true;
          break outer;
        }
        continue;
      }
      // The chunk alone is wider than the column: hard-break it.
      let lo = 1;
      let hi = chunk.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (measureText(chunk.slice(0, mid), font) <= maxWidth) lo = mid;
        else hi = mid - 1;
      }
      lines.push(chunk.slice(0, lo));
      chunk = chunk.slice(lo);
      if (lines.length >= maxLines) {
        overflowed = true;
        break outer;
      }
    }
  }

  if (overflowed) {
    lines.length = maxLines;
    lines[maxLines - 1] = truncateToWidth(lines[maxLines - 1] + "…", maxWidth, font);
    return lines;
  }
  if (current.trimEnd()) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [text];
}

function stepKind(status: string, conclusion: string | null): BarKind {
  if (status !== "completed") return "active";
  if (conclusion === "failure" || conclusion === "timed_out") return "failed";
  if (conclusion === "skipped" || conclusion === "cancelled") return "muted";
  return "bar";
}

function buildSummary(job: WorkflowJob, nowMs: number): SectionSummary {
  const created = parseTime(job.createdAt);
  const started = parseTime(job.startedAt);
  const completed = parseTime(job.completedAt);

  const waitStart = created;
  const waitEnd = created !== null ? (started ?? Math.max(created, nowMs)) : null;

  let mainStart: number | null = null;
  let mainEnd: number | null = null;
  let kind = stepKind(job.status, job.conclusion);
  let label: string;
  const parts: string[] = [];

  if (created !== null && waitEnd !== null && waitEnd > created) {
    parts.push(`Queued ${formatDuration((waitEnd - created) / 1000)}`);
  }

  if (started !== null) {
    mainStart = started;
    mainEnd = completed ?? Math.max(started, nowMs);
    const durSec = (mainEnd - mainStart) / 1000;
    parts.push(`${job.status === "completed" ? "Ran" : "Running"} ${formatDuration(durSec)}`);
    label = `${kind === "failed" ? "✗ " : ""}${formatDuration(durSec)}`;
  } else {
    // Not started: the wait bar is the whole story.
    kind = "active";
    const waitedSec = waitStart !== null && waitEnd !== null ? (waitEnd - waitStart) / 1000 : 0;
    label = `Queued (${formatDuration(waitedSec)})`;
  }

  const statusText =
    job.status === "completed" ? (job.conclusion ?? "completed") : job.status.replace("_", " ");
  const stepCount = job.steps.length;
  const tooltip = `${job.name} — ${statusText}\n${parts.join(" · ") || "No timing data"}\nClick to ${stepCount > 0 ? `expand ${stepCount} steps` : "expand"}`;

  return { waitStart, waitEnd, mainStart, mainEnd, kind, label, tooltip };
}

function buildSection(job: WorkflowJob, nowMs: number): TimelineSection | null {
  const rows: TimelineRow[] = [];
  const created = parseTime(job.createdAt);
  const jobStarted = parseTime(job.startedAt);

  if (created !== null) {
    const end = jobStarted ?? Math.max(created, nowMs);
    rows.push({
      label: "Waiting for a runner",
      start: created,
      end: Math.max(created, end),
      kind: "active",
      tooltip: `${job.name} — Waiting for a runner`,
    });
  }

  for (const step of job.steps) {
    const start = parseTime(step.startedAt);
    if (start === null) continue;
    let end = parseTime(step.completedAt);
    const kind = stepKind(step.status, step.conclusion);
    if (end === null) end = Math.max(start, nowMs);
    rows.push({
      label: step.name,
      start,
      end: Math.max(start, end),
      kind,
      tooltip: `${job.name} — ${step.name} (${step.conclusion ?? step.status})`,
    });
  }

  // A job that is queued but has produced no rows yet still deserves a
  // section so the viewer sees it exists.
  if (rows.length === 0 && jobStarted === null) {
    const start = created ?? nowMs;
    rows.push({
      label: "Queued",
      start,
      end: Math.max(start, nowMs),
      kind: "active",
      tooltip: `${job.name} — queued`,
    });
  }

  if (rows.length === 0) return null;
  return {
    jobId: job.id,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    rows,
    summary: buildSummary(job, nowMs),
  };
}

function aggregateKind(members: TimelineSection[]): BarKind {
  if (members.some((m) => m.summary.kind === "failed")) return "failed";
  if (members.some((m) => m.status !== "completed")) return "active";
  if (members.every((m) => m.summary.kind === "muted")) return "muted";
  return "bar";
}

function buildGroupSummary(base: string, members: TimelineSection[]): SectionSummary {
  const min = (vals: (number | null)[]): number | null => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? Math.min(...nums) : null;
  };
  const max = (vals: (number | null)[]): number | null => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? Math.max(...nums) : null;
  };

  const waitStart = min(members.map((m) => m.summary.waitStart));
  const mainStart = min(members.map((m) => m.summary.mainStart));
  const mainEnd = max(members.map((m) => m.summary.mainEnd));
  // The group's wait segment runs until its first job starts.
  const waitEnd = mainStart ?? max(members.map((m) => m.summary.waitEnd));

  const kind = aggregateKind(members);

  let label: string;
  if (mainStart !== null && mainEnd !== null) {
    const durSec = (mainEnd - mainStart) / 1000;
    label = `${kind === "failed" ? "✗ " : ""}${members.length} jobs · ${formatDuration(durSec)}`;
  } else {
    label = `${members.length} jobs queued`;
  }

  const counts = new Map<string, number>();
  for (const m of members) {
    const s = m.status === "completed" ? (m.conclusion ?? "completed") : m.status.replace("_", " ");
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const countText = [...counts.entries()].map(([s, n]) => `${n} ${s}`).join(" · ");
  const tooltip = `${base} — ${members.length} jobs\n${countText}\nClick to expand jobs`;

  return { waitStart, waitEnd, mainStart, mainEnd, kind, label, tooltip };
}

// Matrix jobs are named "base (variant)"; two or more jobs sharing a base form
// a group and their labels shrink to the variant.
const MATRIX_NAME = /^(.*\S) \((.+)\)$/;

function buildNodes(jobs: WorkflowJob[], nowMs: number): TopNode[] {
  const nodes: TopNode[] = [];
  const groups = new Map<string, SectionGroup>();
  const baseCounts = new Map<string, number>();

  for (const job of jobs) {
    const m = MATRIX_NAME.exec(job.name);
    if (m) baseCounts.set(m[1], (baseCounts.get(m[1]) ?? 0) + 1);
  }

  for (const job of jobs) {
    const section = buildSection(job, nowMs);
    if (!section) continue;

    const m = MATRIX_NAME.exec(job.name);
    if (m && (baseCounts.get(m[1]) ?? 0) >= 2) {
      const base = m[1];
      let group = groups.get(base);
      if (!group) {
        group = { key: base, name: base, members: [], summary: null as unknown as SectionSummary };
        groups.set(base, group);
        nodes.push({ type: "group", group });
      }
      // Members display just their matrix variant; tooltips keep the full name.
      group.members.push({ ...section, name: m[2] });
    } else {
      nodes.push({ type: "single", section });
    }
  }

  for (const group of groups.values()) {
    group.summary = buildGroupSummary(group.name, group.members);
  }

  return nodes;
}

function pickTickStep(spanSeconds: number): number {
  for (const step of TICK_STEPS) {
    if (spanSeconds / step <= MAX_TICKS) return step;
  }
  const last = TICK_STEPS[TICK_STEPS.length - 1];
  return Math.ceil(spanSeconds / MAX_TICKS / last) * last;
}

function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export default function RunTimeline({
  jobs,
  title,
}: {
  jobs: WorkflowJob[];
  title: string;
}) {
  const [containerRef, containerWidth] = useContainerWidth();

  // Everything starts collapsed so the run reads at a glance; these sets hold
  // what the viewer has drilled into.
  const [expandedJobs, setExpandedJobs] = useState<ReadonlySet<number>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const toggleJob = (jobId: number) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };
  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // While any bar is open-ended (job or step still running) the chart tracks
  // wall-clock time so bars visibly grow between refetches.
  const hasOpenEnd = useMemo(
    () =>
      jobs.some(
        (j) =>
          (j.status !== "completed" && j.conclusion === null) ||
          j.steps.some((s) => s.startedAt && !s.completedAt && s.status !== "completed"),
      ),
    [jobs],
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasOpenEnd) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasOpenEnd]);

  const nodes = useMemo(() => buildNodes(jobs, nowMs), [jobs, nowMs]);

  const width = Math.max(containerWidth, MIN_CHART_W);

  // The time domain covers every step and job span regardless of what is
  // expanded, so toggling a section never rescales the axis.
  const layout = useMemo(() => {
    if (nodes.length === 0) return null;

    const starts: number[] = [];
    const ends: number[] = [];
    const gutterNeeds: number[] = [];

    const collectSection = (s: TimelineSection, indent: number, font: string) => {
      for (const r of s.rows) {
        starts.push(r.start);
        ends.push(r.end);
      }
      const su = s.summary;
      if (su.waitStart !== null) starts.push(su.waitStart);
      if (su.waitEnd !== null) ends.push(su.waitEnd);
      if (su.mainStart !== null) starts.push(su.mainStart);
      if (su.mainEnd !== null) ends.push(su.mainEnd);
      gutterNeeds.push(indent + CHEVRON_SPACE + measureText(s.name, font) + 20);
    };

    for (const node of nodes) {
      if (node.type === "single") {
        collectSection(node.section, 0, SECTION_FONT);
      } else {
        const headerLabel = `${node.group.name} (${node.group.members.length})`;
        gutterNeeds.push(CHEVRON_SPACE + measureText(headerLabel, SECTION_FONT) + 20);
        for (const member of node.group.members) {
          collectSection(member, GROUP_INDENT, MEMBER_FONT);
        }
      }
    }

    const t0 = Math.min(...starts);
    const rawEnd = Math.max(...ends);
    const rawSpanSec = Math.max(1, (rawEnd - t0) / 1000);
    const tickStep = pickTickStep(rawSpanSec);
    const spanSec = Math.max(tickStep, Math.ceil(rawSpanSec / tickStep) * tickStep);

    const gutterCap = Math.max(GUTTER_MIN, Math.floor(width * GUTTER_MAX_FRACTION));
    const gutterW = Math.min(gutterCap, Math.max(GUTTER_MIN, Math.ceil(Math.max(...gutterNeeds))));

    const chartX = gutterW;
    const chartW = Math.max(50, width - gutterW - RIGHT_PAD);
    const x = (t: number) => chartX + ((t - t0) / (spanSec * 1000)) * chartW;

    const ticks: number[] = [];
    for (let t = 0; t <= spanSec; t += tickStep) ticks.push(t);

    return { t0, gutterW, x, ticks };
  }, [nodes, width]);

  if (!layout) {
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "8px 0" }}>
          No timing data for this run yet.
        </p>
      </div>
    );
  }

  const { t0, gutterW, x, ticks } = layout;

  const allJobIds: number[] = [];
  const allGroupKeys: string[] = [];
  for (const node of nodes) {
    if (node.type === "single") allJobIds.push(node.section.jobId);
    else {
      allGroupKeys.push(node.group.key);
      for (const m of node.group.members) allJobIds.push(m.jobId);
    }
  }
  const allExpanded =
    allJobIds.every((id) => expandedJobs.has(id)) &&
    allGroupKeys.every((k) => expandedGroups.has(k));
  const setAll = (expand: boolean) => {
    setExpandedJobs(expand ? new Set(allJobIds) : new Set());
    setExpandedGroups(expand ? new Set(allGroupKeys) : new Set());
  };

  const sectionRowSpan = (s: TimelineSection) => (expandedJobs.has(s.jobId) ? s.rows.length : 1);
  const rowCount = nodes.reduce((sum, node) => {
    if (node.type === "single") return sum + sectionRowSpan(node.section);
    if (!expandedGroups.has(node.group.key)) return sum + 1;
    return sum + 1 + node.group.members.reduce((s, m) => s + sectionRowSpan(m), 0);
  }, 0);
  const bandsTop = TITLE_H;
  const bandsBottom = bandsTop + rowCount * ROW_H;
  const height = bandsBottom + AXIS_H;

  // Places a bar's label inside it when it fits, otherwise beside it on
  // whichever side has room.
  const placeLabel = (
    label: string,
    startX: number,
    barW: number,
    rowY: number,
    kind: BarKind,
    allowInside: boolean,
  ): React.ReactNode => {
    const labelW = measureText(label);
    if (allowInside && kind !== "muted" && barW >= labelW + 14) {
      const inkClass = kind === "active" ? "gantt-label-inside-soft" : "gantt-label-inside";
      return (
        <text className={inkClass} x={startX + barW / 2} y={rowY + ROW_H / 2} textAnchor="middle" dominantBaseline="central">
          {label}
        </text>
      );
    }
    if (startX + barW + 8 + labelW <= width - 6) {
      return (
        <text className="gantt-label" x={startX + barW + 6} y={rowY + ROW_H / 2} textAnchor="start" dominantBaseline="central">
          {label}
        </text>
      );
    }
    return (
      <text className="gantt-label" x={startX - 6} y={rowY + ROW_H / 2} textAnchor="end" dominantBaseline="central">
        {label}
      </text>
    );
  };

  // Renders the chevron + name in the gutter. With room for more than one
  // line (an expanded section's band) the name wraps; a single row keeps the
  // one-line ellipsis. The chevron sits beside the first line.
  const gutterName = (
    name: string,
    open: boolean,
    centerY: number,
    indent: number,
    member: boolean,
    maxLines = 1,
  ): React.ReactNode => {
    const font = member ? MEMBER_FONT : SECTION_FONT;
    const maxW = gutterW - 16 - CHEVRON_SPACE - indent;
    const lines = wrapToWidth(name, maxW, font, maxLines);
    const cx = 8 + indent;
    const textX = cx + CHEVRON_SPACE;
    const firstY = centerY - ((lines.length - 1) * LINE_H) / 2;
    return (
      <>
        <path
          className="gantt-chevron"
          d={open ? `M${cx - 1} ${firstY - 1.5}l3 3 3-3` : `M${cx + 0.5} ${firstY - 3}l3 3-3 3`}
        />
        <text
          className={member ? "gantt-section-label gantt-section-label-member" : "gantt-section-label"}
          x={textX}
          y={firstY}
          dominantBaseline="central"
        >
          {lines.map((line, i) => (
            <tspan key={i} x={textX} dy={i === 0 ? 0 : LINE_H}>
              {line}
            </tspan>
          ))}
        </text>
      </>
    );
  };

  const toggleProps = (onToggle: () => void, expanded: boolean) => ({
    role: "button" as const,
    tabIndex: 0,
    "aria-expanded": expanded,
    onClick: onToggle,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    },
  });

  // Renders a summary bar pair (wait + main) for a collapsed job or group.
  const summaryBarNodes = (summary: SectionSummary, rowY: number): React.ReactNode[] => {
    const barY = rowY + (ROW_H - BAR_H) / 2;
    const out: React.ReactNode[] = [];
    if (summary.waitStart !== null && summary.waitEnd !== null && summary.waitEnd > summary.waitStart) {
      const wx = x(summary.waitStart);
      const ww = Math.max(x(summary.waitEnd) - wx, 2);
      out.push(
        <rect key="wait" className="gantt-bar-active" x={wx} y={barY} width={ww} height={BAR_H} rx={3} ry={3} />,
      );
    }
    if (summary.mainStart !== null && summary.mainEnd !== null) {
      const mx = x(summary.mainStart);
      const durSec = (summary.mainEnd - summary.mainStart) / 1000;
      const mw = durSec > 0 ? Math.max(x(summary.mainEnd) - mx, 2) : 0;
      if (mw > 0) {
        out.push(
          <rect key="main" className={`gantt-bar-${summary.kind}`} x={mx} y={barY} width={mw} height={BAR_H} rx={3} ry={3} />,
        );
      }
    }
    return out;
  };

  const summaryLabelNode = (summary: SectionSummary, rowY: number): React.ReactNode => {
    if (summary.mainStart !== null && summary.mainEnd !== null) {
      const mx = x(summary.mainStart);
      const durSec = (summary.mainEnd - summary.mainStart) / 1000;
      const mw = durSec > 0 ? Math.max(x(summary.mainEnd) - mx, 2) : 0;
      return placeLabel(summary.label, mx, mw, rowY, summary.kind, true);
    }
    if (summary.waitStart !== null && summary.waitEnd !== null) {
      const wx = x(summary.waitStart);
      const ww = Math.max(x(summary.waitEnd) - wx, 2);
      return placeLabel(summary.label, wx, ww, rowY, "active", true);
    }
    return null;
  };

  let rowIndex = 0;
  const bands: React.ReactNode[] = [];
  const rowNodes: React.ReactNode[] = [];
  const toggleNodes: React.ReactNode[] = [];

  // Renders one job section starting at the current rowIndex; returns nothing,
  // advances rowIndex. Member sections are indented and share the group band.
  const renderSection = (section: TimelineSection, indent: number, member: boolean) => {
    const isExpanded = expandedJobs.has(section.jobId);

    if (!isExpanded) {
      const rowY = bandsTop + rowIndex * ROW_H;
      rowNodes.push(
        <g
          key={`summary-${section.jobId}`}
          className="gantt-row gantt-toggle"
          {...toggleProps(() => toggleJob(section.jobId), false)}
        >
          <rect className="gantt-row-hit" x={0} y={rowY} width={width} height={ROW_H} />
          {summaryBarNodes(section.summary, rowY)}
          {summaryLabelNode(section.summary, rowY)}
          {gutterName(section.name, false, rowY + ROW_H / 2, indent, member)}
          <title>{section.summary.tooltip}</title>
        </g>,
      );
      rowIndex += 1;
      return;
    }

    // Expanded: the gutter acts as the collapse control; each step row keeps
    // its own hover/tooltip. The band's height gives the name room to wrap.
    const bandY = bandsTop + rowIndex * ROW_H;
    const bandH = section.rows.length * ROW_H;
    const nameLines = Math.max(1, Math.floor((bandH - 4) / LINE_H));
    toggleNodes.push(
      <g
        key={`toggle-${section.jobId}`}
        className="gantt-toggle"
        {...toggleProps(() => toggleJob(section.jobId), true)}
      >
        <rect className="gantt-toggle-hit" x={0} y={bandY} width={gutterW} height={bandH} />
        {gutterName(section.name, true, bandY + bandH / 2, indent, member, nameLines)}
        <title>{`${section.name} — click to collapse`}</title>
      </g>,
    );

    for (const row of section.rows) {
      const rowY = bandsTop + rowIndex * ROW_H;
      const barY = rowY + (ROW_H - BAR_H) / 2;
      const startX = x(row.start);
      const endX = x(row.end);
      const durSec = (row.end - row.start) / 1000;
      // Sub-second steps still get a sliver of bar so the row reads as "ran"
      // rather than "skipped"; true zero-duration rows are label-only.
      const barW = durSec > 0 ? Math.max(endX - startX, 2) : 0;

      const failed = row.kind === "failed";
      const label = `${failed ? "✗ " : ""}${row.label} (${formatDuration(durSec)})`;

      const startOffset = (row.start - t0) / 1000;
      const endOffset = (row.end - t0) / 1000;
      const tooltip = `${row.tooltip}\n${formatClock(startOffset)} → ${formatClock(endOffset)} · ${formatDuration(durSec)}`;

      rowNodes.push(
        <g key={`row-${section.jobId}-${rowIndex}`} className="gantt-row">
          <rect className="gantt-row-hit" x={0} y={rowY} width={width} height={ROW_H} />
          {barW > 0 && (
            <rect
              className={`gantt-bar-${row.kind}`}
              x={startX}
              y={barY}
              width={barW}
              height={BAR_H}
              rx={3}
              ry={3}
            />
          )}
          {placeLabel(label, startX, barW, rowY, row.kind, true)}
          <title>{tooltip}</title>
        </g>,
      );

      rowIndex++;
    }
  };

  nodes.forEach((node, nodeIndex) => {
    const bandClass = `gantt-band-${nodeIndex % 3}`;
    const bandStartRow = rowIndex;

    if (node.type === "single") {
      renderSection(node.section, 0, false);
    } else {
      const { group } = node;
      const isOpen = expandedGroups.has(group.key);
      const headerLabel = `${group.name} (${group.members.length})`;

      if (!isOpen) {
        const rowY = bandsTop + rowIndex * ROW_H;
        rowNodes.push(
          <g
            key={`group-${group.key}`}
            className="gantt-row gantt-toggle"
            {...toggleProps(() => toggleGroup(group.key), false)}
          >
            <rect className="gantt-row-hit" x={0} y={rowY} width={width} height={ROW_H} />
            {summaryBarNodes(group.summary, rowY)}
            {summaryLabelNode(group.summary, rowY)}
            {gutterName(headerLabel, false, rowY + ROW_H / 2, 0, false)}
            <title>{group.summary.tooltip}</title>
          </g>,
        );
        rowIndex += 1;
      } else {
        // Header row collapses the group; members follow, indented.
        const rowY = bandsTop + rowIndex * ROW_H;
        rowNodes.push(
          <g
            key={`group-${group.key}`}
            className="gantt-row gantt-toggle"
            {...toggleProps(() => toggleGroup(group.key), true)}
          >
            <rect className="gantt-row-hit" x={0} y={rowY} width={width} height={ROW_H} />
            {gutterName(headerLabel, true, rowY + ROW_H / 2, 0, false)}
            <title>{`${group.name} — click to collapse the group`}</title>
          </g>,
        );
        rowIndex += 1;

        group.members.forEach((memberSection, memberIndex) => {
          if (memberIndex > 0) {
            const sepY = bandsTop + rowIndex * ROW_H;
            rowNodes.push(
              <line
                key={`sep-${group.key}-${memberSection.jobId}`}
                className="gantt-grid"
                x1={GROUP_INDENT}
                y1={sepY}
                x2={width - 6}
                y2={sepY}
              />,
            );
          }
          renderSection(memberSection, GROUP_INDENT, true);
        });
      }
    }

    const bandY = bandsTop + bandStartRow * ROW_H;
    const bandH = (rowIndex - bandStartRow) * ROW_H;
    bands.push(
      <rect key={`band-${nodeIndex}`} className={bandClass} x={0} y={bandY} width={width} height={bandH} />,
    );
  });

  return (
    <div ref={containerRef} style={{ width: "100%", overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 8px" }}>
        <button className="gantt-expand-all" onClick={() => setAll(!allExpanded)}>
          {allExpanded ? "Collapse all jobs" : "Expand all jobs"}
        </button>
      </div>
      <svg
        width={width}
        height={height}
        style={{ display: "block", fontFamily: FONT_STACK }}
        role="img"
        aria-label={`Timeline of workflow run: ${title}`}
      >
        <text className="gantt-title" x={width / 2} y={TITLE_H / 2 + 4} textAnchor="middle">
          {title}
        </text>
        {bands}
        <g>
          {ticks.map((t) => {
            const tickX = x(t0 + t * 1000);
            return (
              <g key={`tick-${t}`}>
                <line className="gantt-grid" x1={tickX} y1={bandsTop} x2={tickX} y2={bandsBottom} />
                <text className="gantt-axis-label" x={tickX} y={bandsBottom + 16} textAnchor="middle">
                  {formatClock(t)}
                </text>
              </g>
            );
          })}
        </g>
        {rowNodes}
        {toggleNodes}
      </svg>
    </div>
  );
}
