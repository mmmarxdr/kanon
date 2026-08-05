import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AdminUsersPage } from "./admin-users-page";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("./use-admin-users", () => ({
  useAdminUsersQuery: vi.fn(),
  useAdminUserDetailQuery: vi.fn(),
  useAdminWorkspacesQuery: vi.fn(),
  useAdminWorkspaceProjectsQuery: vi.fn(),
  useVerifyAdminUserEmailMutation: vi.fn(),
  useAddAdminMembershipMutation: vi.fn(),
  usePatchAdminMembershipMutation: vi.fn(),
  useRemoveAdminMembershipMutation: vi.fn(),
  useReplaceAdminProjectsMutation: vi.fn(),
  useAdminUsersBulkMutation: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  user: {
    email: "admin@example.com",
    isInstanceAdmin: true,
    isSuperAdmin: false,
  } as {
    email: string;
    isInstanceAdmin: boolean;
    isSuperAdmin: boolean;
  } | null,
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: typeof authState.user }) => unknown) =>
    selector({ user: authState.user }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const USERS = [
  {
    id: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    emailVerified: false,
    isInstanceAdmin: false,
    createdAt: "2026-01-01T00:00:00Z",
    workspaceCount: 1,
    workspaces: [{ id: "ws1", name: "Acme" }],
  },
  {
    id: "u2",
    email: "bob@example.com",
    displayName: "Bob",
    emailVerified: true,
    isInstanceAdmin: false,
    createdAt: "2026-01-02T00:00:00Z",
    workspaceCount: 2,
    workspaces: [
      { id: "ws1", name: "Acme" },
      { id: "ws2", name: "Beta" },
    ],
  },
];

async function mockHooks(overrides?: {
  users?: typeof USERS;
  detail?: object | null;
}) {
  const hooks = await import("./use-admin-users");
  vi.mocked(hooks.useAdminUsersQuery).mockReturnValue({
    data: {
      users: overrides?.users ?? USERS,
      total: (overrides?.users ?? USERS).length,
      limit: 20,
      offset: 0,
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof hooks.useAdminUsersQuery>);

  vi.mocked(hooks.useAdminUserDetailQuery).mockReturnValue({
    data: overrides?.detail ?? null,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof hooks.useAdminUserDetailQuery>);

  vi.mocked(hooks.useAdminWorkspacesQuery).mockReturnValue({
    data: [
      { id: "ws1", name: "Acme", slug: "acme" },
      { id: "ws2", name: "Beta", slug: "beta" },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof hooks.useAdminWorkspacesQuery>);

  vi.mocked(hooks.useAdminWorkspaceProjectsQuery).mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof hooks.useAdminWorkspaceProjectsQuery>);

  const idleMutation = {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ results: [] }),
    isPending: false,
  };

  vi.mocked(hooks.useVerifyAdminUserEmailMutation).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof hooks.useVerifyAdminUserEmailMutation>,
  );
  vi.mocked(hooks.useAddAdminMembershipMutation).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof hooks.useAddAdminMembershipMutation>,
  );
  vi.mocked(hooks.usePatchAdminMembershipMutation).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof hooks.usePatchAdminMembershipMutation>,
  );
  vi.mocked(hooks.useRemoveAdminMembershipMutation).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof hooks.useRemoveAdminMembershipMutation>,
  );
  vi.mocked(hooks.useReplaceAdminProjectsMutation).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof hooks.useReplaceAdminProjectsMutation>,
  );
  vi.mocked(hooks.useAdminUsersBulkMutation).mockReturnValue(
    idleMutation as unknown as ReturnType<typeof hooks.useAdminUsersBulkMutation>,
  );
}

describe("AdminUsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = {
      email: "admin@example.com",
      isInstanceAdmin: true,
      isSuperAdmin: false,
    };
  });

  it("redirects non-instance-admins home", async () => {
    authState.user = {
      email: "plain@example.com",
      isInstanceAdmin: false,
      isSuperAdmin: false,
    };
    await mockHooks();
    render(<AdminUsersPage />, { wrapper: createWrapper() });
    expect(screen.getByTestId("admin-users-forbidden")).toBeTruthy();
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("renders searchable user list with workspace names", async () => {
    await mockHooks();
    render(<AdminUsersPage />, { wrapper: createWrapper() });

    expect(screen.getByTestId("admin-users-page")).toBeTruthy();
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByTestId("admin-users-select-all")).toBeTruthy();
  });

  it("shows remove panel with shared workspace picker after selecting users", async () => {
    await mockHooks();
    render(<AdminUsersPage />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole("checkbox", { name: "alice@example.com" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "bob@example.com" }));

    expect(screen.getByTestId("admin-users-bulk-bar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("bulk-remove-btn"));

    expect(screen.getByTestId("bulk-remove-panel")).toBeTruthy();
    const select = screen.getByTestId("bulk-workspace-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    // Intersection of alice+bob is only Acme
    expect([...select.options].map((o) => o.text)).toEqual([
      "Select a workspace…",
      "Acme",
    ]);

    fireEvent.change(select, { target: { value: "ws1" } });
    expect(screen.getByTestId("bulk-remove-summary").textContent).toMatch(/Acme/);
  });

  it("opens detail panel when clicking a user email", async () => {
    await mockHooks({
      detail: {
        id: "u1",
        email: "alice@example.com",
        displayName: "Alice",
        avatarUrl: null,
        emailVerified: false,
        emailVerifiedAt: null,
        isInstanceAdmin: false,
        isSuperAdmin: false,
        createdAt: "2026-01-01T00:00:00Z",
        memberships: [],
      },
    });
    render(<AdminUsersPage />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByText("alice@example.com"));

    await waitFor(() => {
      expect(screen.getByTestId("admin-user-detail")).toBeTruthy();
      expect(screen.getByTestId("verify-email-btn")).toBeTruthy();
    });
  });
});
