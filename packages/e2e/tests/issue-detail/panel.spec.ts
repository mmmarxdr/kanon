import { test, expect } from "@playwright/test";
import { navigateToBoard } from "../../helpers/nav.js";

test.describe("Issue detail panel", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBoard(page, "KAN");

    // Switch to flat view mode so individual issue cards are visible
    const flatButton = page.locator('[data-testid="view-mode-flat"]');
    await flatButton.click();
    await page.waitForTimeout(500);
  });

  test("clicking a card opens the detail panel", async ({ page }) => {
    // Find the first issue card via data-testid and click it
    const firstCard = page.locator('[data-testid^="issue-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });

    // Extract the issue key from the data-testid attribute
    const testId = await firstCard.getAttribute("data-testid");
    const issueKey = testId!.replace("issue-card-", "");
    await firstCard.click();

    // The detail panel should appear via data-testid
    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The panel should show the issue key in a badge
    await expect(panel.getByText(issueKey)).toBeVisible();
  });

  test("panel displays issue fields (title, type, priority, state)", async ({
    page,
  }) => {
    // Click the first card to open the panel
    const firstCard = page.locator('[data-testid^="issue-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The title should be visible (the button with id="issue-detail-title")
    await expect(panel.locator("#issue-detail-title")).toBeVisible();

    // Metadata labels should be visible (uppercase tracking-wider spans)
    await expect(
      panel.locator("span").filter({ hasText: /^Type$/ }),
    ).toBeVisible();
    await expect(
      panel.locator("span").filter({ hasText: /^Priority$/ }),
    ).toBeVisible();
    await expect(
      panel.locator("span").filter({ hasText: /^State$/ }),
    ).toBeVisible();

    // Metadata dropdowns (select elements) should exist — at least Type, Priority, State, Assignee
    const selects = panel.locator("select");
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThanOrEqual(3);
  });

  test("close panel via close button", async ({ page }) => {
    // Open a card
    const firstCard = page.locator('[data-testid^="issue-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Click the close button (aria-label="Close panel")
    const closeButton = page.getByLabel("Close panel");
    await closeButton.click();

    // Panel should be gone
    await expect(panel).not.toBeVisible({ timeout: 3_000 });
  });

  test("close panel via Escape key", async ({ page }) => {
    // Open a card
    const firstCard = page.locator('[data-testid^="issue-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Press Escape to close
    await page.keyboard.press("Escape");

    // Panel should be gone
    await expect(panel).not.toBeVisible({ timeout: 3_000 });
  });
});
