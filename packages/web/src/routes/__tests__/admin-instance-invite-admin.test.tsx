/**
 * AdminInstanceForm — invite-admin UI tests (KAN-49 / PR2 tasks 2.11–2.12)
 *
 * Tests:
 *  (a) isSuperAdmin:true → invite-admin section visible
 *  (b) isInstanceAdmin:true, isSuperAdmin:false → invite-admin section NOT visible
 *  (c) submitting invite form calls POST /api/instance/admins/invites
 *  (d) successful response displays the generated kanon:// link
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminInstanceForm } from "../_authenticated/admin.instance";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

const { mockNavigate, mockFetchApi, mockUser } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockFetchApi: vi.fn(),
  mockUser: {
    value: {
      id: "u1",
      email: "admin@kanon.io",
      displayName: "Admin",
      avatarUrl: null,
      emailVerified: true,
      isSuperAdmin: true,
      isInstanceAdmin: true,
    } as Record<string, unknown> | null,
  },
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
    selector({ user: mockUser.value }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSettings() {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    instanceName: "My Kanon",
    signupMode: "open",
    allowedSignupDomains: [],
    defaultLocale: "en",
    ownerUserId: "u1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeInviteResponse(email: string) {
  return {
    inviteId: "inv-1",
    url: `kanon://instance-admin-invite/token123`,
    token: "token123",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminInstanceForm — invite-admin UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = {
      id: "u1",
      email: "admin@kanon.io",
      displayName: "Admin",
      avatarUrl: null,
      emailVerified: true,
      isSuperAdmin: true,
      isInstanceAdmin: true,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── (a) isSuperAdmin:true → invite section visible ───────────────────────

  it("(a) isSuperAdmin:true → invite-admin section is visible", async () => {
    // beforeEach sets isSuperAdmin:true, isInstanceAdmin:true
    mockFetchApi.mockResolvedValueOnce(makeSettings());
    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    await waitFor(() => {
      expect(screen.getByTestId("invite-admin-section")).toBeTruthy();
    });
  });

  // ── (b) isInstanceAdmin:true, isSuperAdmin:false → section NOT visible ────

  it("(b) isInstanceAdmin:true, isSuperAdmin:false → invite-admin section is NOT rendered", async () => {
    mockUser.value = {
      id: "u1",
      email: "user@kanon.io",
      displayName: "User",
      avatarUrl: null,
      emailVerified: true,
      isSuperAdmin: false,
      isInstanceAdmin: true,  // pure instance-admin — should NOT see invite-admin UI
    };
    mockFetchApi.mockResolvedValueOnce(makeSettings());
    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    // Wait for form to load
    await screen.findByTestId("admin-instance-form");
    expect(screen.queryByTestId("invite-admin-section")).toBeNull();
  });

  // ── (c) submitting invite form calls POST /api/instance/admins/invites ────

  it("(c) submitting invite form calls POST /api/instance/admins/invites", async () => {
    mockFetchApi
      .mockResolvedValueOnce(makeSettings()) // GET settings
      .mockResolvedValueOnce(makeInviteResponse("newadmin@corp.com")); // POST invite

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const emailInput = await screen.findByTestId("invite-admin-email");
    fireEvent.change(emailInput, { target: { value: "newadmin@corp.com" } });

    const submitBtn = screen.getByTestId("invite-admin-submit");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockFetchApi).toHaveBeenCalledWith(
        "/api/instance/admins/invites",
        expect.objectContaining({ method: "POST" }),
      );
      const call1 = mockFetchApi.mock.calls[1]!;
      const body = JSON.parse(
        (call1[1] as { body: string }).body,
      ) as Record<string, unknown>;
      expect(body.email).toBe("newadmin@corp.com");
    });
  });

  // ── (d) response displays kanon:// link ───────────────────────────────────

  it("(d) successful invite response displays the kanon:// link", async () => {
    mockFetchApi
      .mockResolvedValueOnce(makeSettings()) // GET settings
      .mockResolvedValueOnce(makeInviteResponse("newadmin@corp.com")); // POST invite

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const emailInput = await screen.findByTestId("invite-admin-email");
    fireEvent.change(emailInput, { target: { value: "newadmin@corp.com" } });

    fireEvent.click(screen.getByTestId("invite-admin-submit"));

    await waitFor(() => {
      const link = screen.getByTestId("invite-admin-result");
      expect(link.textContent).toContain("kanon://");
    });
  });
});
