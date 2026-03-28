import { test, expect } from "@playwright/test";
import { navigateToBoard, openIssueDetail } from "../../helpers/nav.js";
import { apiPost, getAuthToken } from "../../helpers/api.js";

/**
 * Comments tests — P2.
 *
 * Tests adding comments via the issue detail panel and verifying
 * they appear in the comment list with markdown rendering.
 *
 * The Comments tab is inside TabsSection, which defaults to the
 * "Comments" tab. The add-comment form has:
 * - textarea with aria-label="New comment"
 * - submit button with text "Comment"
 *
 * Comment list items render inside <li> elements with ReactMarkdown.
 */

test.describe("Issue Comments", () => {
  let issueKey: string;

  test.beforeAll(async () => {
    // Create a dedicated issue for comment testing (defaults to "backlog" state)
    const token = await getAuthToken();
    const issue = await apiPost<{ key: string }>(
      "/api/projects/KAN/issues",
      {
        title: `Comments test issue ${Date.now()}`,
        type: "task",
        priority: "medium",
      },
      token,
    );
    issueKey = issue.key;
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBoard(page, "KAN");

    // Switch to flat view mode so individual issue cards are visible
    const flatButton = page.locator('[data-testid="view-mode-flat"]');
    await flatButton.click();
    await page.waitForTimeout(500);

    // Wait for the board to render
    await expect(
      page.locator('[data-testid="kanban-board"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("add comment via issue detail panel", async ({ page }) => {
    // Open the issue detail panel for our test issue
    await openIssueDetail(page, issueKey);

    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The Comments tab should be active by default (TabsSection defaults to "comments")
    const commentsTab = page.getByRole("tab", { name: /Comments/ });
    await expect(commentsTab).toBeVisible();
    await expect(commentsTab).toHaveAttribute("aria-selected", "true");

    // Initially there should be "No comments yet." message
    await expect(page.getByText("No comments yet.")).toBeVisible({
      timeout: 5_000,
    });

    // Type a comment in the textarea
    const commentTextarea = page.getByLabel("New comment");
    await commentTextarea.fill("This is a test comment from E2E");

    // Submit the comment
    const submitButton = page.getByRole("button", { name: "Comment" });
    await submitButton.click();

    // Wait for the comment to appear in the list
    await expect(
      page.getByText("This is a test comment from E2E"),
    ).toBeVisible({ timeout: 10_000 });

    // The "No comments yet" message should be gone
    await expect(page.getByText("No comments yet.")).not.toBeVisible();

    // The textarea should be cleared after submission
    await expect(commentTextarea).toHaveValue("");
  });

  test("comment appears in list after API creation", async ({ page }) => {
    // First, add a comment via API for a guaranteed starting state
    const token = await getAuthToken();
    const commentBody = `API-created comment ${Date.now()}`;
    await apiPost(
      `/api/issues/${issueKey}/comments`,
      { body: commentBody, source: "human" },
      token,
    );

    // Navigate to the issue detail
    await openIssueDetail(page, issueKey);

    // Verify the API-created comment is visible in the list
    await expect(page.getByText(commentBody)).toBeVisible({
      timeout: 10_000,
    });

    // The comment should be inside an <li> element (CommentItem renders as <li>)
    const commentItem = page.locator("li").filter({
      hasText: commentBody,
    });
    await expect(commentItem).toBeVisible();
  });
});
