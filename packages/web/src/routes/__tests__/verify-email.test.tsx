/**
 * Tests for verify-email route inner component (R-EV-verify web side).
 *
 * - With valid token → calls POST /api/auth/verify-email, shows success state, calls onSuccess.
 * - With failing token → shows failure/error state.
 * - Without token → shows invalid-link state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { VerifyEmailView } from "../verify-email";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeOkResponse(status = 200): Response {
  return new Response(JSON.stringify({ message: "Email verified successfully" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorResponse(status: number): Response {
  return new Response(JSON.stringify({ code: "INVALID_VERIFICATION_TOKEN", message: "Invalid or expired" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("VerifyEmailView", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const onSuccess = vi.fn();

  beforeEach(() => {
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("with valid token: calls POST /api/auth/verify-email and shows success state", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse());

    render(<VerifyEmailView token="valid-tok" onSuccess={onSuccess} />);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/auth/verify-email");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.token).toBe("valid-tok");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: /email verified/i })).toBeInTheDocument(),
    );
  });

  it("with valid token: calls onSuccess after successful verification", async () => {
    fetchSpy.mockResolvedValueOnce(makeOkResponse());
    const onSuccessMock = vi.fn().mockResolvedValue(undefined);

    render(<VerifyEmailView token="valid-tok" onSuccess={onSuccessMock} />);

    await waitFor(() => expect(onSuccessMock).toHaveBeenCalledTimes(1));
  });

  it("with failing token (400): shows error/failure state", async () => {
    fetchSpy.mockResolvedValueOnce(makeErrorResponse(400));

    render(<VerifyEmailView token="expired-tok" onSuccess={onSuccess} />);

    // H2 heading shows the error state
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2, name: /invalid or expired link/i })).toBeInTheDocument(),
    );
  });

  it("without token: shows invalid-link state immediately (no fetch)", () => {
    render(<VerifyEmailView token={undefined} onSuccess={onSuccess} />);

    expect(screen.getByRole("heading", { level: 2, name: /invalid/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
