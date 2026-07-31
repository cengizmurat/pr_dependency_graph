import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkflowJob } from "../types";

// Gantt-style timeline of a workflow run, in the spirit of a Mermaid gantt
// chart: one section per job (alternating band tints), one row per step, plus a
// synthetic "Waiting for a runner" row per job (created_at -> started_at).

const TITLE_H = 34;
const ROW_H = 24;
const BAR_H = 16;
const AXIS_H = 30;
// Wide enough that the last centered axis label ("00:00:45") stays inside the
// SVG instead of clipping at the right edge.
const RIGHT_PAD = 30;
const GUTTER_MIN = 56;
const GUTTER_MAX = 150;
const MIN_CHART_W = 480;
const LABEL_FONT = 11;
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

type BarKind = "bar" | "active" | "failed" | "muted";

interface TimelineRow {
  label: string;
  // ms epoch; end === start renders as a label-only row (zero duration).
  start: number;
  end: number;
  kind: BarKind;
  tooltip: string;
}

interface TimelineSection {
  name: string;
  rows: TimelineRow[];
}

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

function stepKind(status: string, conclusion: string | null): BarKind {
  if (status !== "completed") return "active";
  if (conclusion === "failure" || conclusion === "timed_out") return "failed";
  if (conclusion === "skipped" || conclusion === "cancelled") return "muted";
  return "bar";
}

function buildSections(jobs: WorkflowJob[], nowMs: number): TimelineSection[] {
  const sections: TimelineSection[] = [];

  for (const job of jobs) {
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

    if (rows.length > 0) sections.push({ name: job.name, rows });
  }

  return sections;
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

  const sections = useMemo(() => buildSections(jobs, nowMs), [jobs, nowMs]);

  const width = Math.max(containerWidth, MIN_CHART_W);

  const layout = useMemo(() => {
    if (sections.length === 0) return null;

    const allRows = sections.flatMap((s) => s.rows);
    const t0 = Math.min(...allRows.map((r) => r.start));
    const rawEnd = Math.max(...allRows.map((r) => r.end));
    const rawSpanSec = Math.max(1, (rawEnd - t0) / 1000);
    const tickStep = pickTickStep(rawSpanSec);
    const spanSec = Math.max(tickStep, Math.ceil(rawSpanSec / tickStep) * tickStep);

    const gutterW = Math.min(
      GUTTER_MAX,
      Math.max(
        GUTTER_MIN,
        Math.ceil(Math.max(...sections.map((s) => measureText(s.name, `600 ${LABEL_FONT}px ${FONT_STACK}`)))) + 20,
      ),
    );

    const chartX = gutterW;
    const chartW = Math.max(50, width - gutterW - RIGHT_PAD);
    const x = (t: number) => chartX + ((t - t0) / (spanSec * 1000)) * chartW;

    const rowCount = allRows.length;
    const bandsTop = TITLE_H;
    const bandsBottom = bandsTop + rowCount * ROW_H;
    const height = bandsBottom + AXIS_H;

    const ticks: number[] = [];
    for (let t = 0; t <= spanSec; t += tickStep) ticks.push(t);

    return { t0, spanSec, tickStep, gutterW, chartX, chartW, x, bandsTop, bandsBottom, height, ticks };
  }, [sections, width]);

  if (!layout) {
    return (
      <div ref={containerRef} style={{ width: "100%" }}>
        <p style={{ color: "var(--color-text-secondary)", fontSize: 13, margin: "8px 0" }}>
          No timing data for this run yet.
        </p>
      </div>
    );
  }

  const { t0, gutterW, x, bandsTop, bandsBottom, height, ticks } = layout;

  let rowIndex = 0;
  const bands: React.ReactNode[] = [];
  const rowNodes: React.ReactNode[] = [];
  const sectionLabels: React.ReactNode[] = [];

  sections.forEach((section, sectionIndex) => {
    const bandY = bandsTop + rowIndex * ROW_H;
    const bandH = section.rows.length * ROW_H;
    const bandClass = `gantt-band-${sectionIndex % 3}`;

    bands.push(
      <rect key={`band-${sectionIndex}`} className={bandClass} x={0} y={bandY} width={width} height={bandH} />,
    );

    const sectionLabel = truncateToWidth(section.name, gutterW - 16, `600 ${LABEL_FONT}px ${FONT_STACK}`);
    sectionLabels.push(
      <text
        key={`section-${sectionIndex}`}
        className="gantt-section-label"
        x={8}
        y={bandY + bandH / 2}
        dominantBaseline="central"
      >
        {sectionLabel}
        <title>{section.name}</title>
      </text>,
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
      const labelW = measureText(label);

      let labelNode: React.ReactNode;
      const fitsInside = row.kind !== "muted" && barW >= labelW + 14;
      if (fitsInside) {
        const inkClass = row.kind === "active" ? "gantt-label-inside-soft" : "gantt-label-inside";
        labelNode = (
          <text className={inkClass} x={startX + barW / 2} y={rowY + ROW_H / 2} textAnchor="middle" dominantBaseline="central">
            {label}
          </text>
        );
      } else if (startX + barW + 8 + labelW <= width - 6) {
        labelNode = (
          <text className="gantt-label" x={startX + barW + 6} y={rowY + ROW_H / 2} textAnchor="start" dominantBaseline="central">
            {label}
          </text>
        );
      } else {
        labelNode = (
          <text className="gantt-label" x={startX - 6} y={rowY + ROW_H / 2} textAnchor="end" dominantBaseline="central">
            {label}
          </text>
        );
      }

      const startOffset = (row.start - t0) / 1000;
      const endOffset = (row.end - t0) / 1000;
      const tooltip = `${row.tooltip}\n${formatClock(startOffset)} → ${formatClock(endOffset)} · ${formatDuration(durSec)}`;

      rowNodes.push(
        <g key={`row-${rowIndex}`} className="gantt-row">
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
          {labelNode}
          <title>{tooltip}</title>
        </g>,
      );

      rowIndex++;
    }
  });

  return (
    <div ref={containerRef} style={{ width: "100%", overflowX: "auto" }}>
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
        {sectionLabels}
      </svg>
    </div>
  );
}
