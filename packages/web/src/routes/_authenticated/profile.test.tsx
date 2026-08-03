/**
 * Tests for the Profile page's notification-preferences relocation (KAN-212 Slice A).
 *
 * Covers:
 * - Renders NotificationPreferencesSection + "For workspace: {name}" label when there is
 *   an active workspace.
 * - Renders a defined empty state when the user belongs to no workspace.
 * - Renders a defined loading state while workspace resolution is pending.
 *
 * Pattern: mock hooks, render component, assert DOM state.
 * Mirrors members-section.test.tsx / invite-domain-restriction.test.tsx harness.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: vi.fn(),
  useWorkspacesQuery: vi.fn(),
}));

vi.mock("@/features/settings/notification-preferences-section", () => ({
  NotificationPreferencesSection: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="notification-preferences-section">{workspaceId}</div>
  ),
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (
    selector: (s: { user: { email: string; displayName: string | null; avatarUrl: string | null } | null } & { setUser: () => void }) => unknown,
  ) =>
    selector({
      user: { email: "user@example.com", displayName: "Test User", avatarUrl: null },
      setUser: vi.fn(),
    } as unknown as Parameters<typeof selector>[0]),
}));

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

const WORKSPACE = {
  id: "ws-1",
  name: "Acme Corp",
  slug: "acme",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

async function renderProfile(opts: {
  activeWorkspaceId?: string;
  workspaces?: (typeof WORKSPACE)[];
  workspacesLoading?: boolean;
}) {
  const { useActiveWorkspaceId, useWorkspacesQuery } = await import(
    "@/hooks/use-workspace-query"
  );

  vi.mocked(useActiveWorkspaceId).mockReturnValue(opts.activeWorkspaceId);
  vi.mocked(useWorkspacesQuery).mockReturnValue({
    data: opts.workspaces,
    isLoading: opts.workspacesLoading ?? false,
  } as unknown as ReturnType<typeof useWorkspacesQuery>);

  const { ProfilePage } = await import("./profile");
  return render(<ProfilePage />);
}

describe("ProfilePage — workspace notification preferences (KAN-212 Slice A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the section and 'For workspace: {name}' label for the active workspace", async () => {
    await renderProfile({ activeWorkspaceId: "ws-1", workspaces: [WORKSPACE] });

    expect(screen.getByText(/For workspace: Acme Corp/)).toBeInTheDocument();
    expect(screen.getByTestId("notification-preferences-section")).toHaveTextContent(
      "ws-1",
    );
  });

  it("renders a defined empty state when the user has no workspace", async () => {
    await renderProfile({ activeWorkspaceId: undefined, workspaces: [] });

    expect(
      screen.queryByTestId("notification-preferences-section"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No workspace selected.")).toBeInTheDocument();
  });

  it("renders a defined loading state while workspace resolution is pending", async () => {
    await renderProfile({
      activeWorkspaceId: undefined,
      workspaces: undefined,
      workspacesLoading: true,
    });

    expect(
      screen.queryByTestId("notification-preferences-section"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Loading workspace...")).toBeInTheDocument();
  });
});
