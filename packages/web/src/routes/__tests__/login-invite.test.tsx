/**
 * G1 — Accept Failure Surfacing (R-NUI-surface)
 *
 * Tests for the login page's invite-accept error handling.
 * When POST /api/invites/:token/accept returns 4xx, the user MUST see
 * an error message; they must NOT be silently navigated to /workspaces.
 *
 * Seam: LoginForm is a presentational sub-component extracted from login.tsx
 * that accepts `invite` and `onNavigate` as props, enabling isolated testing
 * without a RouterProvider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "../login";

// ─── navigate mock ────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── auth-store mock ──────────────────────────────────────────────────────────

const mockSetUser = vi.fn();
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: () => ({ setUser: mockSetUser }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeOkJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorJson(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LoginForm — invite accept error surfacing (G1 / R-NUI-surface)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function submitForm(email = "alice@co.com", password = "secret123") {
    fireEvent.change(screen.getByLabelText(/work email/i), {
      target: { value: email },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: password },
    });
    fireEvent.submit(screen.getByTestId("login-form"));
  }

  it("surfaces a 403 EMAIL_MISMATCH error on invite accept — does NOT navigate to /workspaces", async () => {
    // login → ok; /me → ok; accept → 403 EMAIL_MISMATCH
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({})) // POST /api/auth/login
      .mockResolvedValueOnce(
        makeOkJson({ id: "u1", email: "alice@co.com", displayName: "Alice", avatarUrl: null }),
      ) // GET /api/auth/me
      .mockResolvedValueOnce(
        makeErrorJson(403, "EMAIL_MISMATCH", "This invite was sent to a different email address"),
      ); // POST /api/invites/tok/accept

    render(<LoginForm invite="tok" onNavigate={mockNavigate} />);
    await submitForm();

    // Error must be visible
    await waitFor(() =>
      expect(screen.getByTestId("login-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("login-error").textContent).toContain(
      "different email address",
    );

    // Must NOT have navigated to /workspaces
    const workspaceNavCalls = mockNavigate.mock.calls.filter(
      (call) => JSON.stringify(call).includes("/workspaces"),
    );
    expect(workspaceNavCalls).toHaveLength(0);
  });

  it("surfaces a 410 INVITE_EXPIRED error on invite accept", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({}))
      .mockResolvedValueOnce(
        makeOkJson({ id: "u1", email: "alice@co.com", displayName: "Alice", avatarUrl: null }),
      )
      .mockResolvedValueOnce(
        makeErrorJson(410, "INVITE_EXPIRED", "This invite has expired"),
      );

    render(<LoginForm invite="tok" onNavigate={mockNavigate} />);
    await submitForm();

    await waitFor(() =>
      expect(screen.getByTestId("login-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("login-error").textContent).toContain("expired");
  });

  it("navigates to /workspaces when invite accept succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({}))
      .mockResolvedValueOnce(
        makeOkJson({ id: "u1", email: "alice@co.com", displayName: "Alice", avatarUrl: null }),
      )
      .mockResolvedValueOnce(makeOkJson({ accepted: true })); // accept ok (201)

    render(<LoginForm invite="tok" onNavigate={mockNavigate} />);
    await submitForm();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/workspaces" }),
      ),
    );
  });

  it("surfaces a 429 INVITE_EXHAUSTED error on invite accept", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({}))
      .mockResolvedValueOnce(
        makeOkJson({ id: "u1", email: "alice@co.com", displayName: "Alice", avatarUrl: null }),
      )
      .mockResolvedValueOnce(
        makeErrorJson(429, "INVITE_EXHAUSTED", "This invite has reached its maximum number of uses"),
      );

    render(<LoginForm invite="tok" onNavigate={mockNavigate} />);
    await submitForm();

    await waitFor(() =>
      expect(screen.getByTestId("login-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("login-error").textContent).toContain(
      "maximum number of uses",
    );

    // Must NOT navigate to /workspaces on exhausted invite
    const workspaceNavCalls = mockNavigate.mock.calls.filter(
      (call) => JSON.stringify(call).includes("/workspaces"),
    );
    expect(workspaceNavCalls).toHaveLength(0);
  });

  it("navigates to /workspaces when there is no invite token (no accept call)", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({}))
      .mockResolvedValueOnce(
        makeOkJson({ id: "u1", email: "alice@co.com", displayName: "Alice", avatarUrl: null }),
      );

    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    await submitForm();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/workspaces" }),
      ),
    );
    // fetch called exactly twice (login + me), NOT a third time for accept
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
