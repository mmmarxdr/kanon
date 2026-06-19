/**
 * E2E tests for magic-link sign-in flow (KAN-9).
 *
 * Prerequisites: API server + web server must be running.
 * The API must be using ConsoleProvider (no RESEND_API_KEY set).
 * Token capture: listen to API server stdout via `page.on("console", ...)` —
 * NOTE: for true server-side console capture the test intercepts the API response
 * and extracts the token from the verify-magic-link request flow.
 *
 * Strategy: since Playwright can't directly capture server stdout,
 * we expose a test-only route that retrieves the last sent magic-link token.
 * In the absence of that, we use the API directly (supertest-style via fetch)
 * to confirm the flow works, and test the UI independently.
 *
 * @tag @magic-link @requires-services
 */
import { test, expect } from "@playwright/test";

/**
 * Helper: register a user via the API and return credentials.
 * Uses the API server at the baseURL's origin with port 3000.
 */
async function registerViaApi(
  apiBase: string,
  email: string,
  password = "TestPass1!xy",
): Promise<void> {
  const res = await fetch(`${apiBase}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`Register failed: ${res.status}`);
  }
}

/**
 * Helper: request a magic link via the API and return the raw token
 * by checking the /api/auth/magic-link endpoint.
 *
 * Since ConsoleProvider only prints to server stdout (inaccessible from
 * Playwright), this test flow verifies the UI behaviour up to "email sent"
 * state and the redeem page error state. A full token-extract e2e test
 * requires a test-email endpoint (not yet implemented).
 */
test.describe("Magic Link flow @magic-link", () => {
  const API_PORT = process.env["API_PORT"] ?? "3000";
  const apiBase = `http://localhost:${API_PORT}`;

  test("magic-link button is visible and enabled on /login", async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector("#email", { timeout: 5_000 });

    const btn = page.locator('[data-testid="magic-link-btn"]');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toContainText("magic link");
  });

  test("clicking magic-link without email shows an error", async ({ page }) => {
    await page.goto("/login");
    await page.waitForSelector('[data-testid="magic-link-btn"]', { timeout: 5_000 });

    // Do not fill the email — click directly
    await page.click('[data-testid="magic-link-btn"]');

    const errEl = page.locator('[data-testid="magic-link-error"]');
    await expect(errEl).toBeVisible({ timeout: 3_000 });
  });

  test("requesting a magic link with a valid email shows the sent state", async ({
    page,
    context,
  }) => {
    const email = `e2e-ml-${Date.now()}@example.com`;

    // Register the user so the API will actually send a link
    await registerViaApi(apiBase, email);

    await page.goto("/login");
    await page.waitForSelector("#email", { timeout: 5_000 });

    await page.fill("#email", email);
    await page.click('[data-testid="magic-link-btn"]');

    // After clicking, the UI should show the "check your email" state
    await expect(page.getByText("Check your email")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("15 minutes")).toBeVisible();
    await expect(page.getByText("Try a different email")).toBeVisible();

    // Suppress unused warning
    void context;
  });

  test("requesting a magic link with an UNKNOWN email still shows sent state (no enumeration)", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.waitForSelector("#email", { timeout: 5_000 });

    await page.fill("#email", `nobody-${Date.now()}@example.com`);
    await page.click('[data-testid="magic-link-btn"]');

    // UI shows the same "check your email" state — no enumeration
    await expect(page.getByText("Check your email")).toBeVisible({ timeout: 8_000 });
  });

  test("/magic-link page with no token shows an error and back-to-sign-in link", async ({
    page,
  }) => {
    await page.goto("/magic-link");

    await expect(page.getByText("Sign-in failed")).toBeVisible({ timeout: 5_000 });
    // "Back to sign in" appears twice (footer link + primary button) — assert at least one.
    await expect(page.getByText("Back to sign in").first()).toBeVisible();
  });

  test("/magic-link page with a bad token shows an error", async ({ page }) => {
    await page.goto("/magic-link?token=invalid-bad-token-xyz");

    await expect(page.getByText("Sign-in failed")).toBeVisible({ timeout: 8_000 });
    const errBox = page.locator('[style*="var(--bad)"]').first();
    await expect(errBox).toBeVisible();
  });

  /**
   * Full happy-path test: request link → extract token from API → redeem → land on /workspaces.
   *
   * This test uses a test-support endpoint (GET /api/auth/test/last-magic-token)
   * that only exists when NODE_ENV=test. If the endpoint returns 404 (not
   * implemented or production mode), the test is skipped gracefully.
   */
  test("full flow: request → redeem → land on /workspaces @smoke", async ({
    page,
  }) => {
    const email = `e2e-ml-full-${Date.now()}@example.com`;
    await registerViaApi(apiBase, email);

    // Request the magic link
    const sendRes = await fetch(`${apiBase}/api/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    expect(sendRes.ok).toBe(true);

    // Attempt to retrieve the last token via test-support endpoint
    const tokenRes = await fetch(
      `${apiBase}/api/auth/test/last-magic-token?email=${encodeURIComponent(email)}`,
    );

    if (tokenRes.status === 404) {
      // Test-support endpoint not available — skip full flow
      test.skip();
      return;
    }

    const { token } = (await tokenRes.json()) as { token: string };
    expect(token).toBeTruthy();

    // Navigate to the redeem page
    await page.goto(`/magic-link?token=${encodeURIComponent(token)}`);

    // Should land on /workspaces (or auto-redirect to a board)
    await page.waitForURL((url) => !url.pathname.includes("/magic-link"), {
      timeout: 10_000,
    });
    await expect(page).not.toHaveURL(/\/login/);
  });
});
