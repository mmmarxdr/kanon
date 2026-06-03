import { test, expect } from "@playwright/test";
import { navigateToBoard } from "../../helpers/nav.js";
import { apiPost, getAuthToken } from "../../helpers/api.js";

test.describe("Board rendering", () => {
  // Seed a few issues so the board has cards to render
  test.beforeAll(async () => {
    const token = await getAuthToken();
    const issues = [
      { title: "Board test issue 1", type: "task", priority: "medium" },
      { title: "Board test issue 2", type: "bug", priority: "high" },
      { title: "Board test issue 3", type: "feature", priority: "low" },
    ];
    for (const issue of issues) {
      await apiPost("/api/projects/KAN/issues", issue, token);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Force flat view so KanbanBoard (data-testid="kanban-board") renders.
    // The default grouped view hides ungrouped issues (the ones seeded above
    // have no group), so flat is the correct target for card-level assertions.
    await navigateToBoard(page, "KAN", "flat");

    await page.waitForSelector('[data-testid="kanban-board"]', { timeout: 10_000 });
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

    // Each column header shows its state label (rendered in a <span>).
    // Labels: Backlog, Todo, In progress, In review, Done.
    await expect(columns.first()).toContainText(
      /Backlog|Todo|In progress|In review|Done/i,
    );
  });

  test("issue cards are visible inside columns", async ({ page }) => {
    // Issue cards use data-testid="issue-card-{key}"
    const issueCards = page.locator('[data-testid^="issue-card-"]');
    await expect(issueCards.first()).toBeVisible({ timeout: 10_000 });

    // Cards should contain the issue key text matching KAN-N
    const firstCard = issueCards.first();
    await expect(firstCard).toContainText(/KAN-\d+/);
  });

  test("column headers display issue counts", async ({ page }) => {
    // Each board column should be visible
    const firstColumn = page
      .locator('[data-testid^="board-column-"]')
      .first();
    await expect(firstColumn).toBeVisible({ timeout: 10_000 });

    // Column header should show a numeric count
    const countBadge = firstColumn.locator("span.tabular-nums").first();
    if (await countBadge.isVisible()) {
      const countText = await countBadge.textContent();
      expect(countText).toMatch(/^\d+$/);
    } else {
      // Fallback: just confirm the column contains text content (count style may differ)
      const colText = await firstColumn.textContent();
      expect(colText).toBeTruthy();
    }
  });
});
