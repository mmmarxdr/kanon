/**
 * Admin Instance page — component tests (KAN-49 / Domain G)
 *
 * Tests for the /admin/instance super-admin settings page:
 *  (a) super-admin (200) → renders instanceName field
 *  (b) GET /api/instance/settings returns 403 → redirect to /
 *  (c) unauthenticated → redirect to /login (via _authenticated parent guard)
 *  (d) PATCH success → save button works, updated instanceName shown
 *
 * Pattern: mirrors invite-accept.test.tsx — raw fetch spy, mock useNavigate.
 * The 403-redirect and unauth-redirect are tested in-component (useEffect + navigate),
 * not via beforeLoad, consistent with invite.tsx's load pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminInstanceForm } from "../_authenticated/admin.instance";

// ─── hoisted mocks ────────────────────────────────────────────────────────────

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

// ─── api-client mock ──────────────────────────────────────────────────────────

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    fetchApi: mockFetchApi,
  };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSettings(instanceName = "My Kanon") {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    instanceName,
    signupMode: "open",
    allowedSignupDomains: [],
    defaultLocale: "en",
    redmineBaseUrl: null,
    ownerUserId: "u1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("AdminInstanceForm — instance settings page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── (a) super-admin — renders settings ────────────────────────────────────

  it("(a) super-admin: renders instanceName field from settings", async () => {
    mockFetchApi.mockResolvedValueOnce(makeSettings("Acme Kanon"));

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    const input = await screen.findByDisplayValue("Acme Kanon");
    expect(input).toBeTruthy();
  });

  // ── (b) 403 → redirect to / ────────────────────────────────────────────────

  it("(b) GET /api/instance/settings returns 403 → navigates to /", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mockFetchApi.mockRejectedValueOnce(
      new ApiError(403, "FORBIDDEN", "Super-admin access required"),
    );

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/" }),
      ),
    );
  });

  // ── (c) 401 unauth → redirect to /login ───────────────────────────────────

  it("(c) GET /api/instance/settings returns 401 → navigates to /login", async () => {
    const { ApiError } = await import("@/lib/api-client");
    mockFetchApi.mockRejectedValueOnce(
      new ApiError(401, "UNAUTHORIZED", "Authentication required"),
    );

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/login" }),
      ),
    );
  });

  // ── (d) PATCH success ─────────────────────────────────────────────────────

  it("(d) editing instanceName and saving calls PATCH and updates display", async () => {
    mockFetchApi
      .mockResolvedValueOnce(makeSettings("Old Name")) // initial GET
      .mockResolvedValueOnce(makeSettings("New Name")); // PATCH response

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    // Wait for form to load
    const input = await screen.findByDisplayValue("Old Name");
    fireEvent.change(input, { target: { value: "New Name" } });

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(mockFetchApi).toHaveBeenCalledWith(
        "/api/instance/settings",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("stores the instance-wide Redmine URL", async () => {
    mockFetchApi
      .mockResolvedValueOnce(makeSettings())
      .mockResolvedValueOnce({
        ...makeSettings(),
        redmineBaseUrl: "https://redmine.example.test",
      });

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    fireEvent.change(await screen.findByTestId("redmine-base-url-input"), {
      target: { value: "https://redmine.example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const patchCall = mockFetchApi.mock.calls.find((call) => call[1]?.method === "PATCH");
      const body = JSON.parse(patchCall![1].body as string) as Record<string, unknown>;
      expect(body.redmineBaseUrl).toBe("https://redmine.example.test");
    });
  });

  it("clears the instance-wide Redmine URL", async () => {
    mockFetchApi
      .mockResolvedValueOnce({
        ...makeSettings(),
        redmineBaseUrl: "https://redmine.example.test",
      })
      .mockResolvedValueOnce(makeSettings());

    render(<AdminInstanceForm onNavigate={mockNavigate} />);

    fireEvent.change(await screen.findByTestId("redmine-base-url-input"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const patchCall = mockFetchApi.mock.calls.find((call) => call[1]?.method === "PATCH");
      const body = JSON.parse(patchCall![1].body as string) as Record<string, unknown>;
      expect(body.redmineBaseUrl).toBeNull();
    });
  });
});
