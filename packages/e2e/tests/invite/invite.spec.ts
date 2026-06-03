import { test, expect } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login } from "../../helpers/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });

/**
 * Invite flow
 *
 * Covers:
 * - /invite/$token renders invite metadata for a valid invite
 * - Unauthenticated user sees Sign up / Log in buttons
 * - Authenticated user sees Accept Invite button
 * - Accepting invite as authenticated user redirects to /workspaces
 *
 * The SEED_INVITE_TOKEN is written by global-setup.ts (always valid, 7-day expiry,
 * kind=MEMBER, email=dev@kanon.io — the seed user, who is already a member, so
 * accepting resolves to 409 ALREADY_MEMBER and the UI redirects to /workspaces).
 */

test.describe("Invite page — unauthenticated user", () => {
  test("valid invite page renders invite card with Sign up / Log in buttons", async ({
    page,
  }) => {
    const token = process.env["SEED_INVITE_TOKEN"];
    if (!token) {
      test.skip(true, "SEED_INVITE_TOKEN not set — global-setup may have failed");
      return;
    }

    await page.goto(`/invite/${token}`);

    // Invite card should be visible
    const inviteCard = page.locator('[data-testid="invite-card"]');
    await expect(inviteCard).toBeVisible({ timeout: 10_000 });

    // Unauthenticated: should show signup and login buttons
    await expect(page.locator('[data-testid="invite-signup-btn"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="invite-login-btn"]')).toBeVisible({ timeout: 5_000 });

    // Accept button should NOT be visible (not authenticated)
    await expect(page.locator('[data-testid="invite-accept-btn"]')).not.toBeVisible();
  });

  test("invalid invite token shows invalid state", async ({ page }) => {
    await page.goto("/invite/this-token-does-not-exist-at-all");

    // Should show some error state — either the invalid card UI or a 404
    // The component renders "Invalid Invite" or "Invite Unavailable" on error
    await page.waitForLoadState("domcontentloaded");
    const body = await page.textContent("body");
    expect(body).toMatch(/invalid|unavailable|not exist|error/i);
  });
});

test.describe("Invite page — authenticated user", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("authenticated user sees Accept Invite button on valid invite", async ({
    page,
  }) => {
    const token = process.env["SEED_INVITE_TOKEN"];
    if (!token) {
      test.skip(true, "SEED_INVITE_TOKEN not set — global-setup may have failed");
      return;
    }

    await page.goto(`/invite/${token}`);

    // Invite card should be visible
    const inviteCard = page.locator('[data-testid="invite-card"]');
    await expect(inviteCard).toBeVisible({ timeout: 10_000 });

    // Authenticated: should show accept button (not signup/login)
    await expect(page.locator('[data-testid="invite-accept-btn"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="invite-signup-btn"]')).not.toBeVisible();
  });

  test("accepting invite redirects to /workspaces", async ({ page }) => {
    const token = process.env["SEED_INVITE_TOKEN"];
    if (!token) {
      test.skip(true, "SEED_INVITE_TOKEN not set — global-setup may have failed");
      return;
    }

    await page.goto(`/invite/${token}`);

    const acceptBtn = page.locator('[data-testid="invite-accept-btn"]');
    await expect(acceptBtn).toBeVisible({ timeout: 10_000 });
    await acceptBtn.click();

    // After accepting (or 409 already-member), navigates to /workspaces
    await page.waitForURL((url) => url.pathname.includes("/workspaces") || url.pathname.includes("/inbox"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/invite\//);
  });
});
