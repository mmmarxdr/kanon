import { test, expect } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login } from "../../helpers/auth.js";
import { apiPost, getAuthToken } from "../../helpers/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

/**
 * Workspace select flow
 *
 * Covers:
 * - Empty state (no workspaces): create-workspace form appears and functions
 * - Single-workspace auto-redirect: /workspaces sends to /inbox when 1 ws + projects
 *
 * Note: The seed user has exactly 1 workspace with 1 project (KAN), so visiting
 * /workspaces auto-redirects to /inbox. To test the empty-state form we use a
 * fresh user with no workspaces.
 */

test.describe("Workspace select — auto-redirect (seed user)", () => {
  test("seed user on /workspaces auto-redirects to /inbox", async ({ page }) => {
    await login(page);

    // Navigate to /workspaces — with 1 workspace + projects it should redirect to /inbox
    await page.goto("/workspaces");
    await page.waitForURL((url) => !url.pathname.includes("/workspaces"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/workspaces$/);
  });
});

test.describe("Workspace select — empty state (new user)", () => {
  let newUserEmail: string;
  let newUserPassword: string;

  test.beforeAll(async () => {
    // Create a brand-new user with no workspace via API
    newUserEmail = `e2e-ws-${Date.now()}@example.com`;
    newUserPassword = "Password1!";

    await apiPost("/api/auth/register", {
      email: newUserEmail,
      password: newUserPassword,
      displayName: "WS Test User",
    });
  });

  test("new user with no workspace sees create-workspace empty state", async ({
    page,
  }) => {
    await login(page, { email: newUserEmail, password: newUserPassword });

    // Navigate to /workspaces — new user has no workspace, no auto-redirect
    await page.goto("/workspaces");

    // Empty state container should appear
    const emptyState = page.locator('[data-testid="workspace-empty-state"]');
    await expect(emptyState).toBeVisible({ timeout: 10_000 });

    // Create form fields should be present
    await expect(page.locator('input[aria-label="Workspace name"]')).toBeVisible();
    await expect(page.locator('input[aria-label="Slug"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="create-workspace-submit"]'),
    ).toBeVisible();
  });

  test("new user can create a workspace and gets redirected", async ({
    page,
  }) => {
    await login(page, { email: newUserEmail, password: newUserPassword });
    await page.goto("/workspaces");

    const emptyState = page.locator('[data-testid="workspace-empty-state"]');
    await expect(emptyState).toBeVisible({ timeout: 10_000 });

    const wsName = `Test WS ${Date.now()}`;
    await page.fill('input[aria-label="Workspace name"]', wsName);
    // Slug auto-derives from name; wait for it
    await page.waitForTimeout(300);

    const submitBtn = page.locator('[data-testid="create-workspace-submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 3_000 });
    await submitBtn.click();

    // After creation, navigates to projects setup page or /inbox
    await page.waitForURL(
      (url) =>
        url.pathname.includes("/projects") || url.pathname.includes("/inbox"),
      { timeout: 10_000 },
    );
    await expect(page).not.toHaveURL(/\/workspaces$/);
  });
});
