import { test, expect } from "@playwright/test";
import { navigateToBoard } from "../../helpers/nav.js";
import { apiPost, getAuthToken } from "../../helpers/api.js";

/**
 * Board filtering tests — P2.
 *
 * Tests the FilterBar component: type dropdown, priority dropdown,
 * text search input, clear filters button, and combined filters.
 *
 * The filter bar uses native <select> elements and an <input> for search.
 * Filtering is client-side via the board store.
 */

test.describe("Board Filtering", () => {
  // Create known issues with distinct types and priorities for reliable assertions
  const testIssues: {
    key: string;
    title: string;
    type: string;
    priority: string;
  }[] = [];

  test.beforeAll(async () => {
    const token = await getAuthToken();

    // Create issues with unique titles and different type/priority combos
    // Issues are created in default "backlog" state
    const definitions = [
      {
        title: `Filter-e2e high bug ${Date.now()}`,
        type: "bug",
        priority: "high",
      },
      {
        title: `Filter-e2e low feature ${Date.now()}`,
        type: "feature",
        priority: "low",
      },
      {
        title: `Filter-e2e medium task ${Date.now()}`,
        type: "task",
        priority: "medium",
      },
      {
        title: `Filter-e2e critical spike ${Date.now()}`,
        type: "spike",
        priority: "critical",
      },
    ];

    for (const def of definitions) {
      const issue = await apiPost<{
        key: string;
        title: string;
        type: string;
        priority: string;
      }>("/api/projects/KAN/issues", def, token);
      testIssues.push({
        key: issue.key,
        title: def.title,
        type: def.type,
        priority: def.priority,
      });
    }
  });

  test.beforeEach(async ({ page }) => {
    await navigateToBoard(page, "KAN");

    // Switch to flat view mode so individual issue cards are visible
    const flatButton = page.locator('[data-testid="view-mode-flat"]');
    await flatButton.click();
    // Wait for board to re-render
    await page.waitForTimeout(500);

    // Wait for board columns to render
    await expect(
      page.locator('[data-testid="kanban-board"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("filter by type dropdown shows only matching issues", async ({
    page,
  }) => {
    // Verify at least one of our test issues is visible
    const bugIssue = testIssues.find((i) => i.type === "bug")!;
    await expect(page.getByText(bugIssue.title).first()).toBeVisible({
      timeout: 5_000,
    });

    // Select "Bug" in the type filter dropdown via data-testid
    const typeSelect = page.locator('[data-testid="filter-type"]');
    await typeSelect.selectOption("bug");

    // Wait for filter to apply
    await page.waitForTimeout(300);

    // The bug issue should still be visible
    await expect(page.getByText(bugIssue.title).first()).toBeVisible();

    // Non-bug test issues should be hidden
    const nonBugIssues = testIssues.filter((i) => i.type !== "bug");
    for (const issue of nonBugIssues) {
      await expect(
        page.getByText(issue.title).first(),
      ).not.toBeVisible({ timeout: 3_000 });
    }
  });

  test("filter by priority dropdown shows only matching issues", async ({
    page,
  }) => {
    // Select "High" in the priority filter dropdown via data-testid
    const prioritySelect = page.locator('[data-testid="filter-priority"]');
    await prioritySelect.selectOption("high");

    // Wait for filter to apply
    await page.waitForTimeout(300);

    // The high-priority issue should be visible
    const highIssue = testIssues.find((i) => i.priority === "high")!;
    await expect(page.getByText(highIssue.title).first()).toBeVisible();

    // Non-high test issues should be hidden
    const nonHighIssues = testIssues.filter((i) => i.priority !== "high");
    for (const issue of nonHighIssues) {
      await expect(
        page.getByText(issue.title).first(),
      ).not.toBeVisible({ timeout: 3_000 });
    }
  });

  test("text search filters by title", async ({ page }) => {
    // Type a distinctive search term via data-testid — use the unique timestamp portion
    const spikeIssue = testIssues.find((i) => i.type === "spike")!;
    const searchInput = page.locator('[data-testid="filter-search"]');
    await searchInput.fill(spikeIssue.title);

    // Wait for filter to apply
    await page.waitForTimeout(300);

    // The matching issue should be visible
    await expect(page.getByText(spikeIssue.title).first()).toBeVisible();

    // Other test issues should be hidden
    const otherIssues = testIssues.filter((i) => i.type !== "spike");
    for (const issue of otherIssues) {
      await expect(
        page.getByText(issue.title).first(),
      ).not.toBeVisible({ timeout: 3_000 });
    }
  });

  test("clear filters restores all issues", async ({ page }) => {
    // Apply a filter first via data-testid
    const typeSelect = page.locator('[data-testid="filter-type"]');
    await typeSelect.selectOption("bug");
    await page.waitForTimeout(300);

    // Verify filter is active (non-bug issues hidden)
    const featureIssue = testIssues.find((i) => i.type === "feature")!;
    await expect(
      page.getByText(featureIssue.title).first(),
    ).not.toBeVisible({ timeout: 3_000 });

    // Click "Clear filters" button via data-testid
    // (this button only renders when hasActiveFilters is true)
    const clearButton = page.locator('[data-testid="filter-clear"]');
    await expect(clearButton).toBeVisible({ timeout: 3_000 });
    await clearButton.click();

    // Wait for filter to clear
    await page.waitForTimeout(300);

    // All test issues should be visible again
    for (const issue of testIssues) {
      await expect(page.getByText(issue.title).first()).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
