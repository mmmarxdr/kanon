/**
 * Settings page tab structure + a11y pairing (KAN-212 Slice C).
 * SettingsShell integration (KAN-213 Slice A).
 *
 * Covers:
 * - Owners get Projects; members keep the three shared tabs.
 * - Tab panel id / aria-labelledby pairing with TabList ids.
 * - Page chrome rendered via SettingsShell with consistent panel ids.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

vi.mock("@/features/settings/projects-section", () => ({
  ProjectsSection: () => <div data-testid="projects-section">Projects</div>,
}));

const WORKSPACE = {
  id: "ws-1",
  name: "Acme Corp",
  slug: "acme",
  allowedDomains: [],
  createdAt: "2026-01-01T00:00:00Z",
};

async function renderSettings(workspaceRole = "owner") {
  const { useActiveWorkspaceId, useWorkspacesQuery } = await import(
    "@/hooks/use-workspace-query"
  );
  const { useWorkspaceMembersQuery } = await import(
    "@/features/settings/use-settings-queries"
  );

  vi.mocked(useActiveWorkspaceId).mockReturnValue(WORKSPACE.id);
  vi.mocked(useWorkspacesQuery).mockReturnValue({
    data: [{ ...WORKSPACE, role: workspaceRole }],
    isLoading: false,
  } as unknown as ReturnType<typeof useWorkspacesQuery>);

  vi.mocked(useWorkspaceMembersQuery).mockReturnValue({
    data: [
      {
        id: "m1",
        username: "owner",
        role: "member",
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

  it("uses Workspace.role to add the owner-only Projects tab", async () => {
    await renderSettings("owner");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Invites" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Domains" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("renders exactly three tabs and no Domains tab for members", async () => {
    await renderSettings("member");

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("tab", { name: "Projects" })).not.toBeInTheDocument();
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

  it("renders workspace settings inside SettingsShell with eyebrow", async () => {
    await renderSettings("owner");

    expect(screen.getByRole("heading", { name: "Acme Corp" })).toBeInTheDocument();
    expect(screen.getByText("workspace settings")).toBeInTheDocument();
  });

  it("updates settings-panel-* id when switching tabs", async () => {
    const user = userEvent.setup();
    await renderSettings("owner");

    await user.click(screen.getByRole("tab", { name: "Invites" }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "settings-panel-invites");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-invites");
    expect(screen.getByTestId("invites-section")).toBeInTheDocument();
  });

  it("uses settings-panel-integrations id on Integrations tab", async () => {
    const user = userEvent.setup();
    await renderSettings("owner");

    await user.click(screen.getByRole("tab", { name: "Integrations" }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("id", "settings-panel-integrations");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-integrations");
    expect(screen.getByTestId("integrations-section")).toBeInTheDocument();
  });

  it("renders the project controls from the owner-only tab", async () => {
    const user = userEvent.setup();
    await renderSettings("owner");

    await user.click(screen.getByRole("tab", { name: "Projects" }));

    expect(screen.getByRole("tabpanel")).toHaveAttribute("id", "settings-panel-projects");
    expect(screen.getByTestId("projects-section")).toBeInTheDocument();
  });

  it("resets tab state when the active workspace changes", async () => {
    const user = userEvent.setup();
    const view = await renderSettings("owner");
    await user.click(screen.getByRole("tab", { name: "Integrations" }));
    const { useActiveWorkspaceId, useWorkspacesQuery } = await import(
      "@/hooks/use-workspace-query"
    );
    vi.mocked(useActiveWorkspaceId).mockReturnValue("ws-2");
    vi.mocked(useWorkspacesQuery).mockReturnValue({
      data: [{ ...WORKSPACE, id: "ws-2", name: "Other", role: "owner" }],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkspacesQuery>);

    const { SettingsPage } = await import("./settings");
    view.rerender(<SettingsPage />);

    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("members-section")).toBeInTheDocument();
  });

  it("hides project controls immediately after an ownership downgrade", async () => {
    const user = userEvent.setup();
    const view = await renderSettings("owner");
    await user.click(screen.getByRole("tab", { name: "Projects" }));
    expect(screen.getByTestId("projects-section")).toBeInTheDocument();
    const { useWorkspacesQuery } = await import("@/hooks/use-workspace-query");
    vi.mocked(useWorkspacesQuery).mockReturnValue({
      data: [{ ...WORKSPACE, role: "member" }],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkspacesQuery>);
    const { SettingsPage } = await import("./settings");

    view.rerender(<SettingsPage />);

    await waitFor(() => expect(screen.queryByTestId("projects-section")).not.toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.getByTestId("members-section")).toBeInTheDocument();
  });
});
