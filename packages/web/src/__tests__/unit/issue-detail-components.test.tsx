import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IssueDetailHeader } from "@/features/issue-detail/issue-detail-header";
import { MetadataSection } from "@/features/issue-detail/metadata-section";
import { CommentList } from "@/features/issue-detail/comment-list";
import { TabsSection } from "@/features/issue-detail/tabs-section";
import { issueKeys } from "@/lib/query-keys";
import type { IssueDetail, Comment, ActivityLog } from "@/types/issue";
import type { Issue } from "@/types/issue";

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const MOCK_ISSUE: IssueDetail = {
  id: "issue-1",
  key: "KAN-42",
  title: "Implement feature",
  description: "Some **markdown**",
  type: "task",
  priority: "medium",
  state: "apply",
  labels: ["frontend", "urgent"],
  assigneeId: "user-1",
  assignee: { id: "user-1", username: "alice", email: "alice@test.com" },
  projectId: "proj-1",
  project: { id: "proj-1", key: "KAN", name: "Kanon" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-15T00:00:00Z",
};

const MOCK_LIST_ISSUES: Issue[] = [
  {
    id: "issue-1",
    key: "KAN-42",
    title: "Implement feature",
    type: "task",
    priority: "medium",
    state: "apply",
    labels: ["frontend"],
    assigneeId: "user-1",
    assignee: { username: "alice" },
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  },
  {
    id: "issue-2",
    key: "KAN-43",
    title: "Other",
    type: "bug",
    priority: "high",
    state: "verify",
    labels: [],
    assigneeId: "user-2",
    assignee: { username: "bob" },
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
  },
];

const MOCK_COMMENTS: Comment[] = [
  {
    id: "c-1",
    body: "First comment with **bold**",
    source: "human",
    author: { id: "user-1", username: "alice" },
    createdAt: "2026-01-02T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
  {
    id: "c-2",
    body: "Agent response",
    source: "agent",
    author: { id: "user-2", username: "bot" },
    createdAt: "2026-01-03T00:00:00Z",
    updatedAt: "2026-01-03T00:00:00Z",
  },
];

const MOCK_ACTIVITIES: ActivityLog[] = [
  {
    id: "a-1",
    action: "created",
    actor: { id: "user-1", username: "alice" },
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "a-2",
    action: "state_changed",
    field: "state",
    oldValue: "explore",
    newValue: "apply",
    actor: { id: "user-1", username: "alice" },
    createdAt: "2026-01-10T00:00:00Z",
  },
];

/* ------------------------------------------------------------------ */
/*  IssueDetailHeader                                                  */
/* ------------------------------------------------------------------ */

describe("IssueDetailHeader", () => {
  it("displays issue key and title (R-IDP-03)", () => {
    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Implement feature"
        onTitleChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("KAN-42")).toBeInTheDocument();
    expect(screen.getByText("Implement feature")).toBeInTheDocument();
  });

  it("switches to edit mode on title click (R-IDP-05)", async () => {
    const user = userEvent.setup();
    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Implement feature"
        onTitleChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Click title text to enter edit mode
    await user.click(screen.getByText("Implement feature"));

    // Input should now be visible with the title value
    const input = screen.getByRole("textbox", { name: /issue title/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Implement feature");
  });

  it("saves title on blur (R-IDP-05)", async () => {
    const user = userEvent.setup();
    const onTitleChange = vi.fn();

    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Original"
        onTitleChange={onTitleChange}
        onClose={vi.fn()}
      />,
    );

    // Enter edit mode
    await user.click(screen.getByText("Original"));

    const input = screen.getByRole("textbox", { name: /issue title/i });
    await user.clear(input);
    await user.type(input, "Updated title");

    // Blur to save
    fireEvent.blur(input);

    expect(onTitleChange).toHaveBeenCalledWith("Updated title");
  });

  it("saves title on Enter key (R-IDP-05)", async () => {
    const user = userEvent.setup();
    const onTitleChange = vi.fn();

    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Original"
        onTitleChange={onTitleChange}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: /issue title/i });
    await user.clear(input);
    await user.type(input, "Enter-saved title{Enter}");

    expect(onTitleChange).toHaveBeenCalledWith("Enter-saved title");
  });

  it("does not save if title is unchanged", async () => {
    const user = userEvent.setup();
    const onTitleChange = vi.fn();

    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Original"
        onTitleChange={onTitleChange}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: /issue title/i });
    // Blur without changing
    fireEvent.blur(input);

    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it("reverts on Escape key press", async () => {
    const user = userEvent.setup();
    const onTitleChange = vi.fn();

    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Original"
        onTitleChange={onTitleChange}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Original"));
    const input = screen.getByRole("textbox", { name: /issue title/i });
    await user.clear(input);
    await user.type(input, "Draft change");
    await user.keyboard("{Escape}");

    // Should not save
    expect(onTitleChange).not.toHaveBeenCalled();
    // Should show original title text again
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <IssueDetailHeader
        issueKey="KAN-42"
        title="Test"
        onTitleChange={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /close panel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

/* ------------------------------------------------------------------ */
/*  MetadataSection                                                    */
/* ------------------------------------------------------------------ */

describe("MetadataSection", () => {
  it("renders all metadata fields (R-IDP-03)", () => {
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(issueKeys.list("KAN"), MOCK_LIST_ISSUES);

    const { container } = render(
      <MetadataSection
        issue={MOCK_ISSUE}
        projectKey="KAN"
        onFieldChange={vi.fn()}
        onTransition={vi.fn()}
      />,
      { wrapper },
    );

    // Check labels
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Priority")).toBeInTheDocument();
    expect(screen.getByText("State")).toBeInTheDocument();
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Labels")).toBeInTheDocument();
    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  it("calls onFieldChange when priority dropdown changes (R-IDP-06)", async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(issueKeys.list("KAN"), MOCK_LIST_ISSUES);

    render(
      <MetadataSection
        issue={MOCK_ISSUE}
        projectKey="KAN"
        onFieldChange={onFieldChange}
        onTransition={vi.fn()}
      />,
      { wrapper },
    );

    // Find the priority select (second select, or we can find by current value)
    const selects = screen.getAllByRole("combobox");
    // Priority is the second select
    const prioritySelect = selects[1]!;
    await user.selectOptions(prioritySelect, "high");

    expect(onFieldChange).toHaveBeenCalledWith({ priority: "high" });
  });

  it("calls onTransition when state dropdown changes (R-IDP-06)", async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(issueKeys.list("KAN"), MOCK_LIST_ISSUES);

    render(
      <MetadataSection
        issue={MOCK_ISSUE}
        projectKey="KAN"
        onFieldChange={vi.fn()}
        onTransition={onTransition}
      />,
      { wrapper },
    );

    // State is the third select
    const selects = screen.getAllByRole("combobox");
    const stateSelect = selects[2]!;
    await user.selectOptions(stateSelect, "verify");

    expect(onTransition).toHaveBeenCalledWith("verify");
  });

  it("calls onFieldChange when type dropdown changes (R-IDP-06)", async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(issueKeys.list("KAN"), MOCK_LIST_ISSUES);

    render(
      <MetadataSection
        issue={MOCK_ISSUE}
        projectKey="KAN"
        onFieldChange={onFieldChange}
        onTransition={vi.fn()}
      />,
      { wrapper },
    );

    const selects = screen.getAllByRole("combobox");
    const typeSelect = selects[0]!;
    await user.selectOptions(typeSelect, "bug");

    expect(onFieldChange).toHaveBeenCalledWith({ type: "bug" });
  });

  it("shows assignees derived from board cache", () => {
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(issueKeys.list("KAN"), MOCK_LIST_ISSUES);

    render(
      <MetadataSection
        issue={MOCK_ISSUE}
        projectKey="KAN"
        onFieldChange={vi.fn()}
        onTransition={vi.fn()}
      />,
      { wrapper },
    );

    // Assignee dropdown should show alice and bob from the cache
    const selects = screen.getAllByRole("combobox");
    const assigneeSelect = selects[3]!;
    const options = assigneeSelect.querySelectorAll("option");
    const optionTexts = Array.from(options).map((o) => o.textContent);

    expect(optionTexts).toContain("Unassigned");
    expect(optionTexts).toContain("alice");
    expect(optionTexts).toContain("bob");
  });

  it("shows 'None' when labels array is empty", () => {
    const { queryClient, wrapper } = createQueryWrapper();
    queryClient.setQueryData(issueKeys.list("KAN"), MOCK_LIST_ISSUES);
    const issueWithNoLabels = { ...MOCK_ISSUE, labels: [] };

    render(
      <MetadataSection
        issue={issueWithNoLabels}
        projectKey="KAN"
        onFieldChange={vi.fn()}
        onTransition={vi.fn()}
      />,
      { wrapper },
    );

    expect(screen.getByText("None")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  CommentList                                                        */
/* ------------------------------------------------------------------ */

describe("CommentList", () => {
  it("renders comments with author and markdown body (R-IDP-08)", () => {
    render(
      <CommentList
        comments={MOCK_COMMENTS}
        isLoading={false}
        onAddComment={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bot")).toBeInTheDocument();
    // Markdown renders bold as <strong>
    expect(screen.getByText("bold")).toBeInTheDocument();
    // Agent badge
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("shows empty state when no comments", () => {
    render(
      <CommentList
        comments={[]}
        isLoading={false}
        onAddComment={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <CommentList
        comments={[]}
        isLoading={true}
        onAddComment={vi.fn()}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText("Loading comments...")).toBeInTheDocument();
  });

  it("submits new comment via form (R-IDP-09)", async () => {
    const user = userEvent.setup();
    const onAddComment = vi.fn();

    render(
      <CommentList
        comments={[]}
        isLoading={false}
        onAddComment={onAddComment}
        isSubmitting={false}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: /new comment/i });
    await user.type(textarea, "My new comment");
    await user.click(screen.getByRole("button", { name: /comment/i }));

    expect(onAddComment).toHaveBeenCalledWith("My new comment");
  });

  it("disables submit button when textarea is empty", () => {
    render(
      <CommentList
        comments={[]}
        isLoading={false}
        onAddComment={vi.fn()}
        isSubmitting={false}
      />,
    );

    const button = screen.getByRole("button", { name: /comment/i });
    expect(button).toBeDisabled();
  });

  it("disables submit button while submitting", () => {
    render(
      <CommentList
        comments={[]}
        isLoading={false}
        onAddComment={vi.fn()}
        isSubmitting={true}
      />,
    );

    expect(screen.getByText("Submitting...")).toBeInTheDocument();
  });

  it("clears textarea after successful submit", async () => {
    const user = userEvent.setup();
    const onAddComment = vi.fn();

    render(
      <CommentList
        comments={[]}
        isLoading={false}
        onAddComment={onAddComment}
        isSubmitting={false}
      />,
    );

    const textarea = screen.getByRole("textbox", { name: /new comment/i });
    await user.type(textarea, "My comment");
    await user.click(screen.getByRole("button", { name: /comment/i }));

    expect(textarea).toHaveValue("");
  });
});

/* ------------------------------------------------------------------ */
/*  TabsSection                                                        */
/* ------------------------------------------------------------------ */

describe("TabsSection", () => {
  it("shows Comments tab by default (R-IDP-08)", () => {
    render(
      <TabsSection
        comments={MOCK_COMMENTS}
        commentsLoading={false}
        activities={MOCK_ACTIVITIES}
        activitiesLoading={false}
        onAddComment={vi.fn()}
        isSubmittingComment={false}
      />,
    );

    // Comments tab should be active
    const commentsTab = screen.getByRole("tab", { name: /comments/i });
    expect(commentsTab).toHaveAttribute("aria-selected", "true");

    // Comment content should be visible
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("switches to Activity tab on click (R-IDP-10)", async () => {
    const user = userEvent.setup();

    render(
      <TabsSection
        comments={MOCK_COMMENTS}
        commentsLoading={false}
        activities={MOCK_ACTIVITIES}
        activitiesLoading={false}
        onAddComment={vi.fn()}
        isSubmittingComment={false}
      />,
    );

    const activityTab = screen.getByRole("tab", { name: /activity/i });
    await user.click(activityTab);

    expect(activityTab).toHaveAttribute("aria-selected", "true");

    // Activity content should show state change
    expect(screen.getByText("explore")).toBeInTheDocument();
    expect(screen.getByText("apply")).toBeInTheDocument();
  });

  it("shows counts in tab labels", () => {
    render(
      <TabsSection
        comments={MOCK_COMMENTS}
        commentsLoading={false}
        activities={MOCK_ACTIVITIES}
        activitiesLoading={false}
        onAddComment={vi.fn()}
        isSubmittingComment={false}
      />,
    );

    // Both tabs show count (2) — comments has 2 items, activity has 2 items
    const countElements = screen.getAllByText("(2)");
    expect(countElements).toHaveLength(2);
  });

  it("renders tablist role for accessibility", () => {
    render(
      <TabsSection
        comments={[]}
        commentsLoading={false}
        activities={[]}
        activitiesLoading={false}
        onAddComment={vi.fn()}
        isSubmittingComment={false}
      />,
    );

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });
});
