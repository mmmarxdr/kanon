import type { Page } from "@playwright/test";
import { login } from "./auth.js";

/**
 * Navigate to the Kanban board for a given project.
 *
 * Logs in (if not already), selects the workspace, then navigates to the
 * board view for the specified project key.
 */
export async function navigateToBoard(
  page: Page,
  projectKey = "KAN",
): Promise<void> {
  // Ensure we're logged in first
  await login(page);

  // After login we land on /workspaces — click into the workspace
  await page.waitForURL("**/workspaces", { timeout: 5_000 });

  // Click the workspace link (seed workspace is "Kanon Development")
  const workspaceLink = page.getByText("Kanon Development").first();
  await workspaceLink.click();

  // Wait for project selection page
  await page.waitForURL("**/projects**", { timeout: 5_000 });

  // Click the project
  const projectLink = page.getByText(projectKey).first();
  await projectLink.click();

  // Wait for board to load — look for a column container or status header
  await page.waitForURL("**/board**", { timeout: 5_000 });
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
