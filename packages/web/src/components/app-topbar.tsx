import { useLocation } from "@tanstack/react-router";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useThemeStore } from "@/stores/theme-store";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";

const VIEW_TITLES: Record<string, string> = {
  inbox: "Inbox",
  board: "Board",
  roadmap: "Roadmap",
  dependencies: "Dependencies",
  issue: "Issue",
  cycles: "Cycles",
  settings: "Settings",
  workspaces: "Workspaces",
  "project-select": "Pick a project",
  profile: "Profile",
};

interface Crumb {
  label: string;
  mono?: boolean;
}

function buildCrumbs(pathname: string): Crumb[] {
  const m = pathname.match(/^\/(board|roadmap|dependencies|cycles)\/([^/]+)/);
  if (m && m[1] && m[2]) {
    const view = m[1];
    const projectKey = m[2];
    return [
      { label: projectKey, mono: true },
      { label: VIEW_TITLES[view] ?? view },
    ];
  }
  const segments = pathname.split("/").filter(Boolean);
  const head = segments[0];
  if (!head) return [{ label: "Inbox" }];
  return [
    {
      label: VIEW_TITLES[head] ?? head.charAt(0).toUpperCase() + head.slice(1),
    },
  ];
}

export function AppTopbar() {
  const location = useLocation();
  const openPalette = useCommandPaletteStore((s) => s.open);
  const appearance = useThemeStore((s) => s.appearance);
  const toggleAppearance = useThemeStore((s) => s.toggleAppearance);

  const crumbs = buildCrumbs(location.pathname);

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: 44,
        padding: "0 14px 0 16px",
        borderBottom: "1px solid var(--line)",
        background: "var(--bg)",
        gap: 12,
        flexShrink: 0,
      }}
    >
      {/* ── Breadcrumbs ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
        }}
      >
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {i > 0 && (
                <span
                  className="mono"
                  style={{ color: "var(--ink-4)", fontSize: 11 }}
                >
                  /
                </span>
              )}
              <span
                className={c.mono ? "mono" : ""}
                style={{
                  fontSize: c.mono ? 11 : 13,
                  color: isLast ? "var(--ink)" : "var(--ink-3)",
                  fontWeight: isLast ? 500 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </span>
            </span>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* ── Theme toggle ── */}
      <button
        type="button"
        onClick={toggleAppearance}
        title={appearance === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 5,
          color: "var(--ink-2)",
        }}
      >
        {appearance === "dark" ? <Icon.Sun /> : <Icon.Moon />}
      </button>

      {/* ── Ask Kanon ── */}
      <button
        type="button"
        onClick={() => openPalette("ai")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 10px",
          background: "var(--ai-2)",
          color: "var(--ai)",
          border: "1px solid color-mix(in oklch, var(--ai) 30%, transparent)",
          borderRadius: 5,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        <Icon.Spark /> Ask Kanon
        <Kbd>⌘J</Kbd>
      </button>

      {/* ── Search ── */}
      <button
        type="button"
        onClick={() => openPalette("search")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 10px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 5,
          fontSize: 12,
          color: "var(--ink-2)",
        }}
      >
        <Icon.Search />
        <span style={{ color: "var(--ink-3)" }}>Search</span>
        <Kbd>⌘K</Kbd>
      </button>

      {/* ── New issue ── */}
      <button
        type="button"
        onClick={() => useCommandPaletteStore.getState().requestCreateIssue()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 28,
          padding: "0 10px",
          background: "var(--accent)",
          color: "var(--btn-ink)",
          borderRadius: 5,
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        <Icon.Plus /> New issue
      </button>
    </header>
  );
}
