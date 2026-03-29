import { test, expect } from "@playwright/test";
import { navigateToBoard } from "../../helpers/nav.js";

test.describe("Board rendering", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBoard(page, "KAN");

    // Switch to flat view mode so individual issue cards are visible
    // (default is "grouped" which shows GroupCards)
    const flatButton = page.locator('[data-testid="view-mode-flat"]');
    await flatButton.click();
    // Wait for board to re-render with individual issue cards
    await page.waitForTimeout(500);
  });

  test("board renders columns with status headers", async ({ page }) => {
    // The kanban board container should be visible
    const board = page.locator('[data-testid="kanban-board"]');
    await expect(board).toBeVisible({ timeout: 10_000 });

    // Board columns use data-testid="board-column-{column}"
    // Column names are: backlog, analysis, in_progress, testing, finished
    const columns = page.locator('[data-testid^="board-column-"]');
    const columnCount = await columns.count();
    expect(columnCount).toBeGreaterThanOrEqual(1);

    // Each column should have a header h3 with a column label
    // Labels: BACKLOG, ANALYSIS, IN PROGRESS, TESTING, FINISHED
    const firstColumnHeader = columns.first().locator("h3");
    await expect(firstColumnHeader).toBeVisible();
    await expect(firstColumnHeader).not.toBeEmpty();
  });

  test("issue cards are visible inside columns", async ({ page }) => {
    // Issue cards use data-testid="issue-card-{key}"
    const issueCards = page.locator('[data-testid^="issue-card-"]');
    await expect(issueCards.first()).toBeVisible({ timeout: 10_000 });

    // Cards should contain the issue key in a monospace span
    const issueKey = issueCards.first().locator("span.font-mono");
    await expect(issueKey).toBeVisible();
    await expect(issueKey).toHaveText(/KAN-\d+/);
  });

  test("column headers display issue counts", async ({ page }) => {
    // Each board column has a count badge (tabular-nums span in the header)
    const firstColumn = page
      .locator('[data-testid^="board-column-"]')
      .first();
    await expect(firstColumn).toBeVisible({ timeout: 10_000 });

    const countBadge = firstColumn.locator("span.tabular-nums").first();
    await expect(countBadge).toBeVisible();

    // The count text should be a plain number like "3"
    const countText = await countBadge.textContent();
    expect(countText).toMatch(/^\d+$/);
  });
});
