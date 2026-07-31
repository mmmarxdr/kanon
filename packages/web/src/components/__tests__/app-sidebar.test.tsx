/**
 * AppSidebar — component tests (KAN-49 / PR2 + soft-collapse)
 *
 * Tests:
 *  (a) sidebar + button click opens create-project modal
 *  (b) isSuperAdmin:true → "Admin" nav entry visible linking to /admin/instance
 *  (c1) isInstanceAdmin:true, isSuperAdmin:false → workspace-create visible; invite-admin NOT visible
 *  (c2) isSuperAdmin:true (+ isInstanceAdmin:true) → invite-admin link visible
 *  (d) both flags false → no admin nav, no workspace-create, no invite-admin
 *  (e) isSuperAdmin:false but isInstanceAdmin:true → admin nav NOT shown, workspace-create shown
 *  Soft-collapse: Show all / Show less, active pin, footer with many projects
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppSidebar } from "../app-sidebar";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockUser,
  mockCollapsed,
  mockProjectsExpanded,
  mockToggleProjectsExpanded,
  mockLocation,
  mockProjects,
} = vi.hoisted(() => ({
  mockUser: { value: null as null | Record<string, unknown> },
  mockCollapsed: { value: false },
  mockProjectsExpanded: { value: false },
  mockToggleProjectsExpanded: { fn: vi.fn() },
  mockLocation: { value: { pathname: "/" } },
  mockProjects: { value: [] as unknown[] },
}));

// ─── router mock ──────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useLocation: () => mockLocation.value,
    Link: ({
      to,
      children,
      params,
    }: {
      to: string;
      children: React.ReactNode;
      params?: Record<string, string>;
    }) => (
      <a
        href={params?.projectKey ? `${to}/${params.projectKey}` : to}
        data-testid={`link-${to}`}
      >
        {children}
      </a>
    ),
  };
});

// ─── store mocks ──────────────────────────────────────────────────────────────

vi.mock("@/stores/sidebar-store", () => ({
  useSidebarStore: (
    selector: (s: {
      collapsed: boolean;
      toggleSidebar: () => void;
      projectsExpanded: boolean;
      toggleProjectsExpanded: () => void;
    }) => unknown,
  ) =>
    selector({
      collapsed: mockCollapsed.value,
      toggleSidebar: vi.fn(),
      projectsExpanded: mockProjectsExpanded.value,
      toggleProjectsExpanded: mockToggleProjectsExpanded.fn,
    }),
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

vi.mock("@/components/ui/icons", () => ({
  Icon: {
    Inbox: () => <span>Inbox</span>,
    Road: () => <span>Road</span>,
    Graph: () => <span>Graph</span>,
    Board: () => <span>Board</span>,
    Timeline: () => <span>Timeline</span>,
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

function makeProjects(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const num = String(i + 1).padStart(2, "0");
    return {
      id: `id-${num}`,
      key: `P${num}`,
      name: `Project ${num}`,
    };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AppSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollapsed.value = false;
    mockProjectsExpanded.value = false;
    mockToggleProjectsExpanded.fn = vi.fn();
    mockLocation.value = { pathname: "/" };
    mockProjects.value = [];
    mockUser.value = makeUser();
  });

  // ── (a) + button opens create-project modal ────────────────────────────────

  it("(a) clicking the + button opens the create-project modal", () => {
    mockUser.value = makeUser({ isInstanceAdmin: true });
    render(<AppSidebar />);

    const plusBtn = screen.getByTitle("New project");
    fireEvent.click(plusBtn);

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

  // ── Soft-collapse ─────────────────────────────────────────────────────────

  it("18 projects collapsed → Show all (18) and at most 8 project names", () => {
    mockProjects.value = makeProjects(18);
    mockProjectsExpanded.value = false;
    render(<AppSidebar />);

    expect(screen.getByRole("button", { name: "Show all (18)" })).toBeTruthy();
    expect(screen.getAllByTestId("project-name")).toHaveLength(8);
  });

  it("clicking Show all calls toggleProjectsExpanded", () => {
    mockProjects.value = makeProjects(18);
    mockProjectsExpanded.value = false;
    render(<AppSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Show all (18)" }));
    expect(mockToggleProjectsExpanded.fn).toHaveBeenCalledTimes(1);
  });

  it("expanded preference shows all projects and Show less", () => {
    mockProjects.value = makeProjects(18);
    mockProjectsExpanded.value = true;
    render(<AppSidebar />);

    expect(screen.getByRole("button", { name: "Show less" })).toBeTruthy();
    expect(screen.getAllByTestId("project-name")).toHaveLength(18);
  });

  it("active project is among visible rows when soft-collapsed", () => {
    mockProjects.value = makeProjects(18);
    mockProjectsExpanded.value = false;
    mockLocation.value = { pathname: "/board/P18" };
    render(<AppSidebar />);

    const names = screen.getAllByTestId("project-name").map((el) => el.textContent);
    expect(names).toContain("Project 18");
    expect(names).toHaveLength(8);
  });

  it("≤8 projects → no Show all / Show less", () => {
    mockProjects.value = makeProjects(5);
    render(<AppSidebar />);

    expect(screen.queryByTestId("projects-soft-toggle")).toBeNull();
    expect(screen.getAllByTestId("project-name")).toHaveLength(5);
  });

  it("18 projects + admin flags → Admin, New workspace, Logout still present", () => {
    mockProjects.value = makeProjects(18);
    mockProjectsExpanded.value = false;
    mockUser.value = makeUser({ isSuperAdmin: true, isInstanceAdmin: true });
    render(<AppSidebar />);

    expect(screen.getByTestId("admin-nav-link")).toBeTruthy();
    expect(screen.getByTestId("workspace-create-link")).toBeTruthy();
    expect(screen.getByTitle("Logout")).toBeTruthy();
  });

  it("collapsed rail hides soft-collapse controls", () => {
    mockProjects.value = makeProjects(18);
    mockCollapsed.value = true;
    mockProjectsExpanded.value = false;
    render(<AppSidebar />);

    expect(screen.queryByTestId("projects-soft-toggle")).toBeNull();
    expect(screen.queryByTestId("project-name")).toBeNull();
  });
});
