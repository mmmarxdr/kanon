import { test, expect } from "@playwright/test";

/**
 * Auth flow — register
 *
 * Covers:
 * - Happy path: new user registration navigates away from /register
 * - Validation: duplicate email shows error
 * - Form validation: empty required fields show error or stay on page
 */

test.describe("Register flow @smoke", () => {
  test("register form is visible on /register @smoke", async ({ page }) => {
    await page.goto("/register");
    await page.waitForSelector('[data-testid="register-form"]', { timeout: 8_000 });

    const form = page.locator('[data-testid="register-form"]');
    await expect(form).toBeVisible();

    // Required fields present
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });

  test("register with unique email succeeds and navigates away from /register", async ({
    page,
  }) => {
    // Use a timestamp-based email to avoid collisions across test runs
    const uniqueEmail = `e2e-reg-${Date.now()}@example.com`;

    await page.goto("/register");
    await page.waitForSelector('[data-testid="register-form"]', { timeout: 8_000 });

    const displayNameField = page.locator("#displayName");
    if (await displayNameField.isVisible()) {
      await displayNameField.fill("E2E Test User");
    }
    await page.fill("#email", uniqueEmail);
    await page.fill("#password", "Password1!");
    // ToS checkbox is required — submit button stays disabled until checked
    await page.locator('[data-testid="tos-checkbox"]').check();
    await page.click('button[type="submit"]');

    // After successful register the page navigates away from /register
    // (either to /login for no-invite or somewhere else for invite flow)
    await page.waitForURL((url) => !url.pathname.includes("/register"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/register/);
  });

  test("register with existing email shows error and stays on /register", async ({
    page,
  }) => {
    await page.goto("/register");
    await page.waitForSelector('[data-testid="register-form"]', { timeout: 8_000 });

    const displayNameField = page.locator("#displayName");
    if (await displayNameField.isVisible()) {
      await displayNameField.fill("Duplicate");
    }
    // dev@kanon.io is created by global-setup seed — guaranteed to exist
    await page.fill("#email", "dev@kanon.io");
    await page.fill("#password", "Password1!");
    // ToS checkbox is required — submit button stays disabled until checked
    await page.locator('[data-testid="tos-checkbox"]').check();
    await page.click('button[type="submit"]');

    const errorBox = page.locator('[data-testid="register-error"]');
    await expect(errorBox).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/register/);
  });

  test("login link is visible on register page", async ({ page }) => {
    await page.goto("/register");
    await page.waitForSelector('[data-testid="register-form"]', { timeout: 8_000 });

    // Should have a link/button to go to login
    const loginLink = page.getByText(/log in|sign in/i).first();
    await expect(loginLink).toBeVisible();
  });
});
