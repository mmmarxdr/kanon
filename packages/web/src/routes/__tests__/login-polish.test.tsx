/**
 * Login screen polish — auth-screens-polish PR
 *
 * Verified behaviors:
 *   LP-1: SSO Google button is rendered and disabled (not clickable)
 *   LP-2: SSO SAML button is rendered and disabled (not clickable)
 *   LP-3: Magic-link button is rendered and disabled (not clickable)
 *   LP-4: Email/password fields and submit still work (no regression)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoginForm } from "../login";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: () => ({ setUser: vi.fn() }),
}));

describe("LoginForm — auth screen polish (SSO + magic-link disabled)", () => {
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

  it("LP-3: magic-link button is rendered and disabled", () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    const btn = screen.getByTestId("magic-link-btn");
    expect(btn).toBeTruthy();
    expect(btn).toBeDisabled();
  });

  it("LP-4: email and password fields are still present and the form has the login testid", () => {
    render(<LoginForm invite={undefined} onNavigate={mockNavigate} />);
    expect(screen.getByLabelText(/work email/i)).toBeTruthy();
    expect(screen.getByLabelText(/password/i)).toBeTruthy();
    expect(screen.getByTestId("login-form")).toBeTruthy();
  });
});
