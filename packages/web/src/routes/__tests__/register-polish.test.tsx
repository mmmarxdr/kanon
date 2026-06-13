/**
 * Register screen polish — auth-screens-polish PR
 *
 * Verified behaviors:
 *   RP-1: ToS checkbox is unchecked by default — submit button is disabled
 *   RP-2: Checking the ToS checkbox enables the submit button
 *   RP-3: Submitting without checking ToS does NOT call the API
 *   RP-4: With invite token, heading/copy frames as "join", not "create workspace"
 *   RP-5: Without invite token, heading/copy uses account-creation framing
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RegisterForm } from "../register";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: () => ({ setUser: vi.fn() }),
}));

describe("RegisterForm — ToS gate + copy (auth-screens-polish)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("RP-1: ToS checkbox is unchecked by default and submit is disabled", () => {
    render(<RegisterForm invite={undefined} onNavigate={mockNavigate} />);
    const checkbox = screen.getByTestId("tos-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    // Primary button should be disabled when ToS unchecked
    const submit = screen.getByRole("button", { name: /create account/i });
    expect(submit).toBeDisabled();
  });

  it("RP-2: checking the ToS checkbox enables the submit button (with valid passwords)", () => {
    render(<RegisterForm invite={undefined} onNavigate={mockNavigate} />);
    // Fill fully-compliant matching passwords so only ToS gates the button
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "SecretPass1!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "SecretPass1!" },
    });
    const checkbox = screen.getByTestId("tos-checkbox");
    fireEvent.click(checkbox);
    const submit = screen.getByRole("button", { name: /create account/i });
    expect(submit).not.toBeDisabled();
  });

  it("RP-3: submitting without ToS does NOT call fetch", () => {
    render(<RegisterForm invite={undefined} onNavigate={mockNavigate} />);
    fireEvent.change(screen.getByLabelText(/work email/i), {
      target: { value: "test@co.com" },
    });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
      target: { value: "password123" },
    });
    // Do NOT check the ToS box
    fireEvent.submit(screen.getByTestId("register-form"));
    // fetch must not have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("RP-4: with invite token, heading contains join-oriented copy", () => {
    render(<RegisterForm invite="tok-abc" onNavigate={mockNavigate} />);
    // H2 should say "Join your team"
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Join");
  });

  it("RP-5: without invite token, heading contains account-creation copy", () => {
    render(<RegisterForm invite={undefined} onNavigate={mockNavigate} />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "Create your account",
    );
  });
});
