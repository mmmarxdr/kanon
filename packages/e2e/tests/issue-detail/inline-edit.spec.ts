import { test, expect } from "@playwright/test";
import { navigateToBoard, openIssueDetail } from "../../helpers/nav.js";

test.describe("Inline editing", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBoard(page, "KAN");

    // Switch to flat view mode so individual issue cards are visible
    const flatButton = page.locator('[data-testid="view-mode-flat"]');
    await flatButton.click();
    await page.waitForTimeout(500);
  });

  test("edit title inline — click, type, blur saves", async ({ page }) => {
    // Find a card via data-testid and extract the issue key
    const firstCard = page.locator('[data-testid^="issue-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    const testId = (await firstCard.getAttribute("data-testid"))!;
    const issueKeyText = testId.replace("issue-card-", "");

    // Open the issue detail panel
    await openIssueDetail(page, issueKeyText);

    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Get current title
    const titleButton = panel.locator("#issue-detail-title");
    await expect(titleButton).toBeVisible({ timeout: 3_000 });
    const originalTitle = (await titleButton.textContent())!.trim();

    // Click the title to enter edit mode
    await titleButton.click();

    // An input should appear with aria-label="Issue title"
    const titleInput = panel.locator('input[aria-label="Issue title"]');
    await expect(titleInput).toBeVisible({ timeout: 3_000 });

    // Clear and type new title
    const newTitle = `${originalTitle} (edited)`;
    await titleInput.fill(newTitle);

    // Blur to save — click a metadata label
    await panel.locator("span").filter({ hasText: /^Type$/ }).click();

    // The title button should reappear with the updated text
    await expect(titleButton).toBeVisible({ timeout: 3_000 });
    await expect(titleButton).toHaveText(newTitle);

    // Revert: edit back to original title so test is idempotent
    await titleButton.click();
    const titleInputAgain = panel.locator('input[aria-label="Issue title"]');
    await titleInputAgain.fill(originalTitle);
    await panel.locator("span").filter({ hasText: /^Type$/ }).click();
    await expect(titleButton).toHaveText(originalTitle);
  });

  test("edit metadata via dropdown — change priority", async ({ page }) => {
    // Find a card via data-testid and extract the issue key
    const firstCard = page.locator('[data-testid^="issue-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    const testId = (await firstCard.getAttribute("data-testid"))!;
    const issueKeyText = testId.replace("issue-card-", "");

    // Open the issue detail panel
    await openIssueDetail(page, issueKeyText);

    const panel = page.locator('[data-testid="issue-detail-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Find the Priority select — the MetadataField structure is:
    // div.flex.flex-col > span("Priority") + select
    // Find the label span first, then go to parent, then find the select
    const priorityLabel = panel
      .locator("span")
      .filter({ hasText: /^Priority$/ });
    await expect(priorityLabel).toBeVisible({ timeout: 3_000 });
    const priorityField = priorityLabel.locator("..");
    const prioritySelect = priorityField.locator("select");
    await expect(prioritySelect).toBeVisible({ timeout: 3_000 });

    // Get current value
    const currentPriority = await prioritySelect.inputValue();

    // Choose a different priority
    const newPriority = currentPriority === "high" ? "medium" : "high";
    await prioritySelect.selectOption(newPriority);

    // Verify the select reflects the new value
    await expect(prioritySelect).toHaveValue(newPriority);

    // Wait briefly for the mutation to fire (optimistic update)
    await page.waitForTimeout(500);

    // Revert to original to keep tests idempotent
    await prioritySelect.selectOption(currentPriority);
    await expect(prioritySelect).toHaveValue(currentPriority);
  });
});
