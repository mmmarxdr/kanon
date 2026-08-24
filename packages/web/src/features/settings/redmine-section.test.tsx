import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { IntegrationConnection } from "@kanon/shared";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import {
  useBindRedmineProjectMutation,
  useClearRedmineCredentialMutation,
  useConfigureRedmineProviderMapsMutation,
  useConnectRedmineCredentialMutation,
  useCreateRedmineConnectionMutation,
  useRedmineConnectionQuery,
  useRedmineAuditHealthQuery,
  useRedmineDiscoveryQuery,
  useReplaceRedmineServiceCredentialMutation,
  useSetRedmineLifecycleMutation,
  useUnbindRedmineProjectMutation,
} from "./use-redmine-integration";
import { RedmineSection } from "./redmine-section";

const modalRender = vi.hoisted(() => vi.fn());
vi.mock("./redmine-reconciliation-modal", () => ({ RedmineReconciliationModal: (props: unknown) => { modalRender(props); return <div data-testid="redmine-reconciliation-modal" />; } }));

vi.mock("./use-redmine-integration", () => ({
  useBindRedmineProjectMutation: vi.fn(),
  useClearRedmineCredentialMutation: vi.fn(),
  useConfigureRedmineProviderMapsMutation: vi.fn(),
  useConnectRedmineCredentialMutation: vi.fn(),
  useCreateRedmineConnectionMutation: vi.fn(),
  useRedmineConnectionQuery: vi.fn(),
  useRedmineAuditHealthQuery: vi.fn(),
  useRedmineDiscoveryQuery: vi.fn(),
  useReplaceRedmineServiceCredentialMutation: vi.fn(),
  useSetRedmineLifecycleMutation: vi.fn(),
  useUnbindRedmineProjectMutation: vi.fn(),
}));

vi.mock("@/hooks/use-projects-query", () => ({ useProjectsQuery: vi.fn() }));

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const connectMutate = vi.fn();
const createMutate = vi.fn();
const clearMutate = vi.fn();
const bindMutate = vi.fn();
const unbindMutate = vi.fn();
const configureMutate = vi.fn();
const replaceServiceMutate = vi.fn();
const lifecycleMutate = vi.fn();
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
  serviceCredentialIsCaller: false,
  syncHealth: { status: "healthy", blockedWork: null },
  discoveredStatuses: null,
  providerMaps: null,
  privacyRecovery: [],
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
    vi.mocked(useCreateRedmineConnectionMutation).mockReturnValue(
      idleMutation(createMutate) as unknown as ReturnType<
        typeof useCreateRedmineConnectionMutation
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
    vi.mocked(useUnbindRedmineProjectMutation).mockReturnValue(
      idleMutation(unbindMutate) as unknown as ReturnType<
        typeof useUnbindRedmineProjectMutation
      >,
    );
    vi.mocked(useConfigureRedmineProviderMapsMutation).mockReturnValue(
      idleMutation(configureMutate) as unknown as ReturnType<
        typeof useConfigureRedmineProviderMapsMutation
      >,
    );
    vi.mocked(useReplaceRedmineServiceCredentialMutation).mockReturnValue(
      idleMutation(replaceServiceMutate) as unknown as ReturnType<
        typeof useReplaceRedmineServiceCredentialMutation
      >,
    );
    vi.mocked(useSetRedmineLifecycleMutation).mockReturnValue(
      idleMutation(lifecycleMutate) as unknown as ReturnType<
        typeof useSetRedmineLifecycleMutation
      >,
    );
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);
    vi.mocked(useRedmineAuditHealthQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineAuditHealthQuery>);
    vi.mocked(useProjectsQuery).mockReturnValue({
      data: [{ id: PROJECT_ID, key: "KAN", name: "Kanon", description: null }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectsQuery>);
  });

  it("keeps connection bootstrap hidden from members", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="member" members={[]} />);

    expect(screen.getByText(/workspace owner has not connected Redmine/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test and create connection/i })).not.toBeInTheDocument();
  });

  it("keeps audit health hidden from members", () => {
    const binding = {
      id: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      timeActivityId: null,
      lifecycle: "active" as const,
      lifecycleEpoch: 1,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releasePending: false,
    };
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: { ...healthyConnection, bindings: [binding] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="member" members={members} />,
    );

    expect(screen.queryByRole("region", { name: /audit health/i })).not.toBeInTheDocument();
    expect(useRedmineAuditHealthQuery).not.toHaveBeenCalled();
  });

  it("shows every binding's fresh scoped evidence to an owner without provider details", () => {
    const binding = {
      id: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      timeActivityId: null,
      lifecycle: "active" as const,
      lifecycleEpoch: 1,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releasePending: false,
    };
    const secondBinding = { ...binding, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: { ...healthyConnection, bindings: [binding, secondBinding] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineAuditHealthQuery).mockReturnValue({
      data: {
        state: "complete",
        completedAt: "2099-01-01T12:00:00.000Z",
        validUntil: "2099-01-01T12:05:00.000Z",
        fresh: true,
        reasonCode: null,
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineAuditHealthQuery>);

    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);

    expect(screen.getByRole("region", { name: /audit health.*binding 1/i })).toHaveTextContent(
      /current scoped audit evidence is fresh/i,
    );
    expect(screen.getByRole("region", { name: /audit health.*binding 2/i })).toHaveTextContent(
      /current scoped audit evidence is fresh/i,
    );
    expect(useRedmineAuditHealthQuery).toHaveBeenCalledWith(
      WORKSPACE_ID,
      healthyConnection.id,
      binding.id,
      true,
    );
    expect(useRedmineAuditHealthQuery).toHaveBeenCalledWith(
      WORKSPACE_ID,
      healthyConnection.id,
      secondBinding.id,
      true,
    );
  });

  it("fails closed for unknown audit health without exposing query errors", () => {
    const binding = {
      id: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      timeActivityId: null,
      lifecycle: "active" as const,
      lifecycleEpoch: 1,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releasePending: false,
    };
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: { ...healthyConnection, bindings: [binding] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineAuditHealthQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("https://redmine.example.test/issues/42?key=secret"),
    } as unknown as ReturnType<typeof useRedmineAuditHealthQuery>);

    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);

    const health = screen.getByRole("region", { name: /audit health/i });
    expect(health).toHaveTextContent(/audit evidence is unavailable/i);
    expect(health).toHaveTextContent(/does not confirm deletion or global absence/i);
    expect(health).not.toHaveTextContent("key=secret");
  });

  it("expires cached fresh evidence locally when refresh does not occur", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:04:00.000Z"));
    const binding = {
      id: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      timeActivityId: null,
      lifecycle: "active" as const,
      lifecycleEpoch: 1,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releasePending: false,
    };
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: { ...healthyConnection, bindings: [binding] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineAuditHealthQuery).mockReturnValue({
      data: {
        state: "complete",
        completedAt: "2026-08-14T12:00:00.000Z",
        validUntil: "2026-08-14T12:05:00.000Z",
        fresh: true,
        reasonCode: null,
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineAuditHealthQuery>);

    try {
      render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);
      act(() => vi.advanceTimersByTime(60_000));

      const health = screen.getByRole("region", { name: /audit health/i });
      expect(health).toHaveTextContent(/audit evidence is stale/i);
      expect(health).toHaveTextContent(/does not confirm deletion or global absence/i);
      expect(health).not.toHaveTextContent(/current scoped audit evidence is fresh/i);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets an owner bootstrap the active workspace connection", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={[]} />);
    fireEvent.change(screen.getByTestId("admin-redmine-api-key"), {
      target: { value: "service-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /test and create connection/i }));

    expect(createMutate).toHaveBeenCalledWith(
      "service-key",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
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

  it("warns that a draft connection is not synchronizing", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: {
        ...healthyConnection,
        lifecycle: "draft",
        syncHealth: { status: "inactive", blockedWork: null },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );

    expect(screen.getByText("Redmine sync is inactive")).toBeInTheDocument();
    expect(screen.getByText(/no issues or time entries are being synchronized/i)).toBeInTheDocument();
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
    expect(screen.getByText("Redmine to Kanon")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save project link" }));
    expect(bindMutate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
    });
  });

  it("lets an owner explicitly unlink a project binding", () => {
    const binding = {
      id: "99999999-9999-4999-8999-999999999999",
      projectId: PROJECT_ID,
      remoteProjectId: "remote-project",
      readMap: {},
      writeMap: {},
      timeActivityId: null,
      lifecycle: "active" as const,
      lifecycleEpoch: 1,
      commentCaptureEnabled: false,
      commentDispatchEnabled: false,
      releasePending: false,
    };
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: { ...healthyConnection, bindings: [binding] },
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);
    fireEvent.click(screen.getByRole("button", { name: "Unlink project" }));

    expect(unbindMutate).toHaveBeenCalledWith(binding.id);
    confirm.mockRestore();
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
    expect(screen.getByText(/ask the credential owner or a workspace owner/i)).toBeInTheDocument();
    expect(screen.queryByText(/blocked sync operations/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /blocked sync operations/i })).not.toBeInTheDocument();
  });

  it("warns owners when a private comment write may have escaped", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: {
        ...healthyConnection,
        syncHealth: {
          status: "attention_required",
          blockedWork: {
            total: 1,
            items: [
              {
                id: "66666666-6666-4666-8666-666666666666",
                entityType: "comment",
                entityId: "77777777-7777-4777-8777-777777777777",
                operation: "create",
                state: "dead",
                reason: "private-comment-write-uncertain",
                updatedAt: "2026-08-10T10:00:00.000Z",
              },
            ],
          },
        },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);

    expect(screen.getByText(/private Redmine comment may have been sent before redaction/i)).toBeInTheDocument();
    expect(screen.getByText("1 blocked sync operation")).toBeInTheDocument();
  });

  it("offers personal replacement and caps owner health details at 20", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      id: `${String(index + 1).padStart(8, "0")}-6666-4666-8666-666666666666`,
      entityType: "issue",
      entityId: `${String(index + 1).padStart(8, "0")}-7777-4777-8777-777777777777`,
      operation: "update" as const,
      state: "dead" as const,
      reason: "credential_invalid" as const,
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

  it("does not offer to disconnect the caller when it is the workspace service credential", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: { ...healthyConnection, serviceCredentialIsCaller: true },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );

    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace service key" })).toBeInTheDocument();
  });

  it("lets a workspace owner replace the service key when discovery is blocked", () => {
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

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );
    fireEvent.change(screen.getByLabelText("Service API key"), {
      target: { value: "replacement-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace service key" }));

    expect(replaceServiceMutate).toHaveBeenCalledWith(
      "replacement-key",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(screen.getAllByText("Redmine connection failed").length).toBeGreaterThan(0);
  });

  it("keeps lifecycle controls available when discovery is blocked", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: healthyConnection,
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

    render(
      <RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />,
    );
    fireEvent.change(screen.getByLabelText("Connection lifecycle"), {
      target: { value: "paused" },
    });

    expect(lifecycleMutate).toHaveBeenCalledWith("paused");
  });

  it("queues draft activation bindings in server order while paused activation stays direct", () => {
    const binding = { id: "99999999-9999-4999-8999-999999999999", projectId: PROJECT_ID, remoteProjectId: "remote-project", readMap: {}, writeMap: {}, timeActivityId: "1", lifecycle: "draft" as const, lifecycleEpoch: 0, commentCaptureEnabled: false, commentDispatchEnabled: false, releasePending: false };
    const releasing = { ...binding, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", releasePending: true };
    const second = { ...binding, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", projectId: "44444444-4444-4444-8444-444444444444", remoteProjectId: "remote-2" };
    const connection = { ...healthyConnection, lifecycle: "draft" as const, providerMaps: { readMap: null, writeMap: null, priorityReadMap: null, priorityWriteMap: null, timeActivityId: "1" }, bindings: [binding, releasing, second] };
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({ data: connection, isLoading: false, error: null } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useProjectsQuery).mockReturnValue({ data: [{ id: PROJECT_ID, key: "KAN", name: "Kanon One", description: null }], isLoading: false, error: null } as unknown as ReturnType<typeof useProjectsQuery>);
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({ data: { statuses: [], priorities: [], projects: [{ id: "remote-project", name: "Redmine One" }], timeEntryActivities: [] }, isLoading: false, isFetching: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);
    const view = render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);
    const select = screen.getByLabelText("Connection lifecycle") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "active" } });
    expect(lifecycleMutate).not.toHaveBeenCalled();
    expect(select.value).toBe("draft");
    const props = modalRender.mock.lastCall?.[0] as { queue: Array<Record<string, string>> };
    expect(props.queue).toEqual([
      expect.objectContaining({ bindingId: binding.id, projectName: "Kanon One", remoteProjectName: "Redmine One" }),
      expect.objectContaining({ bindingId: second.id, projectName: second.projectId, remoteProjectName: second.remoteProjectId }),
    ]);
    view.unmount();
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({ data: { ...connection, lifecycle: "paused" }, isLoading: false, error: null } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" members={members} />);
    fireEvent.change(screen.getByLabelText("Connection lifecycle"), { target: { value: "active" } });
    expect(lifecycleMutate).toHaveBeenCalledWith("active");
  });

  it("replaces stale outbound priority mappings with discovered priorities", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: {
        ...healthyConnection,
        lifecycle: "draft",
        providerMaps: {
          timeActivityId: "9",
          readMap: { new: "backlog" },
          writeMap: {
            backlog: "new",
            analysis: "new",
            todo: "new",
            in_progress: "new",
            review: "new",
            done: "new",
          },
          priorityReadMap: { normal: "medium" },
          priorityWriteMap: {
            critical: "removed",
            high: "removed",
            medium: "removed",
            low: "removed",
          },
        },
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: {
        statuses: [{ id: "new", name: "New", writable: true }],
        priorities: [{ id: "normal", name: "Normal" }],
        projects: [],
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
    fireEvent.click(screen.getByRole("button", { name: "Save provider maps" }));

    expect(configureMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        priorityWriteMap: {
          critical: "normal",
          high: "normal",
          medium: "normal",
          low: "normal",
        },
      }),
    );
  });
});
