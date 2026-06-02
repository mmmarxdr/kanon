/**
 * G2 — Register 1-hop auto-login (R-NUI-autologin web)
 *
 * Tests for the register page's invite 1-hop flow.
 * When an invite token is present, POST /api/auth/register is called WITH
 * the token. On 201 success, the session is recognized (GET /me → setUser)
 * and the user is navigated to /workspaces directly — no redirect to /login.
 *
 * Without invite: current behavior preserved (redirect to /login).
 *
 * Seam: RegisterForm is extracted from register.tsx, accepting `invite` and
 * `onNavigate` as props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegisterForm } from "../register";

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

function makeOkJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorJson(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REGISTER_RESPONSE = {
  id: "u1",
  email: "alice@co.com",
  displayName: "Alice",
  accessToken: "tok-access",
  refreshToken: "tok-refresh",
};

const ME_RESPONSE = {
  id: "u1",
  email: "alice@co.com",
  displayName: "Alice",
  avatarUrl: null,
  emailVerified: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RegisterForm — 1-hop invite auto-login (G2 / R-NUI-autologin)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function fillAndSubmit(
    email = "alice@co.com",
    password = "atleast8chars",
    name = "Alice",
  ) {
    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: name },
    });
    fireEvent.change(screen.getByLabelText(/work email/i), {
      target: { value: email },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: password },
    });
    fireEvent.submit(screen.getByTestId("register-form"));
  }

  it("with invite: calls register WITH the token, bootstraps session, navigates to /workspaces", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson(REGISTER_RESPONSE, 201)) // POST /register
      .mockResolvedValueOnce(makeOkJson(ME_RESPONSE));            // GET /me

    render(<RegisterForm invite="invite-tok" onNavigate={mockNavigate} />);
    await fillAndSubmit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    // First call must include the invite token in the body
    const registerCall = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(registerCall[0]).toContain("/api/auth/register");
    const body = JSON.parse(registerCall[1].body as string) as Record<string, unknown>;
    expect(body.invite).toBe("invite-tok");

    // Auth store must have been hydrated
    expect(mockSetUser).toHaveBeenCalledWith(ME_RESPONSE);

    // Must navigate to /workspaces, NOT to /login
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/workspaces" }),
    );
    const loginNavCalls = mockNavigate.mock.calls.filter((call) =>
      JSON.stringify(call).includes("/login"),
    );
    expect(loginNavCalls).toHaveLength(0);
  });

  it("without invite: calls register WITHOUT token, redirects to /login (unchanged behavior)", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkJson({ id: "u1", email: "alice@co.com", displayName: null }, 201));

    render(<RegisterForm invite={undefined} onNavigate={mockNavigate} />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/login" }),
      ),
    );

    // Only one fetch call — no /me
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const noInviteCall = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(noInviteCall[1].body as string) as Record<string, unknown>;
    expect(body.invite).toBeUndefined();

    // Auth store must NOT have been called
    expect(mockSetUser).not.toHaveBeenCalled();
  });

  it("with invite: shows error when register fails (email already taken)", async () => {
    fetchSpy.mockResolvedValueOnce(
      makeErrorJson(409, "EMAIL_TAKEN", "An account with this email already exists"),
    );

    render(<RegisterForm invite="invite-tok" onNavigate={mockNavigate} />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("register-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("register-error").textContent).toContain("already exists");

    // Must NOT navigate to /workspaces on failure
    const workspaceNavCalls = mockNavigate.mock.calls.filter((call) =>
      JSON.stringify(call).includes("/workspaces"),
    );
    expect(workspaceNavCalls).toHaveLength(0);
  });
});
