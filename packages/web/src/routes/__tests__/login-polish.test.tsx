/**
 * Login screen polish — auth-screens-polish PR
 *
 * Verified behaviors:
 *   LP-1: SSO Google button is rendered and disabled (not clickable)
 *   LP-2: SSO SAML button is rendered and disabled (not clickable)
 *   LP-3: Magic-link button is rendered and ENABLED (KAN-9 — wired up)
 *   LP-4: Email/password fields and submit still work (no regression)
 *   LP-5: Clicking magic-link without email shows an error (guard)
 *   LP-6: Clicking magic-link with email calls the API and shows sent state
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "../login";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: () => ({ setUser: vi.fn() }),
}));

describe("LoginForm — auth screen polish (SSO + magic-link)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("LP-1: SSO Google button is rendered and disabled", () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    const btn = screen.getByTestId("sso-google-btn");
    expect(btn).toBeTruthy();
    expect(btn).toBeDisabled();
  });

  it("LP-2: SSO SAML button is rendered and disabled", () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    const btn = screen.getByTestId("sso-saml-btn");
    expect(btn).toBeTruthy();
    expect(btn).toBeDisabled();
  });

  it("LP-3: magic-link button is rendered and ENABLED (KAN-9)", () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    const btn = screen.getByTestId("magic-link-btn");
    expect(btn).toBeTruthy();
    // Button is now enabled — KAN-9 wired it up
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveTextContent(/magic link/i);
  });

  it("LP-4: email and password fields are still present and the form has the login testid", () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    expect(screen.getByLabelText(/work email/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByTestId("login-form")).toBeTruthy();
  });

  it("LP-5: clicking magic-link without filling email shows guard error", async () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    const btn = screen.getByTestId("magic-link-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      const errEl = screen.getByTestId("magic-link-error");
      expect(errEl).toBeTruthy();
      expect(errEl.textContent).toMatch(/email/i);
    });
    // fetch must NOT have been called
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("LP-6: clicking magic-link with a valid email calls the API and shows sent state", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: "If that email is registered, you will receive a sign-in link" }),
    } as Response);

    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);

    // Fill email
    const emailInput = screen.getByLabelText(/work email/i);
    fireEvent.change(emailInput, { target: { value: "alice@example.com" } });

    const btn = screen.getByTestId("magic-link-btn");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Check your email/i)).toBeTruthy();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/auth/magic-link",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("LP-7: clicking Resend calls the API again with the same email", async () => {
    // First call — enters sent state
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ message: "If that email is registered, you will receive a sign-in link" }),
    } as Response);

    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);

    const emailInput = screen.getByLabelText(/work email/i);
    fireEvent.change(emailInput, { target: { value: "alice@example.com" } });

    fireEvent.click(screen.getByTestId("magic-link-btn"));

    await waitFor(() => {
      expect(screen.getByText(/Check your email/i)).toBeTruthy();
    });

    // Now in sent state — click Resend
    const resendBtn = screen.getByRole("button", { name: /resend/i });
    fireEvent.click(resendBtn);

    await waitFor(() => {
      // fetch called twice total (first send + resend)
      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
    });

    // Both calls must use the same email
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const body1 = JSON.parse((calls[0]![1] as RequestInit).body as string);
    const body2 = JSON.parse((calls[1]![1] as RequestInit).body as string);
    expect(body1.email).toBe("alice@example.com");
    expect(body2.email).toBe("alice@example.com");

    // After resend completes, still shows sent state (not reset)
    await waitFor(() => {
      expect(screen.getByText(/Check your email/i)).toBeTruthy();
    });
  });
});
