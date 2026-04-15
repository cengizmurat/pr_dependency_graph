import { COLORS } from "../constants";
import { styles } from "./Legend.styles";

const ARROW_ITEMS = [
  { color: COLORS.ready, id: "legend-approved", label: "Approved" },
  { color: COLORS.conflict, id: "legend-changes", label: "Changes requested" },
  { color: COLORS.edge, id: "legend-pending", label: "Pending review" },
];

export default function Legend() {
  return (
    <div style={styles.container}>
      <div style={styles.title}>Legend</div>
      <div style={styles.section}>Nodes</div>
      <div style={styles.row}>
        <span
          style={{
            ...styles.nodeChip,
            borderColor: COLORS.ready,
            background: COLORS.readyBg,
          }}
        />
        <span style={styles.label}>Open</span>
      </div>
      <div style={styles.row}>
        <span
          style={{
            ...styles.nodeChip,
            borderColor: COLORS.draft,
            background: COLORS.draftBg,
          }}
        />
        <span style={styles.label}>Draft</span>
      </div>
      <div style={{ ...styles.section, marginTop: 6 }}>Arrows</div>
      {ARROW_ITEMS.map(({ color, id, label }) => (
        <div key={id} style={styles.row}>
          <svg width="28" height="12" viewBox="0 0 28 12">
            <defs>
              <marker
                id={id}
                viewBox="0 -4 8 8"
                refX="0"
                refY="0"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M8,-4L0,0L8,4" fill={color} />
              </marker>
            </defs>
            <line
              x1="6"
              y1="6"
              x2="28"
              y2="6"
              stroke={color}
              strokeWidth="2"
              markerStart={`url(#${id})`}
            />
          </svg>
          <span style={styles.label}>{label}</span>
        </div>
      ))}
      <div style={{ ...styles.section, marginTop: 6 }}>Badges</div>
      <div style={styles.row}>
        <span style={{ ...styles.badge, borderColor: COLORS.ready }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6L5 9L10 3"
              stroke={COLORS.ready}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span style={styles.label}>Ready to merge (click to merge)</span>
      </div>
      <div style={styles.row}>
        <span style={{ ...styles.badge, borderColor: COLORS.conflict }}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 3L9 9M9 3L3 9"
              stroke={COLORS.conflict}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span style={styles.label}>Merge conflict</span>
      </div>
      <div style={styles.row}>
        <span style={{ ...styles.badge, borderColor: COLORS.behind }}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill={COLORS.behind}>
            <path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5ZM1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834Z" />
          </svg>
        </span>
        <span style={styles.label}>Behind base branch (click to update)</span>
      </div>
    </div>
  );
}
