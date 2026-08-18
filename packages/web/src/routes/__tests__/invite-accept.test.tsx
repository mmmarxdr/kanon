/**
 * W1 — Invite Accept: 409 already-member path vs. generic error path
 *
 * When an authenticated user clicks "Accept Invite":
 *   - 409 ALREADY_MEMBER  → navigate to /workspaces gracefully (no error shown)
 *   - Non-409 (e.g. 403)  → acceptError displayed; no navigation to /workspaces
 *
 * These two cases distinguish the 409 branch from the generic error path, closing
 * the verify-report gap for invite.tsx:73-76.
 *
 * Render strategy: inviteRoute.options.component holds InvitePage.
 * All three internal hooks are intercepted:
 *   - useNavigate      → module mock
 *   - inviteRoute.useParams → vi.spyOn on the route object
 *   - useAuthStore     → module mock (authenticated user)
 *
 * Metadata fetch uses raw `fetch` (intercepted via globalThis.fetch spy).
 * Accept call uses `fetchApi` (intercepted via vi.mock('@/lib/api-client')).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { inviteRoute } from "../invite";
import { ApiError } from "@/lib/api-client";

// ─── hoisted mocks (must be declared before vi.mock factory runs) ─────────────

const { mockNavigate, mockFetchApi } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockFetchApi: vi.fn(),
}));

// ─── navigate mock ────────────────────────────────────────────────────────────

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ─── auth-store mock — authenticated user ─────────────────────────────────────

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(
    () => ({
      isAuthenticated: true,
      user: { userId: "u1", email: "alice@co.com", displayName: "Alice", avatarUrl: null },
      setUser: vi.fn(),
      clearUser: vi.fn(),
    }),
    // InvitePage calls useAuthStore.getState().bootstrap() on mount.
    { getState: () => ({ bootstrap: vi.fn() }) },
  ),
}));

// ─── api-client mock ──────────────────────────────────────────────────────────

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    fetchApi: mockFetchApi,
  };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeValidMetadataResponse(): Response {
  return new Response(
    JSON.stringify({
      workspaceName: "Acme Corp",
      workspaceSlug: "acme",
      role: "member",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      isExpired: false,
      isExhausted: false,
      isRevoked: false,
      isValid: true,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function renderInvitePage() {
  vi.spyOn(inviteRoute, "useParams").mockReturnValue({ token: "tok123" });
  const Component = inviteRoute.options.component!;
  return render(<Component />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("InvitePage — accept branch distinction (W1 / invite.tsx:73-76)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("409 ALREADY_MEMBER: navigates to /workspaces and does NOT show an error message", async () => {
    fetchSpy.mockResolvedValueOnce(makeValidMetadataResponse());

    mockFetchApi.mockRejectedValueOnce(
      new ApiError(409, "ALREADY_MEMBER", "You are already a member of this workspace"),
    );

    renderInvitePage();

    // Wait for Accept button (metadata loaded, user authenticated)
    const acceptButton = await screen.findByRole("button", { name: /accept invite/i });
    fireEvent.click(acceptButton);

    // Must navigate to /workspaces
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/workspaces" }),
      ),
    );

    // Must NOT show any error text for the 409 path
    expect(screen.queryByText(/already a member/i)).toBeNull();
    expect(screen.queryByText(/failed to accept/i)).toBeNull();
  });

  it("non-409 error (403 FORBIDDEN): shows acceptError message and does NOT navigate to /workspaces", async () => {
    fetchSpy.mockResolvedValueOnce(makeValidMetadataResponse());

    mockFetchApi.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "You do not have permission to accept this invite"),
    );

    renderInvitePage();

    const acceptButton = await screen.findByRole("button", { name: /accept invite/i });
    fireEvent.click(acceptButton);

    // Error message must be visible
    await waitFor(() =>
      expect(screen.getByText(/do not have permission/i)).toBeTruthy(),
    );

    // Must NOT navigate to /workspaces
    const workspaceNavCalls = mockNavigate.mock.calls.filter((call) =>
      JSON.stringify(call).includes("/workspaces"),
    );
    expect(workspaceNavCalls).toHaveLength(0);
  });
});
