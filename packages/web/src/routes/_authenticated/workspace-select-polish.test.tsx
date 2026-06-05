/**
 * workspace-select polish — auth-screens-polish PR
 *
 * Verified behaviors:
 *   WP-1: Role badge renders when workspace has a `role` field
 *   WP-2: Member count renders when workspace has a `memberCount` field
 *   WP-3: Neither badge renders when role/memberCount are absent (graceful omission)
 *   WP-4: Existing testids and name/slug rendering preserved (no regression)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createRoute: actual.createRoute,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { fetchApi: vi.fn(), ApiError };
});

vi.mock("@/stores/toast-store", () => ({
  useToastStore: {
    getState: vi.fn(() => ({ addToast: vi.fn() })),
  },
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector: (s: { user: { email: string } | null }) => unknown) =>
      selector({ user: { email: "test@example.com" } }),
    { getState: vi.fn(() => ({ logout: vi.fn() })) },
  ),
}));

vi.mock("@/components/ui/icons", () => ({
  Monogram: () => null,
}));

import { WorkspaceSelectPage } from "./workspace-select";
import { fetchApi } from "@/lib/api-client";

function makeWrapper(workspaces: object[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  queryClient.setQueryData(["workspaces", "list"], workspaces);
  vi.mocked(fetchApi).mockResolvedValue([] as unknown as never);
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const WS_WITH_ROLE_AND_COUNT = {
  id: "ws-1",
  name: "Alpha",
  slug: "alpha",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
  role: "Admin",
  memberCount: 12,
};

const WS_WITH_ROLE_NO_COUNT = {
  id: "ws-2",
  name: "Beta",
  slug: "beta",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
  role: "Engineer",
};

const WS_PLAIN = {
  id: "ws-3",
  name: "Gamma",
  slug: "gamma",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

describe("WorkspaceSelectPage — polish (role badge + member count)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    vi.mocked(fetchApi).mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("WP-1: role badge renders when workspace has a role field", () => {
    const wrapper = makeWrapper([WS_WITH_ROLE_AND_COUNT, WS_PLAIN]);
    render(<WorkspaceSelectPage />, { wrapper });
    expect(screen.getByTestId("workspace-role-badge-alpha")).toBeTruthy();
    expect(
      screen.getByTestId("workspace-role-badge-alpha").textContent,
    ).toBe("Admin");
  });

  it("WP-2: member count renders when workspace has a memberCount field", () => {
    const wrapper = makeWrapper([WS_WITH_ROLE_AND_COUNT, WS_PLAIN]);
    render(<WorkspaceSelectPage />, { wrapper });
    const alphaCard = screen.getByTestId("workspace-item-alpha");
    expect(alphaCard.textContent).toContain("12");
    expect(alphaCard.textContent).toContain("people");
  });

  it("WP-3: no role badge or member count when fields are absent", () => {
    const wrapper = makeWrapper([WS_PLAIN, WS_WITH_ROLE_AND_COUNT]);
    render(<WorkspaceSelectPage />, { wrapper });
    expect(
      screen.queryByTestId("workspace-role-badge-gamma"),
    ).not.toBeInTheDocument();
    // Gamma card should NOT have "people" text
    const gammaCard = screen.getByTestId("workspace-item-gamma");
    expect(gammaCard.textContent).not.toContain("people");
  });

  it("WP-4: name, slug, and testid are preserved (no regression)", () => {
    const wrapper = makeWrapper([WS_WITH_ROLE_NO_COUNT, WS_PLAIN]);
    render(<WorkspaceSelectPage />, { wrapper });
    expect(screen.getByTestId("workspace-item-beta")).toBeTruthy();
    expect(screen.getByTestId("workspace-item-gamma")).toBeTruthy();
    expect(screen.getByTestId("workspace-item-beta").textContent).toContain("Beta");
    expect(screen.getByTestId("workspace-item-beta").textContent).toContain("beta");
  });
});
