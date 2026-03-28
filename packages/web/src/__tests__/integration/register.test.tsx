import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockNavigate, captured, mockFetchApi } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  captured: { RegisterComponent: null as React.ComponentType | null },
  mockFetchApi: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createRoute: (opts: { component?: React.ComponentType }) => {
    if (opts.component) {
      captured.RegisterComponent = opts.component;
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
import "@/routes/register";

describe("RegisterPage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockFetchApi.mockReset();
  });

  function renderRegister() {
    if (!captured.RegisterComponent)
      throw new Error("RegisterPage component not captured");
    return render(<captured.RegisterComponent />);
  }

  it("renders all form fields", () => {
    renderRegister();

    expect(screen.getByLabelText("Workspace ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toBeInTheDocument();
  });

  it("submits with correct payload on form submission", async () => {
    const user = userEvent.setup();

    mockFetchApi.mockResolvedValue({ id: "new-member-1" });

    renderRegister();

    await user.type(screen.getByLabelText("Workspace ID"), "ws-789");
    await user.type(screen.getByLabelText("Username"), "johndoe");
    await user.type(screen.getByLabelText("Email"), "john@example.com");
    await user.type(screen.getByLabelText("Password"), "securepass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    const [url, init] = mockFetchApi.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/register");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.username).toBe("johndoe");
    expect(body.email).toBe("john@example.com");
    expect(body.password).toBe("securepass123");
    expect(body.workspaceId).toBe("ws-789");

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/login" });
    });
  });

  it("displays error for duplicate email", async () => {
    const user = userEvent.setup();

    const { ApiError } = await import("@/lib/api-client");
    mockFetchApi.mockRejectedValue(
      new ApiError(409, "DUPLICATE_EMAIL", "Email already registered"),
    );

    renderRegister();

    await user.type(screen.getByLabelText("Workspace ID"), "ws-789");
    await user.type(screen.getByLabelText("Username"), "johndoe");
    await user.type(screen.getByLabelText("Email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password"), "securepass123");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(screen.getByText("Email already registered")).toBeInTheDocument();
    });
  });
});
