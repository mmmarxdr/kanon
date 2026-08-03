/**
 * Settings page tab structure + a11y pairing (KAN-212 Slice C).
 *
 * Covers:
 * - Exactly three tabs (Members, Invites, Integrations) with no Domains tab.
 * - Tab panel id / aria-labelledby pairing with TabList ids.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-workspace-query", () => ({
  useActiveWorkspaceId: vi.fn(),
  useWorkspacesQuery: vi.fn(),
}));

vi.mock("@/features/settings/use-settings-queries", () => ({
  useWorkspaceMembersQuery: vi.fn(),
}));

vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (
    selector: (s: { user: { email: string } | null }) => unknown,
  ) => selector({ user: { email: "owner@example.com" } }),
}));

vi.mock("@/features/settings/members-section", () => ({
  MembersSection: () => <div data-testid="members-section">Members</div>,
}));

vi.mock("@/features/settings/invites-section", () => ({
  InvitesSection: () => <div data-testid="invites-section">Invites</div>,
}));

vi.mock("@/features/settings/redmine-section", () => ({
  RedmineSection: () => <div data-testid="integrations-section">Integrations</div>,
}));

const WORKSPACE = {
  id: "ws-1",
  name: "Acme Corp",
  slug: "acme",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

async function renderSettings(currentUserRole = "owner") {
  const { useActiveWorkspaceId, useWorkspacesQuery } = await import(
    "@/hooks/use-workspace-query"
  );
  const { useWorkspaceMembersQuery } = await import(
    "@/features/settings/use-settings-queries"
  );

  vi.mocked(useActiveWorkspaceId).mockReturnValue(WORKSPACE.id);
  vi.mocked(useWorkspacesQuery).mockReturnValue({
    data: [WORKSPACE],
    isLoading: false,
  } as unknown as ReturnType<typeof useWorkspacesQuery>);

  vi.mocked(useWorkspaceMembersQuery).mockReturnValue({
    data: [
      {
        id: "m1",
        username: "owner",
        role: currentUserRole,
        createdAt: "2026-01-01T00:00:00Z",
        user: {
          id: "u1",
          email: "owner@example.com",
          displayName: "Owner",
          avatarUrl: null,
        },
      },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useWorkspaceMembersQuery>);

  const { SettingsPage } = await import("./settings");
  return render(<SettingsPage />);
}

describe("SettingsPage — accessible tabs (KAN-212 Slice C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("renders exactly three tabs and no Domains tab for owners", async () => {
    await renderSettings("owner");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Invites" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Domains" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("renders exactly three tabs and no Domains tab for members", async () => {
    await renderSettings("member");

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("tab", { name: "Domains" })).not.toBeInTheDocument();
  });

  it("pairs the active tabpanel id with tab aria-controls and aria-labelledby", async () => {
    await renderSettings("owner");

    const membersTab = screen.getByRole("tab", { name: "Members" });
    const panel = screen.getByRole("tabpanel");

    expect(membersTab).toHaveAttribute("id", "settings-tab-members");
    expect(membersTab).toHaveAttribute("aria-controls", "settings-panel-members");
    expect(panel).toHaveAttribute("id", "settings-panel-members");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-members");
    expect(screen.getByTestId("members-section")).toBeInTheDocument();
  });
});
