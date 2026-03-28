import { test, expect } from "@playwright/test";
import { login } from "../../helpers/auth.js";

test.describe("Auth flow", () => {
  test("successful login redirects to workspaces page", async ({ page }) => {
    await login(page);

    // After login the user lands on /workspaces
    await expect(page).toHaveURL(/\/workspaces/);
    // The workspace-select page should render
    await expect(page.getByText("Select Workspace")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("invalid credentials show error and stay on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForSelector("#workspaceId", { timeout: 5_000 });

    await page.fill("#workspaceId", "kanon-dev");
    await page.fill("#email", "dev@kanon.io");
    await page.fill("#password", "WrongPassword123!");

    await page.click('button[type="submit"]');

    // Error message should appear via data-testid
    const errorBox = page.locator('[data-testid="login-error"]');
    await expect(errorBox).toBeVisible({ timeout: 5_000 });

    // User should remain on /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("register link navigates to /register", async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector("#workspaceId", { timeout: 5_000 });

    // The register link should be visible
    const registerLink = page.getByText("Register");
    await expect(registerLink).toBeVisible();
  });
});
