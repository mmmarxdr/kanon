import { useLocation, Link } from "@tanstack/react-router";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useAuthStore } from "@/stores/auth-store";
import { useState } from "react";
import { useSyncEvents } from "@/hooks/use-sync-events";
import { SyncIndicator } from "@/components/sync-indicator";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";

// ---------------------------------------------------------------------------
// Inline SVG Icons (20x20)
// ---------------------------------------------------------------------------

function BoardIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

function BacklogIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3" y="4" width="14" height="3" rx="1" />
      <rect x="3" y="9" width="14" height="3" rx="1" />
      <rect x="3" y="14" width="14" height="3" rx="1" />
    </svg>
  );
}

function CyclesIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14.5 3.5L17 6L14.5 8.5" />
      <path d="M3 10V9a3 3 0 0 1 3-3h11" />
      <path d="M5.5 16.5L3 14l2.5-2.5" />
      <path d="M17 10v1a3 3 0 0 1-3 3H3" />
    </svg>
  );
}

function RoadmapIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 5h14" />
      <path d="M5 10h10" />
      <path d="M7 15h6" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M3.87 5.37l1.41 1.41M14.72 13.22l1.41 1.41M2.5 10h2M15.5 10h2M3.87 14.63l1.41-1.41M14.72 6.78l1.41-1.41" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M10 4L6 8L10 12" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="8" cy="5" r="3" />
      <path d="M2.5 14a5.5 5.5 0 0 1 11 0" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 14H3.5A1.5 1.5 0 0 1 2 12.5v-9A1.5 1.5 0 0 1 3.5 2H6" />
      <path d="M10.5 11.5L14 8L10.5 4.5" />
      <path d="M14 8H6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Nav items config
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If href starts with "/board", it's considered active when pathname includes /board */
  href: string;
  matchPrefix: string;
  /** Whether the item requires a project to be selected */
  requiresProject?: boolean;
}

function buildNavItems(projectKey: string): NavItem[] {
  return [
    { label: "Board", icon: BoardIcon, href: `/board/${projectKey}`, matchPrefix: "/board", requiresProject: true },
    { label: "Backlog", icon: BacklogIcon, href: `/backlog/${projectKey}`, matchPrefix: "/backlog", requiresProject: true },
    { label: "Roadmap", icon: RoadmapIcon, href: `/roadmap/${projectKey}`, matchPrefix: "/roadmap", requiresProject: true },
    { label: "Cycles", icon: CyclesIcon, href: "/cycles", matchPrefix: "/cycles" },
    { label: "Settings", icon: SettingsIcon, href: "/settings", matchPrefix: "/settings" },
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
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 px-2 py-1 text-xs font-medium text-white bg-foreground rounded shadow-lg whitespace-nowrap">
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
  const location = useLocation();

  // Workspace context: use the user's active workspace (first in list)
  const workspaceId = useActiveWorkspaceId();
  const { data: projects, isLoading: projectsLoading } = useProjectsQuery(workspaceId);
  const {
    status: syncStatus,
    lastSyncAt,
    syncHistory,
    isManualSyncing,
    triggerSync,
  } = useSyncEvents();

  // Extract projectKey from URL (e.g., /board/KAN or /backlog/KAN or /roadmap/KAN → KAN)
  const projectKey = location.pathname.match(/^\/(board|backlog|roadmap)\/([^/]+)/)?.[2] ?? "";
  const navItems = buildNavItems(projectKey);

  const displayName = user?.displayName ?? user?.email ?? "User";
  const initials = displayName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside
      className="flex flex-col h-full bg-card border-r border-border shrink-0 transition-all duration-300 ease-in-out overflow-hidden"
      style={{ width: collapsed ? 56 : 220 }}
    >
      {/* ── Logo + collapse toggle ── */}
      <div className="flex items-center justify-between px-3 h-12 shrink-0 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="text-primary text-base leading-none">&#9670;</span>
            <span className="text-sm font-bold text-foreground tracking-tight">
              Kanon
            </span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={`p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors ${collapsed ? "mx-auto" : ""}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeftIcon
            className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {/* ── Navigation ── */}
      <nav className="flex flex-col gap-0.5 px-2 mt-3">
        {navItems.map((item) => {
          const isActive = location.pathname.startsWith(item.matchPrefix);
          const Icon = item.icon;
          const hasRoute =
            item.matchPrefix === "/board" || item.matchPrefix === "/backlog" || item.matchPrefix === "/roadmap" || item.matchPrefix === "/settings";
          const isDisabled = item.requiresProject && !projectKey;

          const linkContent = (
            <div
              className={`flex items-center gap-2.5 py-2 rounded-md text-sm font-medium transition-colors ${
                collapsed ? "justify-center px-0" : "px-3"
              } ${
                isDisabled
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : isActive
                    ? "bg-primary/10 text-primary cursor-pointer"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
              }`}
            >
              <Icon className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </div>
          );

          if (hasRoute && !isDisabled) {
            return (
              <Tooltip key={item.label} label={item.label} show={collapsed}>
                <Link to={item.href}>{linkContent}</Link>
              </Tooltip>
            );
          }

          return (
            <Tooltip key={item.label} label={isDisabled ? `${item.label} (select a project first)` : item.label} show={collapsed}>
              {linkContent}
            </Tooltip>
          );
        })}
      </nav>

      {/* ── Projects section ── */}
      <div className="mt-6 px-2">
        {!collapsed && (
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium px-3 mb-1">
            Projects
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {projectsLoading && (
            <>
              <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center px-0 py-2" : "px-3 py-1.5"}`}>
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0 animate-pulse" />
                {!collapsed && <span className="h-4 w-24 rounded bg-muted-foreground/20 animate-pulse" />}
              </div>
              <div className={`flex items-center gap-2.5 ${collapsed ? "justify-center px-0 py-2" : "px-3 py-1.5"}`}>
                <span className="w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0 animate-pulse" />
                {!collapsed && <span className="h-4 w-20 rounded bg-muted-foreground/20 animate-pulse" />}
              </div>
            </>
          )}
          {!projectsLoading && projects && projects.length === 0 && !collapsed && (
            <p className="px-3 py-1.5 text-sm text-muted-foreground">No projects</p>
          )}
          {!projectsLoading && projects && projects.length > 0 && !projectKey && !collapsed && (
            <p className="px-3 py-1 text-xs text-muted-foreground italic">Select a project below</p>
          )}
          {!projectsLoading && projects && projects.map((project) => {
            const isActiveProject = projectKey === project.key;
            return (
              <Tooltip
                key={project.id}
                label={project.name}
                show={collapsed}
              >
                <Link to="/board/$projectKey" params={{ projectKey: project.key }}>
                  <div
                    className={`flex items-center gap-2.5 text-sm rounded-md cursor-pointer transition-colors ${
                      collapsed ? "justify-center px-0 py-2" : "px-3 py-1.5"
                    } ${
                      isActiveProject
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${isActiveProject ? "bg-primary" : "bg-muted-foreground/40"}`}
                    />
                    {!collapsed && <span>{project.name}</span>}
                  </div>
                </Link>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* ── Spacer ── */}
      <div className="mt-auto" />

      {/* ── User section ── */}
      <div className="border-t border-border px-2 py-3">
        <div
          className={`flex items-center gap-2.5 ${collapsed ? "justify-center" : "px-1"}`}
        >
          <div className="relative w-8 h-8 shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <div className="absolute -top-0.5 -right-0.5">
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
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {displayName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.email}
              </p>
            </div>
          )}
          {!collapsed && (
            <>
              <Tooltip label="Profile" show={false}>
                <Link to="/profile">
                  <button
                    className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Profile"
                  >
                    <UserIcon />
                  </button>
                </Link>
              </Tooltip>
              <Tooltip label="Logout" show={false}>
                <button
                  onClick={() => {
                    void logoutFn().then(() => {
                      window.location.href = "/login";
                    });
                  }}
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Logout"
                >
                  <LogoutIcon />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
