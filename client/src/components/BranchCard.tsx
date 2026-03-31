import type { BranchNode } from "../types";

interface Props {
  branch: BranchNode;
}

export default function BranchCard({ branch }: Props) {
  return (
    <div style={styles.card}>
      <span style={styles.name}>{branch.name}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    padding: "0 10px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  name: {
    color: "#8957e5",
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    textAlign: "center" as const,
  },
};
