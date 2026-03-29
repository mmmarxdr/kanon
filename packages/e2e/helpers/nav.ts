import type { Page } from "@playwright/test";
import { login } from "./auth.js";

/**
 * Navigate to the Kanban board for a given project.
 *
 * Logs in, then navigates directly to the board URL for the specified project key.
 * The workspace-select page auto-redirects when there is a single workspace,
 * so we skip manual workspace/project selection and go straight to the board.
 */
export async function navigateToBoard(
  page: Page,
  projectKey = "KAN",
): Promise<void> {
  // Ensure we're logged in first
  await login(page);

  // Navigate directly to the board URL for the target project
  await page.goto(`/board/${projectKey}`);

  // Wait for board to load
  await page.waitForURL(`**/board/${projectKey}**`, { timeout: 10_000 });
}

/**
 * Open the issue detail panel by clicking on an issue card.
 *
 * @param page - Playwright page
 * @param issueKeyOrSelector - Issue key like "KAN-1" or a custom selector
 */
export async function openIssueDetail(
  page: Page,
  issueKeyOrSelector: string,
): Promise<void> {
  // Try to find by issue key text first
  const card = page.getByText(issueKeyOrSelector).first();
  await card.click();

  // Wait for the detail panel to appear
  await page.waitForSelector('[data-testid="issue-detail-panel"]', {
    timeout: 5_000,
  });
}
