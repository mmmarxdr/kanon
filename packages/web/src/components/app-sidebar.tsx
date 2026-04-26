import { useLocation, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/stores/auth-store";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useSyncEvents } from "@/hooks/use-sync-events";
import { SyncIndicator } from "@/components/sync-indicator";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";
import { Icon, Monogram } from "@/components/ui/icons";
import { Avatar, avatarInitials } from "@/components/ui/primitives";

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  href: string;
  matchPrefix: string;
  hint?: string;
  requiresProject?: boolean;
}

function buildNavItems(projectKey: string): NavItem[] {
  return [
    { label: "Inbox",        icon: Icon.Inbox,    href: "/inbox",                       matchPrefix: "/inbox",        hint: "G I" },
    { label: "Roadmap",      icon: Icon.Road,     href: `/roadmap/${projectKey}`,       matchPrefix: "/roadmap",      hint: "G R", requiresProject: true },
    { label: "Dependencies", icon: Icon.Graph,    href: `/dependencies/${projectKey}`,  matchPrefix: "/dependencies", hint: "G D", requiresProject: true },
    { label: "Board",        icon: Icon.Board,    href: `/board/${projectKey}`,         matchPrefix: "/board",        hint: "G B", requiresProject: true },
    { label: "Cycles",       icon: Icon.Cycles,   href: projectKey ? `/cycles/${projectKey}` : "/cycles", matchPrefix: "/cycles",       hint: "G C" },
    { label: "Settings",     icon: Icon.Settings, href: "/settings",                    matchPrefix: "/settings",     hint: "G S" },
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
  const user = useAuthStore((s) => s.user);
  const logoutFn = useAuthStore((s) => s.logout);
  const openPalette = useCommandPaletteStore((s) => s.open);
  const location = useLocation();

  const workspaceId = useActiveWorkspaceId();
  const { data: projects, isLoading: projectsLoading } = useProjectsQuery(workspaceId);
  const {
    status: syncStatus,
    lastSyncAt,
    syncHistory,
    isManualSyncing,
    triggerSync,
  } = useSyncEvents();

  const projectKey =
    location.pathname.match(/^\/(board|roadmap|dependencies|cycles)\/([^/]+)/)?.[2] ?? "";
  const navItems = buildNavItems(projectKey);

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
            <span style={{ fontSize: 12, flex: 1, textAlign: "left" }}>Search or ask…</span>
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
                  <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
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
            ? `${item.label} (select a project first)`
            : item.label;

          if (isDisabled) {
            return (
              <Tooltip key={item.label} label={tipLabel} show={collapsed}>
                {linkInner}
              </Tooltip>
            );
          }
          return (
            <Tooltip key={item.label} label={tipLabel} show={collapsed}>
              <Link to={item.href}>{linkInner}</Link>
            </Tooltip>
          );
        })}
      </nav>

      {/* ── Projects ── */}
      {!collapsed && (
        <div style={{ marginTop: 14, padding: "0 14px 6px" }}>
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
              Projects
            </span>
            <button
              type="button"
              style={{ color: "var(--ink-4)" }}
              title="New project"
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
            {!collapsed && "Loading…"}
          </div>
        )}
        {!projectsLoading &&
          projects?.map((project) => {
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
            No projects
          </p>
        )}
      </div>

      <div style={{ flex: 1 }} />

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
        <div style={{ position: "relative", flexShrink: 0 }}>
          <Avatar initials={initials} name={displayName} size={22} />
          <div
            style={{
              position: "absolute",
              top: -2,
              right: -2,
            }}
          >
            <SyncIndicator
              status={syncStatus}
              lastSyncAt={lastSyncAt}
              syncHistory={syncHistory}
              isManualSyncing={isManualSyncing}
              onTriggerSync={triggerSync}
            />
          </div>
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
                title="Profile"
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
              title="Logout"
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
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <Icon.ChevR /> : <Icon.ChevL />}
        </button>
      </div>
    </aside>
  );
}
