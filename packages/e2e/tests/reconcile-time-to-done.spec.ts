/**
 * E2E: Reconcile Time Surfaces — regression gate (KAN-188)
 *
 * Prerequisites:
 *   - Dev stack must be running: `pnpm dev:start`
 *   - Fresh E2E database: global-setup.ts runs `prisma migrate reset --force && prisma db seed`
 *   - Seed admin user: dev@kanon.io / Password123!  (written to .env.test by global-setup.ts)
 *   - Environment: DATABASE_URL points to `kanon_e2e` Postgres DB
 *   - API_PORT (default 3001) and WEB_PORT (default 5174) must be free
 *
 * This is the load-bearing regression gate from the KAN-188 spec
 * ("Regression gate for the full capture-to-done path"):
 *
 *   The system MUST have an automated test proving the full supported path
 *   `start_work -> stop_work -> transition->done` succeeds end-to-end through
 *   the reconcile flow, so a backend-only (unreachable) reconcile capability
 *   can never ship again without failing this test.
 *
 * Every step below goes through a REAL client-facing surface:
 *   - start_work / stop_work: POST/DELETE /api/issues/:key/work-sessions (the
 *     real HTTP endpoints a client — web, MCP, or CLI — calls; not a direct
 *     service-layer or DB call).
 *   - the transition to "done": a real drag-and-drop in the web UI, which is
 *     the ONLY UI path that invokes useTransitionMutation (kanban-board.tsx
 *     has no button/select alternative — see use-transition-mutation.ts).
 *   - the reconcile confirmation: a real click on the ReconcileModal's
 *     "Confirm & move to done" button, which calls the same
 *     POST /api/issues/:key/reconcile-time the web app calls in production.
 *
 * If ANY of these steps were unreachable through their real surface — e.g. the
 * 409 was thrown by the API but the web client silently swallowed it, or the
 * modal never rendered, or the retried transition never fired — this test
 * fails, because it asserts on user-visible state at every step (see the
 * "no dead-end" comment on the modal-appearance assertion below).
 */

import { test, expect } from "@playwright/test";
import { apiPost, apiDelete, getAuthToken } from "../helpers/api.js";
import { navigateToBoard } from "../helpers/nav.js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reload seed constants written by global-setup.ts
dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

const PROJECT_KEY = "KAN";

interface CreatedIssue {
  key: string;
}

test.describe("Reconcile time surfaces — full capture-to-done regression gate", () => {
  test("start_work -> stop_work -> drag to done -> reconcile modal -> confirmed -> done", async ({
    page,
  }) => {
    // The stop_work step below must wait past the server's 60s
    // MIN_WORKLOG_DURATION_S floor for a real WorkLog to be persisted —
    // extend this test's timeout well past the config default (30s).
    test.setTimeout(90_000);

    const adminToken = await getAuthToken();

    // ------------------------------------------------------------------
    // Step 1 — Seed an issue with NO prior captured time, via the real
    // "create issue" API surface (not a raw DB insert).
    // ------------------------------------------------------------------
    const issue = await apiPost<CreatedIssue>(
      `/api/projects/${PROJECT_KEY}/issues`,
      {
        title: `E2E reconcile gate ${Date.now()}`,
        type: "task",
      },
      adminToken
    );
    expect(issue.key).toBeTruthy();

    // ------------------------------------------------------------------
    // Step 2 — Give the issue UNCONFIRMED captured time the faithful way:
    // start_work then stop_work, through the real work-session API surface
    // (POST /api/issues/:key/work-sessions, DELETE .../work-sessions).
    // This is exactly what a real client (web "start timer" action, MCP
    // start_work/stop_work tools, or CLI) does — never a raw WorkLog insert.
    // ------------------------------------------------------------------
    await apiPost(`/api/issues/${issue.key}/work-sessions`, { source: "e2e" }, adminToken);
    // stopWork only persists a WorkLog when the elapsed duration is at least
    // MIN_WORKLOG_DURATION_S (60s, packages/api/src/modules/work-session/service.ts)
    // — below that floor stopWork silently no-ops (workLog: null) and no
    // captured time exists, so the reconcile gate would never trigger and this
    // test would give a false pass. Wait past the floor for a real WorkLog row.
    await page.waitForTimeout(61_000);
    await apiDelete(`/api/issues/${issue.key}/work-sessions`, adminToken);

    // ------------------------------------------------------------------
    // Step 3 — Log in and navigate to the board (reuse existing helpers).
    // ------------------------------------------------------------------
    await navigateToBoard(page, PROJECT_KEY, "flat");

    const card = page.locator(`[data-testid="issue-card-${issue.key}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    const doneColumn = page.locator('[data-testid="board-column-done"]');
    await expect(doneColumn).toBeVisible();

    // ------------------------------------------------------------------
    // Step 4 — Move the issue to "done" through the WEB UI: a real
    // drag-and-drop, the only path that invokes useTransitionMutation.
    // dnd-kit's PointerSensor requires an activation distance (8px) to be
    // exceeded before a drag starts, so the pointer sequence below moves
    // in multiple steps rather than jumping directly to the target.
    // ------------------------------------------------------------------
    const cardBox = await card.boundingBox();
    const targetBox = await doneColumn.boundingBox();
    if (!cardBox || !targetBox) {
      throw new Error("Could not resolve bounding boxes for drag-and-drop");
    }

    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + Math.min(targetBox.height / 2, 200);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Exceed the 8px pointer activation distance before the real move.
    await page.mouse.move(startX + 12, startY + 12, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 15 });
    await page.mouse.up();

    // ------------------------------------------------------------------
    // Step 5 — THE ANTI-REGRESSION ASSERTION: the reconcile modal MUST
    // appear, showing the captured hours reported by the API's 409
    // RECONCILIATION_REQUIRED payload. If the web/api reconcile surface
    // were unwired (e.g. the 409 detail were dropped by ApiError, or the
    // hook never set reconcileState, or the modal were never mounted),
    // no modal would appear here and this assertion — not a generic
    // "did not throw" check — is what fails the test.
    // ------------------------------------------------------------------
    const modal = page.locator('[data-testid="reconcile-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal).toHaveAttribute("role", "dialog");

    const reportedHours = modal.locator('[data-testid="reconcile-reported-hours"]');
    await expect(reportedHours).toBeVisible();
    const reportedText = (await reportedHours.textContent()) ?? "";
    expect(Number(reportedText)).toBeGreaterThanOrEqual(0);

    // ------------------------------------------------------------------
    // Step 6 — Confirm in the modal, accepting the reported hours as-is
    // (no adjustment), via the real "Confirm & move to done" button. This
    // calls the same POST /api/issues/:key/reconcile-time endpoint a real
    // client uses, then retries the transition — both through the web
    // mutation, not a direct service call.
    //
    // NOTE on the "would fail if dead-ended" requirement: had step 5's
    // modal assertion not appeared (the 409 dead-ended with no modal),
    // this test would already have failed at the `toBeVisible` above —
    // there is no fallback path here, which is the point of the gate.
    // ------------------------------------------------------------------
    const confirmBtn = page.getByRole("button", {
      name: "Confirm & move to done",
    });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // ------------------------------------------------------------------
    // Step 7 — Assert the issue actually reaches "done": the modal closes
    // and the card ends up in the Done column on refetch.
    // ------------------------------------------------------------------
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    const cardInDone = doneColumn.locator(`[data-testid="issue-card-${issue.key}"]`);
    await expect(cardInDone).toBeVisible({ timeout: 10_000 });
  });
});
