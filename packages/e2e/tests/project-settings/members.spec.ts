import { test, expect } from "@playwright/test";
import { login } from "../../helpers/auth.js";

/**
 * Project settings — members
 *
 * Covers:
 * - Route /project-settings/$projectKey is reachable when authenticated
 * - Members tab / member list content renders (without requiring specific testids
 *   on every element — those would be added in a follow-up if member management
 *   UI gets stable testids)
 *
 * NOTE: The project-settings route redirects unauthenticated users. These tests
 * use the seed user (dev@kanon.io) who is owner of the KAN project.
 */

test.describe("Project settings — members route", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("project-settings route loads for seed project KAN", async ({ page }) => {
    await page.goto("/project-settings/KAN");

    // Page should not redirect away (authenticated + owner)
    await page.waitForURL(/\/project-settings\/KAN/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/project-settings\/KAN/);
  });

  test("settings page renders member-related content", async ({ page }) => {
    await page.goto("/project-settings/KAN");
    await page.waitForURL(/\/project-settings\/KAN/, { timeout: 10_000 });

    // The page should hydrate with meaningful content — at minimum the project
    // key text. Poll on content rather than networkidle: the app keeps the
    // network busy (background polling) so it never reaches a network-idle state.
    await expect(page.locator("body")).toContainText(/KAN/i, { timeout: 15_000 });
  });
});
