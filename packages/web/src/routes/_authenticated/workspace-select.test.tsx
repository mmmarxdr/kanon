/**
 * workspace-select.tsx — create-workspace form tests (KAN-31).
 *
 * Scenarios covered:
 *   WS-1: Empty-state renders create form (not the dead-end message)
 *   WS-2: Submitting creates a workspace and navigates to the new workspace's projects
 *   WS-3: Slug auto-derives from name as the user types
 *   WS-4: 409 DUPLICATE_SLUG surfaces an inline error (not a toast, inline)
 *   WS-5: "+ New workspace" affordance is visible when user has ≥1 workspace
 *   WS-6: "+ New workspace" button opens the create form
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// --- Router mock -----------------------------------------------------------
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createRoute: actual.createRoute,
    useNavigate: () => mockNavigate,
  };
});

// --- API client mock -------------------------------------------------------
vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { fetchApi: vi.fn(), ApiError };
});

// --- Toast store mock ------------------------------------------------------
vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: vi.fn(() => ({ addToast: vi.fn() })),
  },
}));

// --- Auth store mock -------------------------------------------------------
// Mutable so individual tests can toggle isInstanceAdmin (create is admin-gated).
const authState = vi.hoisted(() => ({
  user: { email: "test@example.com", isInstanceAdmin: true } as
    | { email: string; isInstanceAdmin: boolean }
    | null,
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: typeof authState.user }) => unknown) =>
      selector({ user: authState.user }),
    { getState: vi.fn(() => ({ logout: vi.fn() })) },
  ),
}));

// --- Icons mock ------------------------------------------------------------
vi.mock("@/components/ui/icons", () => ({
  Monogram: () => null,
}));

import { WorkspaceSelectPage } from "./workspace-select";
import { fetchApi, ApiError } from "@/lib/api-client";

const WORKSPACE_1 = {
  id: "ws-1",
  name: "Alpha",
  slug: "alpha",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

const WORKSPACE_2 = {
  id: "ws-2",
  name: "Beta",
  slug: "beta",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

const NEW_WORKSPACE = {
  id: "ws-new",
  name: "New One",
  slug: "new-one",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

function createWrapper(initialWorkspaces: typeof WORKSPACE_1[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Prevent background refetch from re-running the queryFn after
        // we pre-seed the cache — otherwise fetchApi gets called for GET
        // /api/workspaces and pollutes the call log.
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
  // Pre-seed cache so the component renders the workspace list immediately
  // without making a real GET /api/workspaces call.
  queryClient.setQueryData(["workspaces", "list"], initialWorkspaces);

  // Default fetchApi mock: return empty projects array for any project-list
  // call triggered by the auto-redirect useEffect (length===1 case).
  // Individual tests override this for the mutation call.
  vi.mocked(fetchApi).mockResolvedValue([] as unknown as never);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("WorkspaceSelectPage — create-workspace flow", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    vi.mocked(fetchApi).mockReset();
    // Default to instance-admin — the create-workspace flow is admin-gated.
    authState.user = { email: "test@example.com", isInstanceAdmin: true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // WS-1: Empty state renders the create form, not a dead-end message
  // -------------------------------------------------------------------------
  it("WS-1: renders create form when user has no workspaces", async () => {
    const { wrapper } = createWrapper([]);
    render(<WorkspaceSelectPage />, { wrapper });

    // Must NOT show the old dead-end message
    expect(
      screen.queryByText(/you may need to be invited/i),
    ).not.toBeInTheDocument();

    // Must show create form with Name field and Slug field
    expect(
      screen.getByRole("textbox", { name: /workspace name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /slug/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create workspace/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // WS-2: Submit creates workspace and navigates to /workspaces/:id/projects
  // -------------------------------------------------------------------------
  it("WS-2: submitting the form creates a workspace and navigates to its projects", async () => {
    const { wrapper } = createWrapper([]);
    // Override after createWrapper (which sets the default [] mock)
    vi.mocked(fetchApi).mockResolvedValue(NEW_WORKSPACE);
    render(<WorkspaceSelectPage />, { wrapper });

    const nameInput = screen.getByRole("textbox", { name: /workspace name/i });
    const submitBtn = screen.getByRole("button", { name: /create workspace/i });

    await act(async () => {
      await userEvent.type(nameInput, "New One");
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(vi.mocked(fetchApi)).toHaveBeenCalledWith(
        "/api/workspaces",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/workspaces/$workspaceId/projects",
        params: { workspaceId: NEW_WORKSPACE.id },
      });
    });
  });

  // -------------------------------------------------------------------------
  // WS-3: Slug auto-derives from name
  // -------------------------------------------------------------------------
  it("WS-3: slug field auto-derives from name as the user types", async () => {
    const { wrapper } = createWrapper([]);
    render(<WorkspaceSelectPage />, { wrapper });

    const nameInput = screen.getByRole("textbox", { name: /workspace name/i });
    const slugInput = screen.getByRole("textbox", { name: /slug/i });

    await act(async () => {
      await userEvent.type(nameInput, "My Team");
    });

    expect((slugInput as HTMLInputElement).value).toBe("my-team");
  });

  // -------------------------------------------------------------------------
  // WS-4: 409 DUPLICATE_SLUG renders inline error
  // -------------------------------------------------------------------------
  it("WS-4: 409 DUPLICATE_SLUG surfaces inline error asking to change slug", async () => {
    const { wrapper } = createWrapper([]);

    const { ApiError: ApiErrorClass } = await import("@/lib/api-client");
    vi.mocked(fetchApi).mockRejectedValue(
      new ApiErrorClass(409, "DUPLICATE_SLUG", "Slug already taken"),
    );
    render(<WorkspaceSelectPage />, { wrapper });

    const nameInput = screen.getByRole("textbox", { name: /workspace name/i });
    const submitBtn = screen.getByRole("button", { name: /create workspace/i });

    await act(async () => {
      await userEvent.type(nameInput, "Alpha");
    });

    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/slug.*already taken|already in use|change.*slug/i),
      ).toBeInTheDocument();
    });

    // Must NOT navigate on 409
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // WS-5: "+ New workspace" button is visible when user has ≥1 workspace
  // (instance-admin with exactly 1 workspace stays on picker to create more)
  // -------------------------------------------------------------------------
  it("WS-5: shows '+ New workspace' affordance when instance-admin has one or more workspaces", () => {
    const { wrapper } = createWrapper([WORKSPACE_1, WORKSPACE_2]);
    render(<WorkspaceSelectPage />, { wrapper });

    expect(
      screen.getByRole("button", { name: /new workspace/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // WS-6: Clicking "+ New workspace" opens the create form
  // -------------------------------------------------------------------------
  it("WS-6: clicking '+ New workspace' reveals the create form", async () => {
    const { wrapper } = createWrapper([WORKSPACE_1, WORKSPACE_2]);
    render(<WorkspaceSelectPage />, { wrapper });

    // Form should not be visible initially
    expect(
      screen.queryByRole("textbox", { name: /workspace name/i }),
    ).not.toBeInTheDocument();

    const newBtn = screen.getByRole("button", { name: /new workspace/i });
    await act(async () => {
      fireEvent.click(newBtn);
    });

    expect(
      screen.getByRole("textbox", { name: /workspace name/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // WS-7: Non-admin with no workspaces sees an invite message, NOT a create
  // form that would 403 (workspace creation is instance-admin-only, KAN-49).
  // -------------------------------------------------------------------------
  it("WS-7: non-admin empty state shows an invite message and no create form", () => {
    authState.user = { email: "test@example.com", isInstanceAdmin: false };
    const { wrapper } = createWrapper([]);
    render(<WorkspaceSelectPage />, { wrapper });

    expect(screen.getByTestId("workspace-no-membership")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /workspace name/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /create workspace/i }),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // WS-8: Non-admin with multiple workspaces does NOT see "+ New workspace".
  // -------------------------------------------------------------------------
  it("WS-8: non-admin with multiple workspaces has no '+ New workspace' affordance", () => {
    authState.user = { email: "test@example.com", isInstanceAdmin: false };
    const { wrapper } = createWrapper([WORKSPACE_1, WORKSPACE_2]);
    render(<WorkspaceSelectPage />, { wrapper });

    expect(
      screen.queryByRole("button", { name: /new workspace/i }),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // WS-9: Instance-admin with exactly 1 workspace stays on picker (no redirect).
  // -------------------------------------------------------------------------
  it("WS-9: instance-admin with exactly 1 workspace does NOT auto-redirect and sees the workspace and '+ New workspace'", async () => {
    authState.user = { email: "test@example.com", isInstanceAdmin: true };
    const { wrapper } = createWrapper([WORKSPACE_1]);
    render(<WorkspaceSelectPage />, { wrapper });

    // Must NOT auto-redirect
    await waitFor(() => {
      // Give the effect a chance to fire — if navigate were called it would have by now
      expect(mockNavigate).not.toHaveBeenCalledWith(
        expect.objectContaining({ to: "/inbox" }),
      );
      expect(mockNavigate).not.toHaveBeenCalledWith(
        expect.objectContaining({ to: "/workspaces/$workspaceId/projects" }),
      );
    });

    // Workspace listed
    expect(screen.getByTestId("workspace-item-alpha")).toBeInTheDocument();

    // "+ New workspace" visible
    expect(
      screen.getByRole("button", { name: /new workspace/i }),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // WS-10: Non-admin with exactly 1 workspace still auto-redirects (unchanged).
  // -------------------------------------------------------------------------
  it("WS-10: non-admin with exactly 1 workspace still auto-redirects", async () => {
    authState.user = { email: "test@example.com", isInstanceAdmin: false };
    // fetchApi is called for project list by the auto-redirect effect
    vi.mocked(fetchApi).mockResolvedValue([] as unknown as never);
    const { wrapper } = createWrapper([WORKSPACE_1]);
    render(<WorkspaceSelectPage />, { wrapper });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
  });
});
