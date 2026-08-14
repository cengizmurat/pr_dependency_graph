import { useMemo } from "react";
import type { Measure, TimeBucket } from "../folderChurn";
import { MEASURE_LABELS } from "../folderChurn";
import {
  CHART_FONT_STACK,
  axisTicks,
  formatCount,
  measureText,
  truncateToWidth,
  useContainerWidth,
} from "./churnChartUtils";
import { styles } from "./FolderChurnView.styles";

export interface ChurnSeries {
  folder: string;
  color: string;
  values: number[];
  // Charted, but untouched anywhere in this interval. Kept on the legend
  // rather than dropped, so narrowing the interval never silently discards
  // part of the selection.
  dormant: boolean;
}

const HEIGHT = 260;
const PAD_TOP = 10;
const PAD_BOTTOM = 26;
const PAD_LEFT = 46;
// Room to the right of the plot for the endpoint labels.
const PAD_RIGHT = 116;
const MAX_Y_TICKS = 5;
const AXIS_FONT = `10px ${CHART_FONT_STACK}`;
const LABEL_FONT = `600 11px ${CHART_FONT_STACK}`;

// Two endpoint labels closer together than this cannot be told apart, and a
// label that sits beside the wrong series' end marker is worse than no label
// at all — so when two collide, both are dropped rather than one.
const LABEL_MIN_GAP = 14;

export default function ChurnTrendChart({
  buckets,
  series,
  measure,
  partialNotes,
  onRemoveSeries,
}: {
  buckets: TimeBucket[];
  series: ChurnSeries[];
  measure: Measure;
  partialNotes: string[];
  onRemoveSeries: (folder: string) => void;
}) {
  const [containerRef, containerWidth] = useContainerWidth();
  const width = Math.max(containerWidth, 360);

  const live = useMemo(() => series.filter((s) => !s.dormant), [series]);

  const geometry = useMemo(() => {
    const plotLeft = PAD_LEFT;
    const plotRight = width - PAD_RIGHT;
    const plotWidth = Math.max(1, plotRight - plotLeft);
    const plotTop = PAD_TOP;
    const plotBottom = HEIGHT - PAD_BOTTOM;
    const plotHeight = plotBottom - plotTop;

    const rawMax = live.reduce(
      (max, s) => Math.max(max, ...s.values, 0),
      0,
    );
    const ticks = axisTicks(rawMax || 1, MAX_Y_TICKS);
    const yMax = ticks[ticks.length - 1] || 1;

    const x = (index: number) =>
      buckets.length <= 1
        ? plotLeft + plotWidth / 2
        : plotLeft + (index * plotWidth) / (buckets.length - 1);
    const y = (value: number) => plotBottom - (value / yMax) * plotHeight;

    return { plotLeft, plotRight, plotWidth, plotTop, plotBottom, plotHeight, ticks, yMax, x, y };
  }, [width, buckets.length, live]);

  // Endpoint labels, decided together: a label is only drawn when no other
  // series ends near enough for the two to be confused.
  const endpointLabels = useMemo(() => {
    if (buckets.length === 0) return [];
    const last = buckets.length - 1;
    const ends = live.map((s) => ({
      folder: s.folder,
      color: s.color,
      y: geometry.y(s.values[last] ?? 0),
    }));
    return ends.map((end, i) => ({
      ...end,
      visible: ends.every((other, j) => j === i || Math.abs(other.y - end.y) >= LABEL_MIN_GAP),
    }));
  }, [live, buckets.length, geometry]);

  // Thin out x labels until the ones that remain cannot overlap.
  const xLabelStep = useMemo(() => {
    if (buckets.length <= 1) return 1;
    const widest = buckets.reduce(
      (max, b) => Math.max(max, measureText(b.label, AXIS_FONT)),
      0,
    );
    const perLabel = geometry.plotWidth / (buckets.length - 1);
    return Math.max(1, Math.ceil((widest + 10) / Math.max(perLabel, 1)));
  }, [buckets, geometry.plotWidth]);

  const measureLabel = MEASURE_LABELS[measure];

  return (
    <section style={styles.card}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}>Churn over time</h3>
        <p style={styles.cardSubtitle}>
          One commit touches several folders, so these lines overlap rather than
          divide a total — they are not stacked, and they do not add up to the
          commit count.
        </p>
        {partialNotes.length > 0 && (
          <p style={styles.cardNote}>
            Partial buckets: {partialNotes.join("; ")} — the end points sit
            lower because the period is shorter, not because activity stopped.
          </p>
        )}
      </div>

      <div ref={containerRef} style={styles.chartBody}>
        {series.length === 0 ? (
          <p style={styles.emptyChart}>
            No folder is charted. Pick one from the ranked bars below to plot it
            over time.
          </p>
        ) : (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${measureLabel} over time for ${live.length} folders`}
          >
            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line
                  className="churn-grid"
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                />
                <text
                  className="churn-axis-label"
                  x={geometry.plotLeft - 8}
                  y={geometry.y(tick) + 3}
                  textAnchor="end"
                >
                  {formatCount(tick)}
                </text>
              </g>
            ))}

            {buckets.map((bucket, i) =>
              i % xLabelStep === 0 ? (
                <text
                  key={bucket.startDay}
                  className="churn-axis-label"
                  x={geometry.x(i)}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                >
                  {bucket.label}
                </text>
              ) : null,
            )}

            {live.map((s) => (
              <g key={s.folder}>
                <path
                  className="churn-line"
                  stroke={s.color}
                  d={s.values
                    .map((v, i) => `${i === 0 ? "M" : "L"}${geometry.x(i)},${geometry.y(v)}`)
                    .join(" ")}
                />
                {(buckets.length <= 40 || buckets.length === 1) &&
                  s.values.map((v, i) => (
                    <circle
                      key={i}
                      cx={geometry.x(i)}
                      cy={geometry.y(v)}
                      r={2.5}
                      fill={s.color}
                    />
                  ))}
              </g>
            ))}

            {endpointLabels.map((end) => (
              <g key={end.folder}>
                <circle
                  cx={geometry.x(buckets.length - 1)}
                  cy={end.y}
                  r={3.5}
                  fill={end.color}
                />
                {end.visible && (
                  <text
                    className="churn-endpoint-label"
                    fill={end.color}
                    x={geometry.x(buckets.length - 1) + 8}
                    y={end.y + 4}
                  >
                    {truncateToWidth(end.folder, PAD_RIGHT - 14, LABEL_FONT)}
                  </text>
                )}
              </g>
            ))}

            {buckets.map((bucket, i) => (
              <rect
                key={bucket.startDay}
                x={geometry.x(i) - Math.max(geometry.plotWidth / Math.max(buckets.length, 1), 6) / 2}
                y={geometry.plotTop}
                width={Math.max(geometry.plotWidth / Math.max(buckets.length, 1), 6)}
                height={geometry.plotHeight}
                fill="transparent"
              >
                <title>
                  {`${bucket.fullLabel}${
                    bucket.coveredDays < bucket.totalDays
                      ? ` (covers ${bucket.coveredDays} of ${bucket.totalDays} days)`
                      : ""
                  }\n${live
                    .map((s) => `${s.folder}: ${s.values[i] ?? 0} ${measureLabel}`)
                    .join("\n")}`}
                </title>
              </rect>
            ))}
          </svg>
        )}
      </div>

      {series.length >= 1 && (
        <ul style={styles.legend}>
          {series.map((s) => (
            <li key={s.folder}>
              <button
                type="button"
                className="churn-legend-item"
                style={styles.legendItem}
                onClick={() => onRemoveSeries(s.folder)}
                title={`Remove ${s.folder} from the chart`}
              >
                <span style={{ ...styles.legendSwatch, background: s.color }} />
                <span style={styles.legendLabel}>{s.folder}</span>
                {s.dormant && <span style={styles.legendMuted}>untouched</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
