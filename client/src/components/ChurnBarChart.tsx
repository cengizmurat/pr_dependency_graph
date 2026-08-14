import { useMemo } from "react";
import type { FolderTotals, Measure } from "../folderChurn";
import { MEASURE_LABELS, measureOf } from "../folderChurn";
import {
  CHART_FONT_STACK,
  formatCount,
  measureText,
  truncateToWidth,
  useContainerWidth,
} from "./churnChartUtils";
import { styles } from "./FolderChurnView.styles";

const ROW_H = 24;
const BAR_H = 14;
const GUTTER_MIN = 90;
const GUTTER_MAX_FRACTION = 0.42;
// Room at the right of a bar for its value.
const VALUE_W = 62;
const LABEL_FONT = `11px ${CHART_FONT_STACK}`;
const GONE_BADGE_W = 42;

export default function ChurnBarChart({
  folders,
  measure,
  colorFor,
  onToggle,
}: {
  folders: FolderTotals[];
  measure: Measure;
  // The series colour when the folder is charted, null when it is not.
  colorFor: (folder: string) => string | null;
  onToggle: (folder: string) => void;
}) {
  const [containerRef, containerWidth] = useContainerWidth();
  const width = Math.max(containerWidth, 320);

  const gutter = useMemo(() => {
    const widest = folders.reduce(
      (max, f) =>
        Math.max(max, measureText(f.folder, LABEL_FONT) + (f.gone ? GONE_BADGE_W : 0)),
      0,
    );
    return Math.min(
      Math.max(GUTTER_MIN, widest + 12),
      Math.round(width * GUTTER_MAX_FRACTION),
    );
  }, [folders, width]);

  const max = folders.reduce((m, f) => Math.max(m, measureOf(f, measure)), 0);
  const barArea = Math.max(1, width - gutter - VALUE_W);
  const height = Math.max(folders.length * ROW_H, ROW_H);
  const measureLabel = MEASURE_LABELS[measure];

  return (
    <section style={styles.card}>
      <div style={styles.cardHeader}>
        <h3 style={styles.cardTitle}>
          Every folder in the interval{" "}
          <span style={styles.cardCount}>({folders.length})</span>
        </h3>
        <p style={styles.cardSubtitle}>
          Click a bar to add or remove that folder from the trend chart above.
          Charted folders carry their series colour; the rest stay grey, because
          folders are names rather than amounts.
        </p>
      </div>

      <div ref={containerRef} style={styles.barBody}>
        {folders.length === 0 ? (
          <p style={styles.emptyChart}>No folder was modified in this interval.</p>
        ) : (
          <svg width={width} height={height} role="list">
            {folders.map((folder, i) => {
              const value = measureOf(folder, measure);
              const barW = max > 0 ? Math.max((value / max) * barArea, value > 0 ? 2 : 0) : 0;
              const charted = colorFor(folder.folder);
              const y = i * ROW_H;
              return (
                <g
                  key={folder.folder}
                  className="churn-bar-row"
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${folder.folder}: ${value} ${measureLabel}${
                    charted ? ", charted" : ""
                  }`}
                  onClick={() => onToggle(folder.folder)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggle(folder.folder);
                    }
                  }}
                >
                  <rect
                    className="churn-bar-hit"
                    x={0}
                    y={y}
                    width={width}
                    height={ROW_H}
                    rx={3}
                  />
                  <title>
                    {`${folder.folder}\n${folder.commits} commits · ${folder.files} files changed · ${folder.lines} lines changed${
                      folder.gone ? "\nNo longer present at the branch tip" : ""
                    }`}
                  </title>
                  <text
                    className="churn-bar-label"
                    x={4}
                    y={y + ROW_H / 2 + 4}
                    fontWeight={charted ? 600 : 400}
                  >
                    {truncateToWidth(
                      folder.folder,
                      gutter - 12 - (folder.gone ? GONE_BADGE_W : 0),
                      LABEL_FONT,
                    )}
                  </text>
                  {folder.gone && (
                    <g>
                      <rect
                        x={gutter - GONE_BADGE_W - 4}
                        y={y + ROW_H / 2 - 7}
                        width={GONE_BADGE_W - 6}
                        height={14}
                        rx={7}
                        fill="var(--churn-gone-bg)"
                      />
                      <text
                        x={gutter - GONE_BADGE_W - 4 + (GONE_BADGE_W - 6) / 2}
                        y={y + ROW_H / 2 + 3}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={700}
                        fill="var(--churn-gone-text)"
                      >
                        GONE
                      </text>
                    </g>
                  )}
                  <rect
                    className="churn-bar-fill"
                    x={gutter}
                    y={y + (ROW_H - BAR_H) / 2}
                    width={barW}
                    height={BAR_H}
                    rx={2}
                    fill={charted ?? "var(--churn-bar-neutral)"}
                  />
                  <text
                    className="churn-bar-value"
                    x={gutter + barW + 6}
                    y={y + ROW_H / 2 + 4}
                  >
                    {formatCount(value)}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </section>
  );
}
