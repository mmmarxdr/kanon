/**
 * AdminInstanceForm — signup policy editing tests (KAN-49 / PR2 tasks 2.9–2.10)
 *
 * Tests:
 *  (a) signupMode is rendered as a <select> (editable, not read-only)
 *  (b) allowedSignupDomains is editable (textarea/input, not plain text)
 *  (c) changing signupMode and saving calls PATCH /api/instance/settings with updated value
 *  (d) saving domains calls PATCH with updated allowedSignupDomains array
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminInstanceForm } from "../_authenticated/admin.instance";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockNavigate, mockFetchApi } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockFetchApi: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, fetchApi: mockFetchApi };
});

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (selector: (s: { user: unknown }) => unknown) =>
    selector({
      user: {
        id: "u1",
        email: "admin@kanon.io",
        displayName: "Admin",
        avatarUrl: null,
        emailVerified: true,
        isSuperAdmin: true,
        isInstanceAdmin: true,
      },
    }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    instanceName: "My Kanon",
    signupMode: "open",
    allowedSignupDomains: [],
    ownerUserId: "u1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminInstanceForm — signup policy editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── (a) signupMode is an editable select ──────────────────────────────────

  it("(a) signupMode renders as editable select with open/invite/closed options", async () => {
    mockFetchApi.mockResolvedValueOnce(makeSettings({ signupMode: "open" }));
    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const select = await screen.findByTestId("signup-mode-select");
    expect(select.tagName).toBe("SELECT");
    expect((select as HTMLSelectElement).value).toBe("open");

    // All three options must exist
    const options = (select as HTMLSelectElement).options;
    const values = Array.from(options).map((o) => o.value);
    expect(values).toContain("open");
    expect(values).toContain("invite");
    expect(values).toContain("closed");
  });

  // ── (b) allowedSignupDomains is editable ──────────────────────────────────

  it("(b) allowedSignupDomains renders as editable input (not plain text)", async () => {
    mockFetchApi.mockResolvedValueOnce(
      makeSettings({ allowedSignupDomains: ["acme.com"] }),
    );
    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const domainsInput = await screen.findByTestId("allowed-domains-input");
    expect(domainsInput.tagName === "INPUT" || domainsInput.tagName === "TEXTAREA").toBe(true);
  });

  // ── (c) changing signupMode → PATCH called with updated value ─────────────

  it("(c) changing signupMode to closed and saving calls PATCH with signupMode:closed", async () => {
    mockFetchApi
      .mockResolvedValueOnce(makeSettings({ signupMode: "open" })) // GET
      .mockResolvedValueOnce(makeSettings({ signupMode: "closed" })); // PATCH

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const select = await screen.findByTestId("signup-mode-select");
    fireEvent.change(select, { target: { value: "closed" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const patchCall = mockFetchApi.mock.calls.find(
        (c) => c[1]?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body as string) as Record<string, unknown>;
      expect(body.signupMode).toBe("closed");
    });
  });

  // ── (d) editing domains → PATCH includes updated array ────────────────────

  it("(d) editing allowedSignupDomains and saving sends updated array", async () => {
    mockFetchApi
      .mockResolvedValueOnce(makeSettings({ allowedSignupDomains: [] })) // GET
      .mockResolvedValueOnce(makeSettings({ allowedSignupDomains: ["corp.com"] })); // PATCH

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const domainsInput = await screen.findByTestId("allowed-domains-input");
    fireEvent.change(domainsInput, { target: { value: "corp.com" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      const patchCall = mockFetchApi.mock.calls.find(
        (c) => c[1]?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body as string) as Record<string, unknown>;
      expect(body.allowedSignupDomains).toEqual(["corp.com"]);
    });
  });
});
