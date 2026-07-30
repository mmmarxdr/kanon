import { useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useThemeStore } from "@/stores/theme-store";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";
import { LanguageSwitcher } from "@/components/language-switcher";

const VIEW_TITLE_KEYS: Record<string, string> = {
  inbox: "inbox",
  board: "board",
  roadmap: "roadmap",
  dependencies: "dependencies",
  issue: "issue",
  cycles: "cycles",
  schedule: "schedule",
  settings: "settings",
  workspaces: "workspaces",
  "project-select": "projectSelect",
  profile: "profile",
};

interface Crumb {
  label: string;
  mono?: boolean;
}

function buildCrumbs(
  pathname: string,
  tNav: (key: string) => string,
): Crumb[] {
  const m = pathname.match(/^\/(board|roadmap|dependencies|cycles|schedule)\/([^/]+)/);
  if (m && m[1] && m[2]) {
    const view = m[1];
    const projectKey = m[2];
    const titleKey = VIEW_TITLE_KEYS[view];
    return [
      { label: projectKey, mono: true },
      { label: titleKey ? tNav(titleKey) : view },
    ];
  }
  const segments = pathname.split("/").filter(Boolean);
  const head = segments[0];
  if (!head) return [{ label: tNav("inbox") }];
  const titleKey = VIEW_TITLE_KEYS[head];
  return [
    {
      label: titleKey
        ? tNav(titleKey)
        : head.charAt(0).toUpperCase() + head.slice(1),
    },
  ];
}

export function AppTopbar() {
  const location = useLocation();
  const openPalette = useCommandPaletteStore((s) => s.open);
  const appearance = useThemeStore((s) => s.appearance);
  const toggleAppearance = useThemeStore((s) => s.toggleAppearance);
  const { t } = useTranslation("common");
  const { t: tNav } = useTranslation("nav");

  const crumbs = buildCrumbs(location.pathname, tNav);

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

      {/* ── Language switcher (left of theme) ── */}
      <LanguageSwitcher />

      {/* ── Theme toggle ── */}
      <button
        type="button"
        onClick={toggleAppearance}
        title={appearance === "dark" ? t("theme.toLight") : t("theme.toDark")}
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
        <span style={{ color: "var(--ink-3)" }}>{t("actions.search")}</span>
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
        <Icon.Plus /> {t("actions.newIssue")}
      </button>
    </header>
  );
}
