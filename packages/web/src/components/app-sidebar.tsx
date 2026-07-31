import { useLocation, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/stores/auth-store";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";
import { Icon, Monogram } from "@/components/ui/icons";
import { Avatar, avatarInitials } from "@/components/ui/primitives";
import { CreateProjectModal } from "@/features/projects/create-project-modal";
import {
  PROJECTS_SOFT_LIMIT,
  selectVisibleProjects,
} from "@/lib/select-visible-projects";

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

interface NavItem {
  labelKey: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  href: string;
  matchPrefix: string;
  hint?: string;
  requiresProject?: boolean;
}

function buildNavItems(projectKey: string): NavItem[] {
  return [
    { labelKey: "inbox",        icon: Icon.Inbox,    href: "/inbox",                       matchPrefix: "/inbox",        hint: "G I" },
    { labelKey: "roadmap",      icon: Icon.Road,     href: `/roadmap/${projectKey}`,       matchPrefix: "/roadmap",      hint: "G R", requiresProject: true },
    { labelKey: "dependencies", icon: Icon.Graph,    href: `/dependencies/${projectKey}`,  matchPrefix: "/dependencies", hint: "G D", requiresProject: true },
    { labelKey: "board",        icon: Icon.Board,    href: `/board/${projectKey}`,         matchPrefix: "/board",        hint: "G B", requiresProject: true },
    { labelKey: "cycles",       icon: Icon.Cycles,   href: projectKey ? `/cycles/${projectKey}` : "/cycles", matchPrefix: "/cycles",       hint: "G C" },
    { labelKey: "schedule",     icon: Icon.Timeline, href: `/schedule/${projectKey}`,      matchPrefix: "/schedule",     hint: "G T", requiresProject: true },
    { labelKey: "settings",     icon: Icon.Settings, href: "/settings",                    matchPrefix: "/settings",     hint: "G S" },
  ];
}

// ---------------------------------------------------------------------------
// Tooltip wrapper for collapsed mode
// ---------------------------------------------------------------------------

function Tooltip({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  if (!show) return <>{children}</>;
  return (
    <div
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          className="mono"
          style={{
            position: "absolute",
            left: "calc(100% + 8px)",
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 50,
            padding: "4px 8px",
            fontSize: 11,
            color: "var(--ink)",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppSidebar
// ---------------------------------------------------------------------------

export function AppSidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar);
  const projectsExpanded = useSidebarStore((s) => s.projectsExpanded);
  const toggleProjectsExpanded = useSidebarStore((s) => s.toggleProjectsExpanded);
  const user = useAuthStore((s) => s.user);
  const logoutFn = useAuthStore((s) => s.logout);
  const openPalette = useCommandPaletteStore((s) => s.open);
  const location = useLocation();
  const [showCreateProject, setShowCreateProject] = useState(false);
  const { t } = useTranslation("nav");
  const { t: tCommon } = useTranslation("common");

  const workspaceId = useActiveWorkspaceId();
  const { data: projects, isLoading: projectsLoading } = useProjectsQuery(workspaceId);
  const projectKey =
    location.pathname.match(/^\/(board|roadmap|dependencies|cycles|project-settings|schedule)\/([^/]+)/)?.[2] ?? "";
  const navItems = buildNavItems(projectKey);

  const soft = selectVisibleProjects({
    projects: projects ?? [],
    activeKey: projectKey,
    expanded: collapsed ? true : projectsExpanded,
  });
  const showSoftToggle = !collapsed && soft.total > PROJECTS_SOFT_LIMIT;

  const displayName = user?.displayName ?? user?.email ?? "User";
  const email = user?.email ?? "";
  const initials = avatarInitials(displayName, "U");

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: collapsed ? 56 : 232,
        flexShrink: 0,
        background: "var(--bg-2)",
        borderRight: "1px solid var(--line)",
        overflow: "hidden",
        transition: "width 200ms ease-in-out",
      }}
    >
      {/* ── ChromeTop (sticky) ── */}
      <div style={{ flexShrink: 0 }}>
        {/* ── Workspace header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 44,
            padding: collapsed ? "10px 0" : "10px 12px",
            justifyContent: collapsed ? "center" : "space-between",
            borderBottom: "1px solid var(--line)",
          }}
        >
          {!collapsed ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Monogram size={20} />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  lineHeight: 1.1,
                  minWidth: 0,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
                  Kanon
                </span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                  workspace
                </span>
              </div>
            </div>
          ) : (
            <Monogram size={20} />
          )}
        </div>

        {/* ── Search trigger ── */}
        <button
          type="button"
          onClick={() => openPalette("search")}
          style={{
            margin: collapsed ? "10px auto 6px" : "10px 10px 6px",
            height: 30,
            padding: collapsed ? 0 : "0 8px",
            width: collapsed ? 30 : "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: 5,
            color: "var(--ink-3)",
            justifyContent: collapsed ? "center" : "flex-start",
          }}
        >
          <Icon.Search />
          {!collapsed && (
            <>
              <span style={{ fontSize: 12, flex: 1, textAlign: "left" }}>{t("searchOrAsk")}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>⌘K</span>
            </>
          )}
        </button>

        {/* ── Nav ── */}
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "6px 8px",
            gap: 1,
          }}
        >
          {navItems.map((item) => {
            const Icn = item.icon;
            const label = t(item.labelKey);
            const isActive = location.pathname.startsWith(item.matchPrefix);
            const isDisabled = item.requiresProject && !projectKey;

            const linkInner = (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: 28,
                  padding: collapsed ? 0 : "0 8px",
                  justifyContent: collapsed ? "center" : "flex-start",
                  background: isActive ? "var(--bg-3)" : "transparent",
                  color: isDisabled
                    ? "color-mix(in oklch, var(--ink-4) 60%, transparent)"
                    : isActive
                      ? "var(--ink)"
                      : "var(--ink-2)",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: isActive ? 500 : 400,
                  position: "relative",
                  cursor: isDisabled ? "not-allowed" : "pointer",
                }}
                onMouseEnter={(e) => {
                  if (isActive || isDisabled) return;
                  e.currentTarget.style.background = "var(--bg-3)";
                }}
                onMouseLeave={(e) => {
                  if (isActive || isDisabled) return;
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {isActive && !collapsed && (
                  <span
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 6,
                      bottom: 6,
                      width: 2,
                      background: "var(--accent)",
                      borderRadius: 1,
                    }}
                  />
                )}
                <Icn
                  style={{
                    flexShrink: 0,
                    color: isActive ? "var(--accent)" : "var(--ink-3)",
                  }}
                />
                {!collapsed && (
                  <>
                    <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
                    {item.hint && (
                      <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
                        {item.hint}
                      </span>
                    )}
                  </>
                )}
              </div>
            );

            const tipLabel = isDisabled
              ? t("selectProjectFirst", { label })
              : label;

            if (isDisabled) {
              return (
                <Tooltip key={item.labelKey} label={tipLabel} show={collapsed}>
                  {linkInner}
                </Tooltip>
              );
            }
            return (
              <Tooltip key={item.labelKey} label={tipLabel} show={collapsed}>
                <Link to={item.href}>{linkInner}</Link>
              </Tooltip>
            );
          })}
        </nav>
      </div>

      {/* ── Projects region (scrollable middle) ── */}
      <div
        aria-label={t("projects")}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {!collapsed && (
          <div style={{ marginTop: 14, padding: "0 14px 6px", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--ink-4)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {t("projects")}
              </span>
              <button
                type="button"
                style={{ color: "var(--ink-4)" }}
                title={t("createProject")}
                onClick={() => setShowCreateProject(true)}
              >
                <Icon.Plus />
              </button>
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "0 8px",
            gap: 1,
          }}
        >
          {projectsLoading && (
            <div
              style={{
                padding: collapsed ? "8px 0" : "8px 12px",
                color: "var(--ink-4)",
                fontSize: 11,
              }}
            >
              {!collapsed && tCommon("actions.loading")}
            </div>
          )}
          {!projectsLoading &&
            soft.visible.map((project) => {
              const active = projectKey === project.key;
              const accent = "var(--accent)";
              const inner = (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: 26,
                    padding: collapsed ? 0 : "0 8px",
                    justifyContent: collapsed ? "center" : "flex-start",
                    background: active ? "var(--bg-3)" : "transparent",
                    color: active ? "var(--ink)" : "var(--ink-2)",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (active) return;
                    e.currentTarget.style.background = "var(--bg-3)";
                  }}
                  onMouseLeave={(e) => {
                    if (active) return;
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      background: active
                        ? accent
                        : `color-mix(in oklch, ${accent} 22%, transparent)`,
                      color: active ? "var(--btn-ink)" : accent,
                      fontSize: 9,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {project.key.slice(0, 1)}
                  </span>
                  {!collapsed && (
                    <>
                      <span
                        data-testid="project-name"
                        style={{
                          flex: 1,
                          textAlign: "left",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {project.name}
                      </span>
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: "var(--ink-4)" }}
                      >
                        {project.key}
                      </span>
                    </>
                  )}
                </div>
              );
              return (
                <Tooltip
                  key={project.id}
                  label={`${project.name} · ${project.key}`}
                  show={collapsed}
                >
                  <Link to="/board/$projectKey" params={{ projectKey: project.key }}>
                    {inner}
                  </Link>
                </Tooltip>
              );
            })}
          {!projectsLoading && projects && projects.length === 0 && !collapsed && (
            <p
              style={{
                padding: "6px 12px",
                fontSize: 11,
                color: "var(--ink-4)",
                fontStyle: "italic",
              }}
            >
              {t("noProjects")}
            </p>
          )}
          {showSoftToggle && (
            <button
              type="button"
              data-testid="projects-soft-toggle"
              aria-expanded={projectsExpanded}
              onClick={toggleProjectsExpanded}
              style={{
                marginTop: 4,
                padding: "4px 8px",
                fontSize: 11,
                color: "var(--ink-4)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--ink-3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--ink-4)";
              }}
            >
              {projectsExpanded
                ? t("showLessProjects")
                : t("showAllProjects", { count: soft.total })}
            </button>
          )}
        </div>
      </div>

      {/* ── ChromeBottom (sticky) ── */}
      <div style={{ flexShrink: 0 }}>
        {/* ── Admin affordances (conditional on /me flags) ── */}
        {!collapsed && (user?.isSuperAdmin || user?.isInstanceAdmin) && (
          <div
            style={{
              borderTop: "1px solid var(--line)",
              padding: "8px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {user.isSuperAdmin && (
              <Link to="/admin/instance">
                <div
                  data-testid="admin-nav-link"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "var(--ink-3)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon.Settings style={{ color: "var(--ink-4)" }} />
                  <span>{t("admin")}</span>
                </div>
              </Link>
            )}
            {user.isInstanceAdmin && (
              <Link to="/workspaces">
                <div
                  data-testid="workspace-create-link"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "var(--ink-3)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon.Plus style={{ color: "var(--ink-4)" }} />
                  <span>{t("newWorkspace")}</span>
                </div>
              </Link>
            )}
            {user.isSuperAdmin && (
              <Link to="/admin/instance">
                <div
                  data-testid="invite-admin-link"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 26,
                    padding: "0 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "var(--ink-3)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon.User style={{ color: "var(--ink-4)" }} />
                  <span>{t("inviteAdmin")}</span>
                </div>
              </Link>
            )}
          </div>
        )}

        {/* ── User ── */}
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: collapsed ? "8px 0" : "8px 10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            justifyContent: collapsed ? "center" : "flex-start",
            position: "relative",
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <Avatar initials={initials} name={displayName} size={22} />
          </div>
          {!collapsed && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                lineHeight: 1.15,
                minWidth: 0,
                flex: 1,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayName}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--ink-4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {email}
              </span>
            </div>
          )}
          {!collapsed && (
            <>
              <Link to="/profile">
                <button
                  type="button"
                  style={{ color: "var(--ink-4)", padding: 4 }}
                  title={t("profile")}
                >
                  <Icon.User />
                </button>
              </Link>
              <button
                type="button"
                onClick={() => {
                  void logoutFn().then(() => {
                    window.location.href = "/login";
                  });
                }}
                style={{ color: "var(--ink-4)", padding: 4 }}
                title={t("logout")}
              >
                <Icon.Logout />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            style={{
              color: "var(--ink-4)",
              padding: 4,
              position: collapsed ? "absolute" : "static",
              bottom: collapsed ? 8 : undefined,
              right: collapsed ? 14 : undefined,
              left: collapsed ? 14 : undefined,
              margin: collapsed ? "auto" : undefined,
            }}
            title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          >
            {collapsed ? <Icon.ChevR /> : <Icon.ChevL />}
          </button>
        </div>
      </div>

      {showCreateProject && workspaceId && (
        <CreateProjectModal
          workspaceId={workspaceId}
          onClose={() => setShowCreateProject(false)}
        />
      )}
    </aside>
  );
}
