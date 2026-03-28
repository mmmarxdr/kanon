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

  it("renders all form fields", () => {
    renderLogin();

    expect(screen.getByLabelText("Workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("submits with correct payload on form submission", async () => {
    const user = userEvent.setup();

    const meResponse: AuthUser = {
      memberId: "member-123",
      email: "test@example.com",
      username: "tester",
      workspaceId: "ws-456",
      role: "admin",
    };

    // First call: login, second call: /me
    mockFetchApi
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce(meResponse);

    renderLogin();

    await user.type(screen.getByLabelText("Workspace"), "ws-456");
    await user.type(screen.getByLabelText("Email"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledTimes(2);
    });

    // First call should be login
    const [loginUrl, loginInit] = mockFetchApi.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe("/api/auth/login");
    expect(loginInit.method).toBe("POST");

    const body = JSON.parse(loginInit.body as string) as Record<string, string>;
    expect(body.email).toBe("test@example.com");
    expect(body.password).toBe("password123");
    expect(body.workspaceId).toBe("ws-456");

    // Second call should be /me
    const [meUrl] = mockFetchApi.mock.calls[1] as [string];
    expect(meUrl).toBe("/api/auth/me");

    // Should have set user in the auth store
    await waitFor(() => {
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user?.memberId).toBe("member-123");
    });

    // Should navigate to /workspaces
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/workspaces" });
  });

  it("displays error message on failed login", async () => {
    const user = userEvent.setup();

    const { ApiError } = await import("@/lib/api-client");
    mockFetchApi.mockRejectedValue(
      new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password"),
    );

    renderLogin();

    await user.type(screen.getByLabelText("Workspace"), "ws-123");
    await user.type(screen.getByLabelText("Email"), "wrong@example.com");
    await user.type(screen.getByLabelText("Password"), "wrongpass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument();
    });
  });
});
