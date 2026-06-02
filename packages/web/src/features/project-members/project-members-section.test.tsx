import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EffectiveMemberRow } from "./use-project-members-queries";

// Stub FocusTrap for any modal
vi.mock("focus-trap-react", () => ({
  FocusTrap: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock project-members queries
vi.mock("./use-project-members-queries", () => ({
  useProjectMembersQuery: vi.fn(),
  useAddProjectMemberMutation: vi.fn(),
  useChangeProjectMemberRoleMutation: vi.fn(),
  useRemoveProjectMemberMutation: vi.fn(),
}));

// Mock auth store — current user identified by id
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: vi.fn(
    (selector: (s: { user: { id: string; email: string } }) => unknown) =>
      selector({ user: { id: "u-admin", email: "admin@example.com" } }),
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

const PROJECT_KEY = "MY-PROJECT";

// Explicit member (source:'project', has pmId) — current user, admin
const ADMIN_ROW: EffectiveMemberRow = {
  userId: "u-admin",
  email: "admin@example.com",
  displayName: "Admin User",
  role: "admin",
  source: "project",
  pmId: "pm-1",
};

// Explicit member (source:'project', has pmId) — another member
const MEMBER_ROW: EffectiveMemberRow = {
  userId: "u-alice",
  email: "alice@example.com",
  displayName: "Alice",
  role: "member",
  source: "project",
  pmId: "pm-2",
};

// Implicit member (source:'workspace', no pmId) — workspace admin
const IMPLICIT_ROW: EffectiveMemberRow = {
  userId: "u-bob",
  email: "bob@example.com",
  displayName: "Bob",
  role: "admin",
  source: "workspace",
  implicit: true,
};

// Owner row
const OWNER_ROW: EffectiveMemberRow = {
  userId: "u-owner",
  email: "owner@example.com",
  displayName: "Owner",
  role: "owner",
  source: "project",
  pmId: "pm-owner",
};

async function renderSection(members: EffectiveMemberRow[] = [ADMIN_ROW, MEMBER_ROW, IMPLICIT_ROW]) {
  const {
    useProjectMembersQuery,
    useAddProjectMemberMutation,
    useChangeProjectMemberRoleMutation,
    useRemoveProjectMemberMutation,
  } = await import("./use-project-members-queries");

  vi.mocked(useProjectMembersQuery).mockReturnValue({
    data: members,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProjectMembersQuery>);

  vi.mocked(useAddProjectMemberMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  } as unknown as ReturnType<typeof useAddProjectMemberMutation>);

  vi.mocked(useChangeProjectMemberRoleMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useChangeProjectMemberRoleMutation>);

  vi.mocked(useRemoveProjectMemberMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useRemoveProjectMemberMutation>);

  const { ProjectMembersSection } = await import("./project-members-section");
  const wrapper = createWrapper();
  render(<ProjectMembersSection projectKey={PROJECT_KEY} />, { wrapper });
}

describe("ProjectMembersSection — row rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("explicit rows (source:project) show role select and remove button for admin", async () => {
    await renderSection();
    // MEMBER_ROW (alice) is explicit and not current user — should have controls
    const aliceRow = screen.getByTestId("member-row-pm-2");
    expect(aliceRow.querySelector("select")).toBeTruthy();
    expect(
      screen.getByTestId("remove-btn-pm-2"),
    ).toBeInTheDocument();
  });

  it("implicit rows (source:workspace) show badge and NO role select or remove button", async () => {
    await renderSection();
    // IMPLICIT_ROW (bob) has no pmId — badge only
    expect(screen.getByTestId("implicit-badge-u-bob")).toBeInTheDocument();
    // No select or remove for implicit row
    const implicitRow = screen.getByTestId("member-row-u-bob");
    expect(implicitRow.querySelector("select")).toBeNull();
    expect(screen.queryByTestId("remove-btn-u-bob")).toBeNull();
  });

  it("non-admin (member role) sees NO role selects and NO remove buttons", async () => {
    // Render with current user as a plain member
    const memberAsCurrentUser: EffectiveMemberRow = {
      userId: "u-admin",
      email: "admin@example.com",
      displayName: "Admin User",
      role: "member",
      source: "project",
      pmId: "pm-1",
    };
    await renderSection([memberAsCurrentUser, MEMBER_ROW]);
    // No selects, no remove buttons anywhere
    expect(document.querySelectorAll("select").length).toBe(0);
    expect(screen.queryAllByTestId(/^remove-btn-/).length).toBe(0);
  });
});

describe("ProjectMembersSection — role change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("changing role select calls changeRole.mutate with { pmId, role }", async () => {
    await renderSection();

    const { useChangeProjectMemberRoleMutation } = await import(
      "./use-project-members-queries"
    );
    const mutateMock = vi.mocked(useChangeProjectMemberRoleMutation).mock
      .results[0]?.value.mutate as ReturnType<typeof vi.fn>;

    const select = screen
      .getByTestId("member-row-pm-2")
      .querySelector("select") as HTMLSelectElement;

    fireEvent.change(select, { target: { value: "admin" } });

    expect(mutateMock).toHaveBeenCalledWith({
      pmId: "pm-2",
      role: "admin",
    });
  });
});

describe("ProjectMembersSection — remove flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicking remove shows confirm/cancel buttons", async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId("remove-btn-pm-2"));
    expect(screen.getByTestId("confirm-remove-pm-2")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-remove-pm-2")).toBeInTheDocument();
  });

  it("confirming remove calls removeMember.mutate with pmId", async () => {
    await renderSection();

    const { useRemoveProjectMemberMutation } = await import(
      "./use-project-members-queries"
    );
    const mutateMock = vi.mocked(useRemoveProjectMemberMutation).mock
      .results[0]?.value.mutate as ReturnType<typeof vi.fn>;

    fireEvent.click(screen.getByTestId("remove-btn-pm-2"));
    fireEvent.click(screen.getByTestId("confirm-remove-pm-2"));

    expect(mutateMock).toHaveBeenCalledWith(
      "pm-2",
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("cancelling remove hides confirm/cancel and shows remove button again", async () => {
    await renderSection();
    fireEvent.click(screen.getByTestId("remove-btn-pm-2"));
    fireEvent.click(screen.getByTestId("cancel-remove-pm-2"));
    expect(screen.getByTestId("remove-btn-pm-2")).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-remove-pm-2")).toBeNull();
  });

  it("shows inline error when removeMutation has LAST_OWNER error", async () => {
    const {
      useProjectMembersQuery,
      useAddProjectMemberMutation,
      useChangeProjectMemberRoleMutation,
      useRemoveProjectMemberMutation,
    } = await import("./use-project-members-queries");

    const { ApiError } = await import("@/lib/api-client");

    vi.mocked(useProjectMembersQuery).mockReturnValue({
      data: [ADMIN_ROW, MEMBER_ROW],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectMembersQuery>);

    vi.mocked(useAddProjectMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddProjectMemberMutation>);

    vi.mocked(useChangeProjectMemberRoleMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useChangeProjectMemberRoleMutation>);

    vi.mocked(useRemoveProjectMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new ApiError(422, "LAST_OWNER", "Cannot remove last owner"),
    } as unknown as ReturnType<typeof useRemoveProjectMemberMutation>);

    const { ProjectMembersSection } = await import("./project-members-section");
    const wrapper = createWrapper();
    render(<ProjectMembersSection projectKey={PROJECT_KEY} />, { wrapper });

    expect(screen.getByTestId("remove-error")).toBeInTheDocument();
    expect(screen.getByTestId("remove-error")).toHaveTextContent(
      /last owner/i,
    );
  });
});

describe("ProjectMembersSection — add member form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submitting add form calls addMember.mutate with email and role", async () => {
    await renderSection();

    const { useAddProjectMemberMutation } = await import(
      "./use-project-members-queries"
    );
    const mutateMock = vi.mocked(useAddProjectMemberMutation).mock.results[0]
      ?.value.mutate as ReturnType<typeof vi.fn>;

    fireEvent.change(screen.getByTestId("add-member-email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByTestId("add-member-role"), {
      target: { value: "member" },
    });
    fireEvent.click(screen.getByTestId("add-member-submit"));

    expect(mutateMock).toHaveBeenCalledWith(
      { email: "new@example.com", role: "member" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows inline error for ALREADY_PROJECT_MEMBER code", async () => {
    const {
      useProjectMembersQuery,
      useAddProjectMemberMutation,
      useChangeProjectMemberRoleMutation,
      useRemoveProjectMemberMutation,
    } = await import("./use-project-members-queries");

    const { ApiError } = await import("@/lib/api-client");

    vi.mocked(useProjectMembersQuery).mockReturnValue({
      data: [ADMIN_ROW, MEMBER_ROW],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectMembersQuery>);

    vi.mocked(useAddProjectMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new ApiError(
        409,
        "ALREADY_PROJECT_MEMBER",
        "Already a project member",
      ),
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddProjectMemberMutation>);

    vi.mocked(useChangeProjectMemberRoleMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useChangeProjectMemberRoleMutation>);

    vi.mocked(useRemoveProjectMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useRemoveProjectMemberMutation>);

    const { ProjectMembersSection } = await import("./project-members-section");
    const wrapper = createWrapper();
    render(<ProjectMembersSection projectKey={PROJECT_KEY} />, { wrapper });

    expect(screen.getByTestId("add-member-error")).toBeInTheDocument();
    expect(screen.getByTestId("add-member-error")).toHaveTextContent(
      /already a member/i,
    );
  });
});

describe("ProjectMembersSection — change-role error surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderWithChangeRoleError(error: unknown) {
    const {
      useProjectMembersQuery,
      useAddProjectMemberMutation,
      useChangeProjectMemberRoleMutation,
      useRemoveProjectMemberMutation,
    } = await import("./use-project-members-queries");

    vi.mocked(useProjectMembersQuery).mockReturnValue({
      data: [ADMIN_ROW, MEMBER_ROW],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useProjectMembersQuery>);

    vi.mocked(useAddProjectMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useAddProjectMemberMutation>);

    vi.mocked(useChangeProjectMemberRoleMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    } as unknown as ReturnType<typeof useChangeProjectMemberRoleMutation>);

    vi.mocked(useRemoveProjectMemberMutation).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useRemoveProjectMemberMutation>);

    const { ProjectMembersSection } = await import("./project-members-section");
    const wrapper = createWrapper();
    render(<ProjectMembersSection projectKey={PROJECT_KEY} />, { wrapper });
  }

  it("shows friendly message for ROLE_CAP_EXCEEDED when change-role fails", async () => {
    const { ApiError } = await import("@/lib/api-client");
    await renderWithChangeRoleError(
      new ApiError(403, "ROLE_CAP_EXCEEDED", "Role cap exceeded"),
    );

    expect(screen.getByTestId("change-role-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-role-error")).toHaveTextContent(
      /role cap/i,
    );
  });

  it("shows friendly message for LAST_OWNER when change-role fails", async () => {
    const { ApiError } = await import("@/lib/api-client");
    await renderWithChangeRoleError(
      new ApiError(422, "LAST_OWNER", "Cannot demote last owner"),
    );

    expect(screen.getByTestId("change-role-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-role-error")).toHaveTextContent(
      /last owner/i,
    );
  });

  it("shows friendly message for FORBIDDEN when change-role fails", async () => {
    const { ApiError } = await import("@/lib/api-client");
    await renderWithChangeRoleError(
      new ApiError(403, "FORBIDDEN", "Forbidden"),
    );

    expect(screen.getByTestId("change-role-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-role-error")).toHaveTextContent(
      /permission/i,
    );
  });

  it("shows generic fallback for unexpected change-role errors", async () => {
    await renderWithChangeRoleError(new Error("network failure"));

    expect(screen.getByTestId("change-role-error")).toBeInTheDocument();
    expect(screen.getByTestId("change-role-error")).toHaveTextContent(
      /unexpected/i,
    );
  });

  it("does NOT show change-role error when mutation has no error", async () => {
    await renderSection();
    expect(screen.queryByTestId("change-role-error")).toBeNull();
  });
});

describe("ProjectMembersSection — owner cap on role select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("owner option is visible in role select when current user is owner", async () => {
    // Current user is owner
    const ownerAsCurrentUser: EffectiveMemberRow = {
      userId: "u-admin",
      email: "admin@example.com",
      displayName: "Admin User",
      role: "owner",
      source: "project",
      pmId: "pm-1",
    };
    await renderSection([ownerAsCurrentUser, MEMBER_ROW]);

    const select = screen
      .getByTestId("member-row-pm-2")
      .querySelector("select") as HTMLSelectElement;

    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("owner");
  });

  it("owner option is NOT visible in role select when current user is admin", async () => {
    await renderSection([ADMIN_ROW, MEMBER_ROW]);

    const select = screen
      .getByTestId("member-row-pm-2")
      .querySelector("select") as HTMLSelectElement;

    const options = Array.from(select.options).map((o) => o.value);
    expect(options).not.toContain("owner");
  });

  it("owner option visible in add form when current user is owner", async () => {
    const ownerAsCurrentUser: EffectiveMemberRow = {
      userId: "u-admin",
      email: "admin@example.com",
      displayName: "Admin User",
      role: "owner",
      source: "project",
      pmId: "pm-1",
    };
    await renderSection([ownerAsCurrentUser, MEMBER_ROW]);

    const addRoleSelect = screen.getByTestId(
      "add-member-role",
    ) as HTMLSelectElement;
    const options = Array.from(addRoleSelect.options).map((o) => o.value);
    expect(options).toContain("owner");
  });

  it("owner option NOT in add form when current user is admin (not owner)", async () => {
    await renderSection([ADMIN_ROW, MEMBER_ROW]);

    const addRoleSelect = screen.getByTestId(
      "add-member-role",
    ) as HTMLSelectElement;
    const options = Array.from(addRoleSelect.options).map((o) => o.value);
    expect(options).not.toContain("owner");
  });
});
