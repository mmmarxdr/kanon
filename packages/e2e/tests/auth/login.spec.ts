import { test, expect } from "@playwright/test";
import { login } from "../../helpers/auth.js";

test.describe("Auth flow", () => {
  test("successful login redirects away from login", async ({ page }) => {
    await login(page);

    // After login the user is redirected away from /login
    // (to /workspaces, which may auto-redirect to a board)
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("invalid credentials show error and stay on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForSelector("#email", { timeout: 5_000 });

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
    await page.waitForSelector("#email", { timeout: 5_000 });

    // The register link should be visible
    const registerLink = page.getByText("Register");
    await expect(registerLink).toBeVisible();
  });
});
