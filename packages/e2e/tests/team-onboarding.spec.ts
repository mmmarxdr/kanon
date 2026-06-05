/**
 * E2E: Team Onboarding Flow
 *
 * Prerequisites:
 *   - Dev stack must be running: `pnpm dev:start`
 *   - Fresh E2E database: global-setup.ts runs `prisma migrate reset --force && prisma db seed`
 *   - Seed admin user: dev@kanon.io / Password1!  (written to .env.test by global-setup.ts)
 *   - Environment: DATABASE_URL points to `kanon_e2e` Postgres DB
 *   - API_PORT (default 3001) and WEB_PORT (default 5174) must be free
 *
 * Scenarios covered:
 *   K1 — Happy-path: admin generates onboarding link → simulated CLI exchange pipeline →
 *         access token authorises GET /api/auth/me.
 *   K2 — Kind-guard: attempting to accept an onboarding invite via the web acceptInvite
 *         endpoint returns 400 INVALID_INVITE_KIND.
 */

import { test, expect } from "@playwright/test";
import { login } from "../helpers/auth.js";
import { apiGet, apiPost, getAuthToken } from "../helpers/api.js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reload seed constants written by global-setup.ts
dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

const API_BASE = `http://localhost:${process.env["API_PORT"] ?? "3001"}`;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface OnboardingInviteApiResponse {
  inviteId: string;
  url: string;   // kanon://<host>/onboard?token=<jwt>
  token: string; // raw JWT
  expiresAt: string;
}

interface OnboardResponse {
  refreshToken: string;
  apiUrl: string;
  workspace: { id: string; slug: string; name: string };
  email: string;
  expiresAt: string;
}

interface ExchangeResponse {
  accessToken: string;
  expiresIn: number;
}

interface MeResponse {
  id: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the onboarding token from a kanon:// URL.
 * e.g. kanon://localhost:3001/onboard?token=eyJ... → "eyJ..."
 */
function extractTokenFromUrl(kanoUrl: string): string {
  // The URL uses the kanon:// scheme which URL() accepts as a valid scheme
  const url = new URL(kanoUrl.replace(/^kanon:\/\//, "http://"));
  const token = url.searchParams.get("token");
  if (!token) throw new Error(`No token param in onboarding URL: ${kanoUrl}`);
  return token;
}

/**
 * Call POST /api/auth/onboard directly (simulating what the CLI does).
 * Returns the full onboard response on success.
 * Throws if the server returns a non-2xx status.
 */
async function callOnboard(token: string): Promise<OnboardResponse> {
  return apiPost<OnboardResponse>("/api/auth/onboard", { token });
}

/**
 * Call POST /api/auth/exchange directly (simulating what the MCP wrapper does).
 * Returns the exchange response on success.
 */
async function callExchange(refreshToken: string): Promise<ExchangeResponse> {
  return apiPost<ExchangeResponse>("/api/auth/exchange", { refreshToken });
}

/**
 * Call POST /api/auth/onboard and return the raw Response (no error-throw) so we
 * can assert on error status codes.
 */
async function callOnboardRaw(token: string): Promise<Response> {
  return fetch(`${API_BASE}/api/auth/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

// ---------------------------------------------------------------------------
// K1 — Happy-path onboarding pipeline
// ---------------------------------------------------------------------------

test.describe("Team onboarding — happy path (K1)", () => {
  /**
   * Full pipeline:
   *   1. Admin logs in via Web UI.
   *   2. Navigates to /settings (Members tab is default).
   *   3. Clicks "Onboard" on the first member row to trigger the mutation.
   *   4. OnboardingLinkModal opens; test reads the kanon:// URL from data-testid.
   *   5. Extracts the JWT token from the URL.
   *   6. Calls POST /api/auth/onboard (simulating the CLI).
   *   7. Calls POST /api/auth/exchange (simulating the MCP wrapper).
   *   8. Calls GET /api/auth/me with the access token — asserts 200.
   *   9. Calls POST /api/auth/onboard again with the same token — asserts 410 or 400 TOKEN_CONSUMED.
   */
  test("admin generates link; CLI pipeline succeeds; second consumption is rejected", async ({
    page,
  }) => {
    // Step 1 — Log in via Web UI
    await login(page);

    // Step 2 — Navigate to settings
    await page.goto("/settings");
    await page.waitForSelector("text=Members", { timeout: 10_000 });

    // Step 3 — Click "Onboard" on the first member row that has the button.
    // The button data-testid is `onboarding-gen-btn-<memberId>`.
    const onboardBtn = page
      .locator('[data-testid^="onboarding-gen-btn-"]')
      .first();
    await expect(onboardBtn).toBeVisible({ timeout: 5_000 });
    await onboardBtn.click();

    // Step 4 — Modal opens; read the kanon:// URL
    await expect(
      page.locator('[data-testid="onboarding-link-modal"]'),
    ).toBeVisible({ timeout: 5_000 });

    const urlEl = page.locator('[data-testid="onboarding-url"]');
    await expect(urlEl).toBeVisible({ timeout: 5_000 });
    const kanoUrl = (await urlEl.textContent()) ?? "";
    expect(kanoUrl).toMatch(/^kanon:\/\//);

    // Step 5 — Extract JWT token
    const token = extractTokenFromUrl(kanoUrl);
    expect(token.length).toBeGreaterThan(20);

    // Step 6 — Simulate CLI: POST /api/auth/onboard
    const onboardResp = await callOnboard(token);
    expect(onboardResp.refreshToken).toBeTruthy();
    expect(onboardResp.apiUrl).toBeTruthy();
    expect(onboardResp.workspace).toBeDefined();
    expect(onboardResp.email).toBeTruthy();

    // Step 7 — Simulate MCP wrapper: POST /api/auth/exchange
    const exchangeResp = await callExchange(onboardResp.refreshToken);
    expect(exchangeResp.accessToken).toBeTruthy();
    expect(exchangeResp.expiresIn).toBe(3600); // 1h

    // Step 8 — Validate access token against GET /api/auth/me
    const me = await apiGet<MeResponse>("/api/auth/me", exchangeResp.accessToken);
    expect(me.email).toBeTruthy();

    // Step 9 — Single-use enforcement: second consumption must be rejected
    const secondResp = await callOnboardRaw(token);
    // Spec S5.3: TOKEN_CONSUMED → HTTP 400; some implementations may also use 410 Gone.
    expect([400, 410]).toContain(secondResp.status);
    const secondBody = await secondResp.json() as { error?: string };
    expect(secondBody.error).toBe("TOKEN_CONSUMED");
  });
});

// ---------------------------------------------------------------------------
// K2 — Kind-guard: web acceptInvite rejects onboarding tokens
// ---------------------------------------------------------------------------

test.describe("Team onboarding — acceptInvite kind guard (K2)", () => {
  /**
   * S5.9 at E2E level:
   *   1. Admin generates an onboarding invite via the API (directly, not via UI).
   *   2. Attempt to consume it via POST /api/invites/:token/accept.
   *   3. Server must return 400 { error: "INVALID_INVITE_KIND" }.
   *   4. No member record is created (tested implicitly by the 400 rejection).
   */
  test("posting an onboarding token to acceptInvite returns 400 INVALID_INVITE_KIND", async () => {
    // Get an admin auth token via API login (no browser needed here)
    const adminToken = await getAuthToken();

    // Resolve workspace ID from seed constants written by global-setup
    const workspaceId = process.env["SEED_WORKSPACE_ID"];
    expect(workspaceId).toBeTruthy();

    // Retrieve member list to pick a valid userId
    const members = await apiGet<Array<{ id: string; user: { id: string; email: string } }>>(
      `/api/workspaces/${workspaceId}/members`,
      adminToken,
    );
    expect(members.length).toBeGreaterThan(0);

    // Pick the first member's user id for the invite
    const targetUserId = members[0]!.user.id;

    // Generate onboarding invite directly via the API
    const invite = await apiPost<OnboardingInviteApiResponse & { inviteId: string }>(
      `/api/workspaces/${workspaceId}/invites/onboarding`,
      { userId: targetUserId },
      adminToken,
    );
    expect(invite.token).toBeTruthy();

    // The acceptInvite endpoint uses the opaque DB token, not the JWT.
    // Fetch the invite list and find ours by id to get the opaque token.
    const list = await apiGet<{ invites: Array<{ id: string; token: string }> }>(
      `/api/workspaces/${workspaceId}/invites`,
      adminToken,
    );
    const created = list.invites.find((i) => i.id === invite.inviteId);
    expect(created).toBeTruthy();
    const opaqueToken = created!.token;

    // Attempt acceptInvite with the onboarding invite's opaque token — must be rejected by kind guard
    const acceptResp = await fetch(
      `${API_BASE}/api/invites/${opaqueToken}/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({}),
      },
    );

    expect(acceptResp.status).toBe(400);
    const body = await acceptResp.json() as { error?: string };
    expect(body.error).toBe("INVALID_INVITE_KIND");
  });
});
