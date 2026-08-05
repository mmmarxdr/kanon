import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("./use-settings-queries", () => ({
  useWorkspaceInvitesQuery: vi.fn(),
  useCreateInviteMutation: vi.fn(),
  useRevokeInviteMutation: vi.fn(),
}));

vi.mock("@/hooks/use-projects-query", () => ({
  useProjectsQuery: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-query", () => ({
  useWorkspacesQuery: vi.fn(),
}));

vi.mock("./invite-domain-restriction", () => ({
  InviteDomainRestriction: () => null,
}));

const projects = [
  { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", key: "ENG", name: "Engram", description: null },
  { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", key: "KAN", name: "Kanon", description: null },
];

async function renderSection(mutate = vi.fn()) {
  const {
    useWorkspaceInvitesQuery,
    useCreateInviteMutation,
    useRevokeInviteMutation,
  } = await import("./use-settings-queries");
  const { useProjectsQuery } = await import("@/hooks/use-projects-query");
  const { useWorkspacesQuery } = await import("@/hooks/use-workspace-query");

  vi.mocked(useWorkspaceInvitesQuery).mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useWorkspaceInvitesQuery>);
  vi.mocked(useProjectsQuery).mockReturnValue({
    data: projects,
    isLoading: false,
  } as unknown as ReturnType<typeof useProjectsQuery>);
  vi.mocked(useWorkspacesQuery).mockReturnValue({
    data: [
      { id: "workspace-1", name: "Primary", slug: "primary", role: "admin", allowedDomains: [], createdAt: "" },
      { id: "workspace-2", name: "Client", slug: "client", role: "owner", allowedDomains: [], createdAt: "" },
    ],
    isLoading: false,
  } as unknown as ReturnType<typeof useWorkspacesQuery>);
  vi.mocked(useCreateInviteMutation).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useCreateInviteMutation>);
  vi.mocked(useRevokeInviteMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useRevokeInviteMutation>);

  const { InvitesSection } = await import("./invites-section");
  render(
    <InvitesSection
      workspaceId="workspace-1"
      currentUserRole="admin"
      allowedDomains={[]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create Invite" }));

  return mutate;
}

describe("InvitesSection project access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to workspace projectAccess with no assignments", async () => {
    const mutate = await renderSection();

    fireEvent.click(screen.getByRole("button", { name: "Create Invite Link" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectAccess: "workspace",
        projectAssignments: undefined,
      }),
      expect.any(Object),
    );
  });

  it("assigns all current projects using the invite role", async () => {
    const mutate = await renderSection();

    fireEvent.change(screen.getByTestId("invite-project-access"), {
      target: { value: "all" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite Link" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "member",
        projectAccess: "assigned",
        projectAssignments: projects.map((project) => ({
          projectId: project.id,
          role: "member",
        })),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("assigns only checked projects", async () => {
    const mutate = await renderSection();

    fireEvent.change(screen.getByTestId("invite-project-access"), {
      target: { value: "selected" },
    });
    fireEvent.click(screen.getByLabelText("Engram (ENG)"));
    fireEvent.click(screen.getByRole("button", { name: "Create Invite Link" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectAccess: "assigned",
        projectAssignments: [{ projectId: projects[0]!.id, role: "member" }],
      }),
      expect.any(Object),
    );
  });

  it("lets admins pick a target workspace", async () => {
    const mutate = await renderSection();

    fireEvent.change(screen.getByTestId("invite-target-workspace"), {
      target: { value: "workspace-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Invite Link" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-2", projectAccess: "workspace" }),
      expect.any(Object),
    );
  });
});
