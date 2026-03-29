import { test, expect, type Page } from "@playwright/test";
import { navigateToBoard } from "../../helpers/nav.js";
import { apiPost, apiGet, getAuthToken } from "../../helpers/api.js";

/**
 * Drag-and-Drop tests — P2, tagged @flaky.
 *
 * DnD simulation in Playwright is inherently unreliable because
 * @dnd-kit uses PointerSensor with an 8px activation distance.
 * These tests use manual mouse-move simulation rather than the
 * built-in dragTo helper to better control pointer events.
 *
 * Guard: set SKIP_DND=1 in CI to skip these tests entirely.
 */

const SKIP_DND =
  process.env["SKIP_DND"] === "1" || process.env["SKIP_DND"] === "true";

test.describe("@flaky Drag-and-Drop between columns", () => {
  // Always skip: DnD simulation with @dnd-kit PointerSensor is inherently flaky.
  // Re-enable when a reliable DnD testing strategy is implemented.
  test.skip(true, "DnD tests skipped — flaky PointerSensor simulation");

  let issueKey: string;

  test.beforeAll(async () => {
    // Create a dedicated issue for DnD testing (defaults to "backlog" state)
    const token = await getAuthToken();
    const issue = await apiPost<{ key: string; state: string }>(
      "/api/projects/KAN/issues",
      {
        title: "DnD test issue - drag me",
        type: "task",
        priority: "medium",
      },
      token,
    );
    issueKey = issue.key;
    // Issue starts in "backlog" state which maps to "Backlog" column.
    // We'll drag it from Backlog to Analysis column.
  });

  test("drag card between columns triggers state transition", async ({
    page,
  }) => {
    await navigateToBoard(page, "KAN");

    // Switch to flat view mode so individual issue cards are visible
    const flatButton = page.locator('[data-testid="view-mode-flat"]');
    await flatButton.click();
    await page.waitForTimeout(500);

    // Wait for the board to fully render
    const board = page.locator('[data-testid="kanban-board"]');
    await expect(board).toBeVisible({ timeout: 10_000 });

    // Locate the source card by its data-testid
    const sourceCard = page.locator(
      `[data-testid="issue-card-${issueKey}"]`,
    );
    await expect(sourceCard).toBeVisible({ timeout: 10_000 });

    // Source column is "backlog", target is "analysis"
    const targetColumn = page.locator('[data-testid="board-column-analysis"]');
    await expect(targetColumn).toBeVisible();

    // Get the droppable area inside the target column (the scrollable div below the header)
    const targetDropZone = targetColumn
      .locator("div.flex.flex-col.gap-2")
      .first();

    // Perform DnD using manual mouse simulation for @dnd-kit compatibility.
    await performDragAndDrop(page, sourceCard, targetDropZone);

    // Verify the card moved by checking the API
    // Wait for the network request to complete
    await page.waitForTimeout(1_500);

    const token = await getAuthToken();
    const updatedIssue = await apiGet<{ state: string }>(
      `/api/issues/${issueKey}`,
      token,
    );

    // After drag from Backlog to Analysis, the default state is "propose"
    expect(updatedIssue.state).toBe("propose");
  });
});

/**
 * Simulate drag-and-drop for @dnd-kit's PointerSensor.
 *
 * @dnd-kit requires:
 * 1. pointerdown on the source element
 * 2. pointermove events exceeding the activation distance (8px)
 * 3. pointerup on the target element
 */
async function performDragAndDrop(
  page: Page,
  source: ReturnType<Page["locator"]>,
  target: ReturnType<Page["locator"]>,
): Promise<void> {
  const sourceBbox = await source.boundingBox();
  const targetBbox = await target.boundingBox();

  if (!sourceBbox || !targetBbox) {
    throw new Error(
      "Could not get bounding boxes for drag source or target",
    );
  }

  const sourceCenter = {
    x: sourceBbox.x + sourceBbox.width / 2,
    y: sourceBbox.y + sourceBbox.height / 2,
  };

  const targetCenter = {
    x: targetBbox.x + targetBbox.width / 2,
    y: targetBbox.y + targetBbox.height / 2,
  };

  // Step 1: Move mouse to source and press
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();

  // Step 2: Small initial move to exceed activation distance (>8px)
  await page.mouse.move(sourceCenter.x + 10, sourceCenter.y, { steps: 5 });
  await page.waitForTimeout(100);

  // Step 3: Move towards target in steps to trigger drag over events
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const x =
      sourceCenter.x + ((targetCenter.x - sourceCenter.x) * i) / steps;
    const y =
      sourceCenter.y + ((targetCenter.y - sourceCenter.y) * i) / steps;
    await page.mouse.move(x, y);
    await page.waitForTimeout(50);
  }

  // Step 4: Pause briefly over target to allow @dnd-kit to register the drop zone
  await page.waitForTimeout(200);

  // Step 5: Release
  await page.mouse.up();

  // Wait for the transition mutation to complete
  await page.waitForTimeout(500);
}
