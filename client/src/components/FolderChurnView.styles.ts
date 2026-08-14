export const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    overflowY: "auto" as const,
    padding: "16px 20px 40px",
  },

  // --- Controls ---

  controls: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "flex-end",
    gap: 14,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--churn-tile-bg)",
  },
  control: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 5,
    minWidth: 0,
  },
  controlGrow: {
    flex: "1 1 200px",
    maxWidth: 340,
  },
  rangePicker: {
    width: 230,
  },
  controlPair: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "flex-end",
    gap: 14,
    minWidth: 0,
  },
  controlLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
    color: "var(--color-text-secondary)",
  },
  presetRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
  },
  // A segmented control is as wide as its options, which is wider than a phone.
  // Letting the group scroll keeps every option reachable instead of clipping
  // the last one against the edge of the card.
  segmentedScroll: {
    maxWidth: "100%",
    overflowX: "auto" as const,
    paddingBottom: 2,
  },

  // --- The fetch action bar ---

  // Deliberately loud and directly under the controls: nothing is read from
  // GitHub until this is pressed, so it has to be the obvious next move.
  actionBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    alignItems: "center",
    gap: 16,
    marginTop: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--churn-tile-bg)",
  },
  fetchBtn: {
    padding: "10px 20px",
    borderRadius: 6,
    border: "none",
    background: "var(--color-button-bg)",
    color: "var(--color-button-text)",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  fetchBtnDisabled: {
    opacity: 0.55,
    cursor: "default",
  },
  // Once a window has been read the button is still there to re-read it, but
  // it stops competing with the charts for attention.
  fetchBtnDone: {
    background: "transparent",
    color: "var(--color-link)",
    border: "1px solid var(--color-border)",
    fontSize: 13,
    padding: "7px 14px",
  },
  actionText: {
    minWidth: 0,
  },
  actionHeadline: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  actionDetail: {
    marginTop: 2,
    fontSize: 12,
    color: "var(--color-text-secondary)",
  },

  // --- Explanatory notes ---

  note: {
    margin: "10px 2px 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--color-text-secondary)",
  },
  noteCode: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 11,
  },

  // --- Stat tiles ---

  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginTop: 16,
  },
  tile: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--churn-tile-bg)",
    minWidth: 0,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
    color: "var(--color-text-secondary)",
  },
  tileValue: {
    marginTop: 6,
    fontSize: 24,
    fontWeight: 600,
    lineHeight: 1.1,
    color: "var(--color-text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  tileHint: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 1.4,
    color: "var(--color-text-secondary)",
  },

  // --- Cards holding a chart or the table ---

  card: {
    marginTop: 16,
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--color-page-bg)",
    overflow: "hidden",
  },
  cardHeader: {
    padding: "12px 14px 8px",
  },
  cardTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  cardCount: {
    fontWeight: 400,
    color: "var(--color-text-secondary)",
  },
  cardSubtitle: {
    margin: "4px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--color-text-secondary)",
    maxWidth: 780,
  },
  cardNote: {
    margin: "6px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--color-text-secondary)",
    maxWidth: 780,
    fontStyle: "italic" as const,
  },
  chartBody: {
    padding: "0 14px 8px",
  },
  barBody: {
    padding: "0 14px 12px",
    maxHeight: 420,
    overflowY: "auto" as const,
  },
  emptyChart: {
    margin: 0,
    padding: "28px 0",
    textAlign: "center" as const,
    fontSize: 13,
    color: "var(--color-text-secondary)",
  },

  // --- Legend ---

  legend: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "6px 16px",
    listStyle: "none",
    margin: 0,
    padding: "4px 14px 14px",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--color-text)",
    fontFamily: "inherit",
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
    flexShrink: 0,
  },
  legendLabel: {
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  legendMuted: {
    fontSize: 11,
    color: "var(--color-text-secondary)",
    fontStyle: "italic" as const,
  },

  // --- Table ---

  tableWrap: {
    overflowX: "auto" as const,
    padding: "0 0 4px",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  },
  th: {
    position: "sticky" as const,
    top: 0,
    textAlign: "left" as const,
    padding: "7px 14px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
    color: "var(--color-text-secondary)",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-page-bg)",
    whiteSpace: "nowrap" as const,
  },
  thNumeric: {
    textAlign: "right" as const,
  },
  td: {
    padding: "6px 14px",
    borderBottom: "1px solid var(--color-border-subtle)",
    color: "var(--color-text)",
  },
  tdNumeric: {
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
  },
  folderCell: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  swatchDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  },
  swatchDotEmpty: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
    border: "1px solid var(--color-border)",
  },
  goneBadge: {
    padding: "0 6px",
    borderRadius: 7,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.3,
    background: "var(--churn-gone-bg)",
    color: "var(--churn-gone-text)",
  },

  // --- Status, errors and the unknown-folder panel ---

  panel: {
    marginTop: 16,
    padding: "16px 18px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--churn-tile-bg)",
  },
  panelTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
  },
  panelText: {
    margin: "6px 0 0",
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--color-text-secondary)",
    maxWidth: 760,
  },
  suggestions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    marginTop: 12,
  },
  suggestion: {
    padding: "4px 10px",
    borderRadius: 14,
    border: "1px solid var(--color-border)",
    background: "var(--color-page-bg)",
    color: "var(--color-link)",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    cursor: "pointer",
  },
  suggestionRoot: {
    fontFamily: "inherit",
    fontWeight: 500,
  },
  errorText: {
    color: "var(--color-error)",
  },
  primaryBtn: {
    marginTop: 12,
    padding: "6px 14px",
    borderRadius: 6,
    border: "none",
    background: "var(--color-button-bg)",
    color: "var(--color-button-text)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  panelWarning: {
    borderColor: "var(--churn-warn-border)",
    background: "var(--churn-warn-bg)",
  },

  // The progress strip sits above the charts rather than replacing them: the
  // numbers are live from the first commit, and this says how much is still
  // to come.
  progressPanel: {
    marginTop: 16,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "var(--churn-tile-bg)",
  },
  progressRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  progressText: {
    fontSize: 12,
    color: "var(--color-text-secondary)",
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--color-text)",
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  progressTrack: {
    marginTop: 8,
    height: 4,
    borderRadius: 2,
    background: "var(--color-border)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--color-link)",
    transition: "width 0.2s",
  },
};
