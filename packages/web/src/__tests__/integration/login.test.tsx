import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAuthStore } from "@/stores/auth-store";
import type { AuthUser } from "@/stores/auth-store";

// Use vi.hoisted to ensure these are available when vi.mock factories run
const { mockNavigate, captured, mockFetchApi } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  captured: { LoginComponent: null as React.ComponentType | null },
  mockFetchApi: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createRoute: (opts: { component?: React.ComponentType }) => {
    if (opts.component) {
      captured.LoginComponent = opts.component;
    }
    return {};
  },
  createRootRoute: () => ({}),
  useNavigate: () => mockNavigate,
  Outlet: () => null,
}));

vi.mock("@/lib/api-client", () => ({
  fetchApi: (...args: unknown[]) => mockFetchApi(...args),
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

// Import to trigger component capture
import "@/routes/login";

describe("LoginPage", () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
    mockNavigate.mockClear();
    mockFetchApi.mockReset();
  });

  function renderLogin() {
    if (!captured.LoginComponent)
      throw new Error("LoginPage component not captured");
    return render(<captured.LoginComponent />);
  }

  it("renders email and password fields (no workspace field)", () => {
    renderLogin();

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    // Workspace field should NOT exist
    expect(screen.queryByLabelText("Workspace")).not.toBeInTheDocument();
  });

  it("submits with correct payload (email + password only, no workspace)", async () => {
    const user = userEvent.setup();

    const meResponse: AuthUser = {
      id: "user-123",
      email: "test@example.com",
      displayName: "Tester",
      avatarUrl: null,
    };

    // Login uses direct fetch(), /me uses fetchApi
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    mockFetchApi.mockResolvedValueOnce(meResponse);

    renderLogin();

    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    // Login call via fetch()
    const [loginUrl, loginInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe("/api/auth/login");
    expect(loginInit.method).toBe("POST");

    const body = JSON.parse(loginInit.body as string) as Record<string, string>;
    expect(body.email).toBe("test@example.com");
    expect(body.password).toBe("password123");
    // Must NOT have workspaceId
    expect(body).not.toHaveProperty("workspaceId");

    // /me call via fetchApi
    const [meUrl] = mockFetchApi.mock.calls[0] as [string];
    expect(meUrl).toBe("/api/auth/me");

    // Should have set user in the auth store with User-level fields
    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user?.id).toBe("user-123");
      expect(useAuthStore.getState().user?.email).toBe("test@example.com");
    });

    // Should navigate to /workspaces
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/workspaces" });

    fetchSpy.mockRestore();
  });

  it("displays error message on failed login", async () => {
    const user = userEvent.setup();

    // Login uses direct fetch() — mock a 401 response with JSON body
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "INVALID_CREDENTIALS", message: "Invalid email or password" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    renderLogin();

    await user.type(screen.getByLabelText("Email"), "wrong@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });

    fetchSpy.mockRestore();
  });
});
