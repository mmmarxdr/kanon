import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { IntegrationConnection } from "@kanon/shared";
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
const mutate = vi.fn();
const idleMutation = {
  mutate,
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
};

describe("RedmineSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCreateRedmineConnectionMutation).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useCreateRedmineConnectionMutation>,
    );
    vi.mocked(useConnectRedmineCredentialMutation).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useConnectRedmineCredentialMutation>,
    );
    vi.mocked(useClearRedmineCredentialMutation).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useClearRedmineCredentialMutation>,
    );
    vi.mocked(useConfigureRedmineMutation).mockReturnValue(
      idleMutation as unknown as ReturnType<typeof useConfigureRedmineMutation>,
    );
    vi.mocked(useRedmineDiscoveryQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useRedmineDiscoveryQuery>);
  });

  it("lets an owner test and create the workspace connection", () => {
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);
    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="owner" />);

    fireEvent.change(screen.getByLabelText("Redmine URL"), {
      target: { value: "https://redmine.example.test/" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test and create connection" }));

    expect(mutate).toHaveBeenCalledWith(
      { baseUrl: "https://redmine.example.test", apiKey: "test-key" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
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
      memberCoverage: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          username: "alice",
          role: "member",
          user: { email: "alice@example.test", displayName: "Alice" },
          credential: {
            connected: true,
            status: "valid",
            externalUserId: "remote-alice",
            externalLogin: "alice",
            lastValidatedAt: "2026-08-02T18:00:00.000Z",
            revokedAt: null,
          },
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          username: "bob",
          role: "member",
          user: { email: "bob@example.test", displayName: "Bob" },
          credential: {
            connected: false,
            status: "missing",
            externalUserId: null,
            externalLogin: null,
            lastValidatedAt: null,
            revokedAt: null,
          },
        },
      ],
      counts: { workspaceMembers: 2, validCredentials: 1, externalIdentities: 1 },
    } satisfies IntegrationConnection;
    vi.mocked(useRedmineConnectionQuery).mockReturnValue({
      data: connection,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRedmineConnectionQuery>);

    render(<RedmineSection workspaceId={WORKSPACE_ID} currentUserRole="member" />);

    expect(screen.getByText("Connected as alice")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 workspace members connected")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(1);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });
});
