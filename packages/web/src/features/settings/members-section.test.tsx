import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Stub FocusTrap for the modal
vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock settings queries
vi.mock("./use-settings-queries", () => ({
  useWorkspaceMembersQuery: vi.fn(),
  useRemoveMemberMutation: vi.fn(),
  useChangeMemberRoleMutation: vi.fn(),
  useGenerateOnboardingInviteMutation: vi.fn(),
}));

// Mock auth store — current user
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: vi.fn((selector: (s: { user: { email: string } }) => unknown) =>
    selector({ user: { email: "admin@example.com" } }),
  ),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const WORKSPACE_ID = "ws-test-123";

const MEMBERS = [
  {
    id: "m1",
    username: "alice",
    role: "member",
    createdAt: "2026-01-01T00:00:00Z",
    user: { email: "alice@example.com", displayName: "Alice", avatarUrl: null },
  },
  {
    id: "m2",
    username: "bob",
    role: "admin",
    createdAt: "2026-01-02T00:00:00Z",
    user: { email: "admin@example.com", displayName: "Bob", avatarUrl: null },
  },
];

async function renderMembersSection(currentUserRole = "admin") {
  const {
    useWorkspaceMembersQuery,
    useRemoveMemberMutation,
    useChangeMemberRoleMutation,
    useGenerateOnboardingInviteMutation,
  } = await import("./use-settings-queries");

  vi.mocked(useWorkspaceMembersQuery).mockReturnValue({
    data: MEMBERS,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useWorkspaceMembersQuery>);

  vi.mocked(useRemoveMemberMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useRemoveMemberMutation>);

  vi.mocked(useChangeMemberRoleMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useChangeMemberRoleMutation>);

  vi.mocked(useGenerateOnboardingInviteMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGenerateOnboardingInviteMutation>);

  const { MembersSection } = await import("./members-section");
  const wrapper = createWrapper();
  render(
    <MembersSection
      workspaceId={WORKSPACE_ID}
      currentUserRole={currentUserRole}
    />,
    { wrapper },
  );
}

describe("MembersSection — Generate onboarding link button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders 'Generate onboarding link' button for each member when current user is admin", async () => {
    await renderMembersSection("admin");
    const buttons = screen.getAllByTestId(/^onboarding-gen-btn-/);
    expect(buttons.length).toBe(MEMBERS.length);
  });

  it("does NOT render 'Generate onboarding link' buttons for non-admin users", async () => {
    await renderMembersSection("member");
    expect(screen.queryAllByTestId(/^onboarding-gen-btn-/).length).toBe(0);
  });

  it("clicking the button calls useGenerateOnboardingInviteMutation.mutate with correct userId", async () => {
    await renderMembersSection("admin");

    const { useGenerateOnboardingInviteMutation } = await import("./use-settings-queries");
    const mutateMock = vi.mocked(useGenerateOnboardingInviteMutation).mock.results[0]
      ?.value.mutate as ReturnType<typeof vi.fn>;

    const btn = screen.getByTestId(`onboarding-gen-btn-${MEMBERS[0]!.id}`);
    fireEvent.click(btn);

    expect(mutateMock).toHaveBeenCalledWith(
      { userId: MEMBERS[0]!.id },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("opens OnboardingLinkModal with returned URL on mutation success", async () => {
    const { useGenerateOnboardingInviteMutation } = await import("./use-settings-queries");

    const successUrl = "kanon://server.example.com/onboard?token=abc123";
    const successExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    // Mock mutate to immediately call onSuccess
    vi.mocked(useGenerateOnboardingInviteMutation).mockReturnValue({
      mutate: vi.fn((_input, opts) => {
        opts?.onSuccess?.({ url: successUrl, token: "rawtoken", expiresAt: successExpiresAt, inviteId: "inv-1" });
      }),
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useGenerateOnboardingInviteMutation>);

    const {
      useWorkspaceMembersQuery,
      useRemoveMemberMutation,
      useChangeMemberRoleMutation,
    } = await import("./use-settings-queries");

    vi.mocked(useWorkspaceMembersQuery).mockReturnValue({
      data: MEMBERS,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useWorkspaceMembersQuery>);

    vi.mocked(useRemoveMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useRemoveMemberMutation>);

    vi.mocked(useChangeMemberRoleMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useChangeMemberRoleMutation>);

    const { MembersSection } = await import("./members-section");
    const wrapper = createWrapper();
    render(
      <MembersSection workspaceId={WORKSPACE_ID} currentUserRole="admin" />,
      { wrapper },
    );

    fireEvent.click(screen.getByTestId(`onboarding-gen-btn-${MEMBERS[0]!.id}`));

    await waitFor(() => {
      expect(screen.getByTestId("onboarding-link-modal")).toBeInTheDocument();
    });
    expect(screen.getByTestId("onboarding-url")).toHaveTextContent(successUrl);
  });
});
