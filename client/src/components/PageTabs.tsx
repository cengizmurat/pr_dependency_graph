import { useMemo, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
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
  actions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  // The phone layout: a bar along the bottom of the screen, one item per
  // view, the way native apps place their main navigation.
  bottomBar: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "space-around",
    flexShrink: 0,
    padding: "6px 8px calc(8px + env(safe-area-inset-bottom, 0px))",
    borderTop: "1px solid var(--color-border-subtle)",
    background: "var(--color-header-bg)",
  },
  bottomItem: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 4,
    flex: "1 1 0",
    minWidth: 0,
    padding: "4px 0",
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  },
  bottomItemActive: {
    color: "var(--color-link)",
  },
  bottomIconWrap: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 60,
    height: 32,
  },
  // The pill behind the active icon, which slides to the item that is tapped.
  bottomPill: {
    position: "absolute" as const,
    inset: 0,
    borderRadius: 16,
    background: "color-mix(in srgb, var(--color-link) 18%, transparent)",
  },
  bottomLabel: {
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.2,
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  },
  bottomLabelActive: {
    fontWeight: 600,
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

function TabIcon({ path, size }: { path: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      width={size}
      height={size}
      style={size ? { position: "relative", flexShrink: 0 } : undefined}
    >
      <path d={path} />
    </svg>
  );
}

const PILL_SPRING = { type: "spring", stiffness: 420, damping: 34 } as const;

// The three views of a repository. On a desktop they are a gooey segmented
// control along the top, with room at its right end for the page's actions;
// on a phone they are a bar along the bottom of the screen, within reach of
// a thumb. The active tab still lives in the URL; this only draws it.
export default function PageTabs({
  active,
  onChange,
  actions,
}: {
  active: PageTab;
  onChange: (tab: PageTab) => void;
  // Controls shown at the right end of the desktop bar, where there is room.
  actions?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const reduced = useReducedMotion() ?? false;
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

  if (isMobile) {
    return (
      <nav style={styles.bottomBar} aria-label="Repository views">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onChange(tab.id)}
              style={{
                ...styles.bottomItem,
                ...(isActive ? styles.bottomItemActive : {}),
              }}
            >
              <span style={styles.bottomIconWrap}>
                {isActive && (
                  <motion.span
                    layoutId="page-tab-pill"
                    style={styles.bottomPill}
                    transition={reduced ? { duration: 0 } : PILL_SPRING}
                  />
                )}
                <TabIcon path={tab.iconPath} size={20} />
              </span>
              <span
                style={{
                  ...styles.bottomLabel,
                  ...(isActive ? styles.bottomLabelActive : {}),
                }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    );
  }

  const index = Math.max(
    0,
    TABS.findIndex((tab) => tab.id === active),
  );

  return (
    <div style={styles.bar}>
      <GooeyNav
        aria-label="Repository views"
        items={items}
        value={index}
        onChange={(i) => onChange(TABS[i].id)}
        size="sm"
        activeColor={accent}
        activeLabelColor={onAccent}
      />
      {actions && <div style={styles.actions}>{actions}</div>}
    </div>
  );
}
