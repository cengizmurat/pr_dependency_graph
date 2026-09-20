import { useMemo, type ReactNode } from "react";
import { GooeyNav } from "@/components/ui/gooey-nav";
import { FOLDER_ICON_PATH } from "../constants";
import { useIsMobile } from "../hooks/useIsMobile";
import { useThemeColor } from "../hooks/useThemeColor";

export type PageTab = "prs" | "workflows" | "churn";

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px",
    borderBottom: "1px solid var(--color-border-subtle)",
    background: "var(--color-header-bg)",
  },
  barMobile: {
    padding: "6px 12px",
  },
  actions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
};

const TABS: { id: PageTab; label: string; iconPath: string }[] = [
  {
    id: "prs",
    label: "Pull requests",
    iconPath:
      "M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z",
  },
  {
    id: "workflows",
    label: "Workflows",
    iconPath:
      "M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z",
  },
  {
    id: "churn",
    label: "Folder churn",
    iconPath: FOLDER_ICON_PATH,
  },
];

function TabIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  );
}

// The three views of a repository, as a gooey segmented control: the selected
// tile pulls away from its neighbours, and the seam between two resting tiles
// closes up. The active tab still lives in the URL; this only draws it.
export default function PageTabs({
  active,
  onChange,
  actions,
}: {
  active: PageTab;
  onChange: (tab: PageTab) => void;
  // Controls shown at the right end of the bar, where there is room for them.
  actions?: ReactNode;
}) {
  const isMobile = useIsMobile();
  // The tile is painted by an SVG gradient as well as a background, and the
  // gradient stop cannot resolve a var(), so the accent is read out here.
  const accent = useThemeColor("--color-link", "#0969da");
  const onAccent = useThemeColor("--color-on-link", "#ffffff");

  const items = useMemo(
    () =>
      TABS.map((tab) => ({
        label: tab.label,
        icon: <TabIcon path={tab.iconPath} />,
      })),
    [],
  );
  const index = Math.max(
    0,
    TABS.findIndex((tab) => tab.id === active),
  );

  return (
    <div style={{ ...styles.bar, ...(isMobile ? styles.barMobile : {}) }}>
      <GooeyNav
        aria-label="Repository views"
        items={items}
        value={index}
        onChange={(i) => onChange(TABS[i].id)}
        size={isMobile ? "xs" : "sm"}
        activeColor={accent}
        activeLabelColor={onAccent}
      />
      {actions && <div style={styles.actions}>{actions}</div>}
    </div>
  );
}
