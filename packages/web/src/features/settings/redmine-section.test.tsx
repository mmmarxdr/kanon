import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { IntegrationConnection } from "@kanon/shared";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import {
  useClearRedmineCredentialMutation,
  useConfigureRedmineMutation,
  useConnectRedmineCredentialMutation,
  useCreateRedmineConnectionMutation,
  useRedmineConnectionQuery,
  useRedmineDiscoveryQuery,
} from "./use-redmine-integration";
import { RedmineSection } from "./redmine-section";

vi.mock("./use-redmine-integration", () => ({
  useClearRedmineCredentialMutation: vi.fn(),
  useConfigureRedmineMutation: vi.fn(),
  useConnectRedmineCredentialMutation: vi.fn(),
  useCreateRedmineConnectionMutation: vi.fn(),
  useRedmineConnectionQuery: vi.fn(),
  useRedmineDiscoveryQuery: vi.fn(),
}));

vi.mock("@/hooks/use-projects-query", () => ({ useProjectsQuery: vi.fn() }));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const createMutate = vi.fn();
const connectMutate = vi.fn();
const clearMutate = vi.fn();
const configureMutate = vi.fn();
const idleMutation = (mutate: ReturnType<typeof vi.fn>) => ({
  mutate,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
});
const members = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    username: "alice",
    role: "member",
    createdAt: "2026-08-01T00:00:00.000Z",
    user: {
      id: "77777777-7777-4777-8777-777777777777",
      email: "alice@example.test",
      displayName: "Alice",
      avatarUrl: null,
    },
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    username: "bob",
    role: "member",
    createdAt: "2026-08-02T00:00:00.000Z",
    user: {
      id: "88888888-8888-4888-8888-888888888888",
      email: "bob@example.test",
      displayName: "Bob",
      avatarUrl: null,
    },
  },
];

describe("RedmineSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCreateRedmineConnectionMutation).mockReturnValue(
      idleMutation(createMutate) as unknown as ReturnType<
        typeof useCreateRedmineConnectionMutation
      >,
    );
    vi.mocked(useConnectRedmineCredentialMutation).mockReturnValue(
      idleMutation(connectMutate) as unknown as ReturnType<
        typeof useConnectRedmineCredentialMutation
      >,
    );
    vi.mocked(useClearRedmineCredentialMutation).mockReturnValue(
      idleMutation(clearMutate) as unknown as ReturnType<
        typeof useClearRedmineCredentialMutation
      >,
    );
    vi.mocked(useConfigureRedmineMutation).mockReturnValue(
      idleMutation(configureMutate) as unknown as ReturnType<
        typeof useConfigureRedmineMutation
      >,
    );
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: [{ id: PROJECT_ID, key: "KAN", name: "Kanon", description: null }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectsQuery>);
  });

  it("lets an owner test and create the workspace connection", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={[]} />);

    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test and create connection" }));

    expect(createMutate).toHaveBeenCalledWith(
      "test-key",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.queryByLabelText("Redmine URL")).not.toBeInTheDocument();
  });

  it("shows personal identity and workspace coverage to a member", () => {
    const connection = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: WORKSPACE_ID,
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      lifecycle: "active",
      lifecycleEpoch: 1,
      serviceFallbackEnabled: false,
      discoveredStatuses: [],
      bindings: [],
      callerCredential: {
        connected: true,
        status: "valid",
        externalUserId: "remote-alice",
        externalLogin: "alice",
        lastValidatedAt: "2026-08-02T18:00:00.000Z",
        revokedAt: null,
      },
      connectedMemberIds: [members[0]!.id],
      counts: { workspaceMembers: 2, validCredentials: 1, externalIdentities: 1 },
    } satisfies IntegrationConnection;
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: connection,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="member" members={members} />,
    );

    expect(screen.getByText("Connected as alice")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 workspace members connected")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(1);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("prefills and submits a complete owner mapping from discovery", () => {
    const connection = {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: WORKSPACE_ID,
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      lifecycle: "draft",
      lifecycleEpoch: 0,
      serviceFallbackEnabled: false,
      discoveredStatuses: [],
      bindings: [],
      callerCredential: {
        connected: true,
        status: "valid",
        externalUserId: "remote-owner",
        externalLogin: "owner",
        lastValidatedAt: "2026-08-02T18:00:00.000Z",
        revokedAt: null,
      },
      connectedMemberIds: [members[0]!.id],
      counts: { workspaceMembers: 2, validCredentials: 1, externalIdentities: 0 },
    } satisfies IntegrationConnection;
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: connection,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: {
        statuses: [
          { id: "new", name: "New", writable: true },
          { id: "progress", name: "In Progress", writable: true },
          { id: "closed", name: "Closed", writable: true },
        ],
        projects: [{ id: "remote-project", name: "Remote project" }],
        timeEntryActivities: [{ id: "9", name: "Development", isDefault: true }],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and activate" }));

    expect(configureMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
      timeActivityId: "9",
      readMap: { new: "backlog", progress: "in_progress", closed: "done" },
      writeMap: {
        backlog: "new",
        analysis: "new",
        todo: "progress",
        in_progress: "progress",
        review: "closed",
        done: "closed",
      },
    });
  });
});
