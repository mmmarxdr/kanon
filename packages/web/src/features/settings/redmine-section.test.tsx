import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { IntegrationConnection } from "@kanon/shared";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useWorkspacesQuery } from "@/hooks/use-workspace-query";
import {
  useBindRedmineProjectMutation,
  useClearRedmineCredentialMutation,
  useConnectRedmineCredentialMutation,
  useRedmineConnectionQuery,
  useRedmineDiscoveryQuery,
  useReplaceRedmineServiceCredentialMutation,
} from "./use-redmine-integration";
import { AdminRedmineSection } from "./admin-redmine-section";
import { RedmineSection } from "./redmine-section";

vi.mock("./use-redmine-integration", () => ({
  useBindRedmineProjectMutation: vi.fn(),
  useClearRedmineCredentialMutation: vi.fn(),
  useConnectRedmineCredentialMutation: vi.fn(),
  useCreateRedmineConnectionMutation: vi.fn(),
  useRedmineConnectionQuery: vi.fn(),
  useRedmineDiscoveryQuery: vi.fn(),
  useReplaceRedmineServiceCredentialMutation: vi.fn(),
}));

vi.mock("@/hooks/use-projects-query", () => ({ useProjectsQuery: vi.fn() }));
vi.mock("@/hooks/use-workspace-query", () => ({ useWorkspacesQuery: vi.fn() }));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const connectMutate = vi.fn();
const clearMutate = vi.fn();
const bindMutate = vi.fn();
const replaceServiceMutate = vi.fn();
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
const healthyConnection: IntegrationConnection = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: WORKSPACE_ID,
  provider: "redmine",
  baseUrl: "https://redmine.example.test",
  lifecycle: "active",
  lifecycleEpoch: 1,
  serviceFallbackEnabled: false,
  serviceCredentialStatus: "valid",
  syncHealth: { status: "healthy", blockedWork: null },
  discoveredStatuses: null,
  providerMaps: null,
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
};

describe("RedmineSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(useBindRedmineProjectMutation).mockReturnValue(
      idleMutation(bindMutate) as unknown as ReturnType<typeof useBindRedmineProjectMutation>,
    );
    vi.mocked(useReplaceRedmineServiceCredentialMutation).mockReturnValue(
      idleMutation(replaceServiceMutate) as unknown as ReturnType<
        typeof useReplaceRedmineServiceCredentialMutation
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
    vi.mocked(useWorkspacesQuery).mockReturnValue({
      data: [{ id: WORKSPACE_ID, name: "Kanon", slug: "kanon", role: "owner" }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useWorkspacesQuery>);
  });

  it("tells workspace users that instance admin must configure Redmine", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={[]} />);

    expect(screen.getByText(/instance admin has not configured Redmine/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test and create connection/i })).not.toBeInTheDocument();
  });

  it("shows personal identity and workspace coverage to a member", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: healthyConnection,
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
    expect(screen.queryByText("Link Redmine project")).not.toBeInTheDocument();
  });

  it("lets an owner associate a Kanon project with a discovered Redmine project", () => {
    const connection = {
      ...healthyConnection,
      lifecycle: "draft",
      lifecycleEpoch: 0,
      connectedMemberIds: [],
      counts: { workspaceMembers: 1, validCredentials: 1, externalIdentities: 0 },
    } satisfies IntegrationConnection;
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: connection,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: {
        statuses: [],
        priorities: [],
        projects: [{ id: "remote-project", name: "Remote project" }],
        timeEntryActivities: [],
      },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );

    expect(screen.getByText("Link Redmine project")).toBeInTheDocument();
    expect(screen.queryByText("Redmine to Kanon")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save project link" }));
    expect(bindMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
    });
  });

  it("shows members a safe blocked state without cross-user details", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: {
        ...healthyConnection,
        serviceCredentialStatus: "invalid",
        syncHealth: { status: "credential_blocked", blockedWork: null },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="member" members={members} />,
    );

    expect(screen.getByText("Redmine sync needs attention")).toBeInTheDocument();
    expect(screen.getByText(/ask the credential owner or an instance admin/i)).toBeInTheDocument();
    expect(screen.queryByText(/blocked sync operations/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /blocked sync operations/i })).not.toBeInTheDocument();
  });

  it("offers personal replacement and caps owner health details at 20", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `${String(index + 1).padStart(8, "0")}-6666-4666-8666-666666666666`,
      entityType: "issue",
      entityId: `${String(index + 1).padStart(8, "0")}-7777-4777-8777-777777777777`,
      operation: "update" as const,
      state: "dead" as const,
      updatedAt: "2026-08-04T10:00:00.000Z",
    }));
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: {
        ...healthyConnection,
        callerCredential: {
          ...healthyConnection.callerCredential,
          connected: false,
          status: "invalid",
        },
        syncHealth: {
          status: "credential_blocked",
          blockedWork: { total: 23, items },
        },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );

    expect(screen.getByText(/Redmine rejected your API key/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace key" })).toBeInTheDocument();
    expect(screen.getByText("23 blocked sync operations")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(20);
  });

  it("lets an instance admin replace the service key when discovery is blocked", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: {
        ...healthyConnection,
        serviceCredentialStatus: "valid",
        syncHealth: { status: "healthy", blockedWork: { total: 0, items: [] } },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("Redmine connection failed"),
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);

    render(<AdminRedmineSection redmineBaseUrl="https://redmine.example.test" />);
    fireEvent.change(screen.getByLabelText("Service API key"), {
      target: { value: "replacement-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace service key" }));

    expect(replaceServiceMutate).toHaveBeenCalledWith(
      "replacement-key",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getByText("Redmine connection failed")).toBeInTheDocument();
  });
});
