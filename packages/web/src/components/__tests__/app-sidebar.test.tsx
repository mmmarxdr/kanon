/**
 * AppSidebar — component tests (KAN-49 / PR2 tasks 2.3, 2.7, 2.8)
 *
 * Tests:
 *  (a) sidebar + button click opens create-project modal
 *  (b) isSuperAdmin:true → "Admin" nav entry visible linking to /admin/instance
 *  (c1) isInstanceAdmin:true, isSuperAdmin:false → workspace-create visible; invite-admin NOT visible
 *  (c2) isSuperAdmin:true (+ isInstanceAdmin:true) → invite-admin link visible
 *  (d) both flags false → no admin nav, no workspace-create, no invite-admin
 *  (e) isSuperAdmin:false but isInstanceAdmin:true → admin nav NOT shown, workspace-create shown
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppSidebar } from "../app-sidebar";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockUser,
  mockCollapsed,
  mockLocation,
  mockProjects,
} = vi.hoisted(() => ({
  mockUser: { value: null as null | Record<string, unknown> },
  mockCollapsed: { value: false },
  mockLocation: { value: { pathname: "/" } },
  mockProjects: { value: [] as unknown[] },
}));

// ─── router mock ──────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useLocation: () => mockLocation.value,
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to} data-testid={`link-${to}`}>{children}</a>
    ),
  };
});

// ─── store mocks ──────────────────────────────────────────────────────────────

vi.mock("@/stores/sidebar-store", () => ({
  useSidebarStore: (selector: (s: { collapsed: boolean; toggleSidebar: () => void }) => unknown) =>
    selector({ collapsed: mockCollapsed.value, toggleSidebar: vi.fn() }),
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: unknown; logout: () => Promise<void> }) => unknown) =>
    selector({
      user: mockUser.value,
      logout: vi.fn().mockResolvedValue(undefined),
    }),
}));

vi.mock("@/stores/command-palette-store", () => ({
  useCommandPaletteStore: (selector: (s: { open: () => void }) => unknown) =>
    selector({ open: vi.fn() }),
}));

// ─── hook mocks ───────────────────────────────────────────────────────────────

vi.mock("@/hooks/use-sync-events", () => ({
  useSyncEvents: () => ({
    status: "idle",
    lastSyncAt: null,
    syncHistory: [],
    isManualSyncing: false,
    triggerSync: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-projects-query", () => ({
  useProjectsQuery: () => ({
    data: mockProjects.value,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: () => "ws-1",
}));

// ─── component mocks ──────────────────────────────────────────────────────────

vi.mock("@/components/sync-indicator", () => ({
  SyncIndicator: () => <span data-testid="sync-indicator" />,
}));

vi.mock("@/components/ui/icons", () => ({
  Icon: {
    Inbox: () => <span>Inbox</span>,
    Road: () => <span>Road</span>,
    Graph: () => <span>Graph</span>,
    Board: () => <span>Board</span>,
    Cycles: () => <span>Cycles</span>,
    Settings: () => <span>Settings</span>,
    Search: () => <span>Search</span>,
    Plus: () => <span data-testid="icon-plus">+</span>,
    ChevR: () => <span>›</span>,
    ChevL: () => <span>‹</span>,
    User: () => <span>User</span>,
    Logout: () => <span>Logout</span>,
    X: () => <span>X</span>,
    Admin: () => <span>Admin</span>,
  },
  Monogram: () => <span data-testid="monogram">K</span>,
  Avatar: ({ initials }: { initials: string }) => <span>{initials}</span>,
  avatarInitials: (name: string) => name[0] ?? "U",
}));

vi.mock("@/components/ui/primitives", () => ({
  Avatar: ({ initials }: { initials: string }) => <span data-testid="avatar">{initials}</span>,
  avatarInitials: (name: string) => name[0] ?? "U",
}));

vi.mock("@/features/projects/create-project-modal", () => ({
  CreateProjectModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="create-project-modal">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeUser(flags: { isSuperAdmin?: boolean; isInstanceAdmin?: boolean } = {}) {
  return {
    id: "u1",
    email: "admin@kanon.io",
    displayName: "Admin",
    avatarUrl: null,
    emailVerified: true,
    isSuperAdmin: flags.isSuperAdmin ?? false,
    isInstanceAdmin: flags.isInstanceAdmin ?? false,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollapsed.value = false;
    mockLocation.value = { pathname: "/" };
    mockProjects.value = [];
    mockUser.value = makeUser();
  });

  // ── (a) + button opens create-project modal ────────────────────────────────

  it("(a) clicking the + button opens the create-project modal", () => {
    mockUser.value = makeUser({ isInstanceAdmin: true });
    render(<AppSidebar />);

    // The + button should be in the sidebar
    const plusBtn = screen.getByTitle("New project");
    fireEvent.click(plusBtn);

    // Modal should appear
    expect(screen.getByTestId("create-project-modal")).toBeTruthy();
  });

  // ── (b) isSuperAdmin:true → Admin nav entry ────────────────────────────────

  it("(b) isSuperAdmin:true → Admin nav entry visible", () => {
    mockUser.value = makeUser({ isSuperAdmin: true });
    render(<AppSidebar />);

    expect(screen.getByTestId("admin-nav-link")).toBeTruthy();
  });

  // ── (c1) isInstanceAdmin:true, isSuperAdmin:false → workspace-create visible; invite-admin NOT ─

  it("(c1) isInstanceAdmin:true, isSuperAdmin:false → workspace-create visible, invite-admin NOT visible", () => {
    mockUser.value = makeUser({ isInstanceAdmin: true, isSuperAdmin: false });
    render(<AppSidebar />);

    expect(screen.getByTestId("workspace-create-link")).toBeTruthy();
    expect(screen.queryByTestId("invite-admin-link")).toBeNull();
  });

  // ── (c2) isSuperAdmin:true → invite-admin link visible ────────────────────

  it("(c2) isSuperAdmin:true (with isInstanceAdmin:true) → invite-admin link visible", () => {
    mockUser.value = makeUser({ isSuperAdmin: true, isInstanceAdmin: true });
    render(<AppSidebar />);

    expect(screen.getByTestId("invite-admin-link")).toBeTruthy();
  });

  // ── (d) both false → none rendered ────────────────────────────────────────

  it("(d) both flags false → no admin nav, no workspace-create, no invite-admin", () => {
    mockUser.value = makeUser({ isSuperAdmin: false, isInstanceAdmin: false });
    render(<AppSidebar />);

    expect(screen.queryByTestId("admin-nav-link")).toBeNull();
    expect(screen.queryByTestId("workspace-create-link")).toBeNull();
    expect(screen.queryByTestId("invite-admin-link")).toBeNull();
  });

  // ── (e) only isInstanceAdmin → no admin nav, no invite-admin ──────────────

  it("(e) isInstanceAdmin:true but isSuperAdmin:false → admin nav NOT shown, invite-admin NOT shown", () => {
    mockUser.value = makeUser({ isInstanceAdmin: true, isSuperAdmin: false });
    render(<AppSidebar />);

    expect(screen.queryByTestId("admin-nav-link")).toBeNull();
    expect(screen.getByTestId("workspace-create-link")).toBeTruthy();
    expect(screen.queryByTestId("invite-admin-link")).toBeNull();
  });
});
