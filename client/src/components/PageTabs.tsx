export type PageTab = "prs" | "workflows";

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "stretch",
    gap: 8,
    padding: "0 16px",
    borderBottom: "1px solid var(--color-border-subtle)",
    background: "var(--color-header-bg)",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    fontSize: 13,
    fontWeight: 500,
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    transition: "color 0.15s",
  },
  tabActive: {
    color: "var(--color-text)",
    fontWeight: 600,
    borderBottom: "2px solid var(--color-link)",
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
];

export default function PageTabs({
  active,
  onChange,
}: {
  active: PageTab;
  onChange: (tab: PageTab) => void;
}) {
  return (
    <nav style={styles.bar} role="tablist" aria-label="Repository views">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            className="page-tab"
            role="tab"
            aria-selected={isActive}
            style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
            onClick={() => onChange(tab.id)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
              <path d={tab.iconPath} />
            </svg>
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
