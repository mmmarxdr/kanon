/**
 * Setup page — component tests (KAN-49 / Domain G)
 *
 * Tests for the /setup public claim form:
 *  (a) INVALID_TOKEN, TOKEN_EXPIRED, TOKEN_USED → token-field inline error
 *  (b) EMAIL_EXISTS (409) → email-field inline error
 *  (c) weak password (400 VALIDATION_ERROR) → password-field inline error
 *  (d) GET /api/instance/setup/status returns claimed:true → redirect to /login
 *  (e) happy path → navigates to /admin/instance
 *
 * Pattern: mirrors login-invite.test.tsx — raw `fetch` spy + mock useNavigate.
 * Redirect on claimed status is tested in-component (useEffect pattern, not beforeLoad).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetupForm } from "../setup";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

// ─── navigate mock ────────────────────────────────────────────────────────────

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
  return new Response(JSON.stringify({ code, error: code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeValidationErrorJson(message: string): Response {
  return new Response(
    JSON.stringify({ error: "VALIDATION_ERROR", message, details: [] }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}

async function fillAndSubmit(
  token = "validtoken12345678901",
  email = "admin@kanon.io",
  password = "Passw0rd!secure",
) {
  fireEvent.change(screen.getByLabelText(/setup token/i), {
    target: { value: token },
  });
  fireEvent.change(screen.getByLabelText(/admin email/i), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: password },
  });
  fireEvent.submit(screen.getByTestId("setup-form"));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SetupForm — claim form submission", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── (a) token-field errors ─────────────────────────────────────────────────

  it("(a1) INVALID_TOKEN → token-field inline error", async () => {
    // status check → unclaimed; claim → INVALID_TOKEN
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({ claimed: false }))
      .mockResolvedValueOnce(
        makeErrorJson(400, "INVALID_TOKEN", "The setup token is invalid"),
      );

    render(<SetupForm onNavigate={mockNavigate} />);
    await screen.findByTestId("setup-form");
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("setup-token-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("setup-token-error").textContent).toContain(
      "invalid",
    );
    expect(screen.queryByTestId("setup-email-error")).toBeNull();
    expect(screen.queryByTestId("setup-password-error")).toBeNull();
  });

  it("(a2) TOKEN_EXPIRED → token-field inline error", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({ claimed: false }))
      .mockResolvedValueOnce(
        makeErrorJson(410, "TOKEN_EXPIRED", "This setup token has expired"),
      );

    render(<SetupForm onNavigate={mockNavigate} />);
    await screen.findByTestId("setup-form");
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("setup-token-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("setup-token-error").textContent).toContain(
      "expired",
    );
  });

  it("(a3) TOKEN_USED → token-field inline error", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({ claimed: false }))
      .mockResolvedValueOnce(
        makeErrorJson(410, "TOKEN_USED", "This setup token has already been used"),
      );

    render(<SetupForm onNavigate={mockNavigate} />);
    await screen.findByTestId("setup-form");
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("setup-token-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("setup-token-error").textContent).toContain(
      "already been used",
    );
  });

  // ── (b) email-field error ──────────────────────────────────────────────────

  it("(b) EMAIL_EXISTS (409) → email-field inline error", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({ claimed: false }))
      .mockResolvedValueOnce(
        makeErrorJson(409, "EMAIL_EXISTS", "An account with this email already exists"),
      );

    render(<SetupForm onNavigate={mockNavigate} />);
    await screen.findByTestId("setup-form");
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("setup-email-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("setup-email-error").textContent).toContain(
      "already exists",
    );
    expect(screen.queryByTestId("setup-token-error")).toBeNull();
    expect(screen.queryByTestId("setup-password-error")).toBeNull();
  });

  // ── (c) password-field error ───────────────────────────────────────────────

  it("(c) weak password (400 VALIDATION_ERROR) → password-field inline error", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({ claimed: false }))
      .mockResolvedValueOnce(
        makeValidationErrorJson("Request validation failed"),
      );

    render(<SetupForm onNavigate={mockNavigate} />);
    await screen.findByTestId("setup-form");
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("setup-password-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("setup-password-error").textContent).toMatch(
      /requirements|checklist/i,
    );
    expect(screen.queryByTestId("setup-token-error")).toBeNull();
    expect(screen.queryByTestId("setup-email-error")).toBeNull();
  });

  // ── (d) already-claimed redirect ──────────────────────────────────────────

  it("(d) status claimed:true → redirect to /login before form shows", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkJson({ claimed: true }));

    render(<SetupForm onNavigate={mockNavigate} />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/login" }),
      ),
    );
  });

  // ── (e) happy path ─────────────────────────────────────────────────────────

  it("(e) happy path → GET /me, setUser, navigate to /admin/instance", async () => {
    fetchSpy
      .mockResolvedValueOnce(makeOkJson({ claimed: false })) // status check
      .mockResolvedValueOnce(makeOkJson({ accessToken: "at", refreshToken: "rt" })) // claim
      .mockResolvedValueOnce(
        makeOkJson({
          id: "u1",
          email: "admin@kanon.io",
          displayName: null,
          avatarUrl: null,
          emailVerified: true,
        }),
      ); // GET /me

    render(<SetupForm onNavigate={mockNavigate} />);
    await screen.findByTestId("setup-form");
    await fillAndSubmit();

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/admin/instance" }),
      ),
    );
    expect(mockSetUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "admin@kanon.io" }),
    );
  });
});
