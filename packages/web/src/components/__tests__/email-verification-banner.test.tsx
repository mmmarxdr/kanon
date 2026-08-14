/**
 * Tests for EmailVerificationBanner (R-EV-warn, R-EV-resend web side).
 *
 * Banner renders when user.emailVerified === false.
 * Banner is hidden when user.emailVerified === true.
 * Resend button fires POST /api/auth/resend-verification and shows confirmation.
 * Dismiss button hides the banner (session-local).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useAuthStore } from "@/stores/auth-store";
import { EmailVerificationBanner } from "../email-verification-banner";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeUser(emailVerified: boolean) {
  return {
    userId: "u1",
    email: "alice@co.com",
    displayName: "Alice",
    avatarUrl: null,
    emailVerified,
    isSuperAdmin: false,
    isInstanceAdmin: false,
  };
}

function makeOkResponse(status = 200): Response {
  return new Response(JSON.stringify({ message: "ok" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EmailVerificationBanner", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
    // Reset store to clean state before each test
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the banner when user.emailVerified is false", () => {
    useAuthStore.setState({
      user: makeUser(false),
      isAuthenticated: true,
      isLoading: false,
    });

    render(<EmailVerificationBanner />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
  });

  it("does NOT render the banner when user.emailVerified is true", () => {
    useAuthStore.setState({
      user: makeUser(true),
      isAuthenticated: true,
      isLoading: false,
    });

    render(<EmailVerificationBanner />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();
  });

  it("does NOT render the banner when user is null", () => {
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });

    render(<EmailVerificationBanner />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Resend button calls POST /api/auth/resend-verification", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse());

    useAuthStore.setState({
      user: makeUser(false),
      isAuthenticated: true,
      isLoading: false,
    });

    render(<EmailVerificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/resend-verification");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("shows confirmation text after Resend succeeds", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse());

    useAuthStore.setState({
      user: makeUser(false),
      isAuthenticated: true,
      isLoading: false,
    });

    render(<EmailVerificationBanner />);

    fireEvent.click(screen.getByRole("button", { name: /resend/i }));

    await waitFor(() =>
      expect(screen.getByText(/verification email sent/i)).toBeInTheDocument(),
    );
  });

  it("Dismiss button hides the banner", () => {
    useAuthStore.setState({
      user: makeUser(false),
      isAuthenticated: true,
      isLoading: false,
    });

    render(<EmailVerificationBanner />);

    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
