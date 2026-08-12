import { test, expect } from "@playwright/test";
import { apiDelete, apiPost, getAuthToken } from "../../helpers/api.js";
import { login } from "../../helpers/auth.js";

interface CreatedIssue {
  key: string;
}

const SYNCED_HISTORY_COUNT = 12;
const issueDescription = [
  "# Single-scroll fixture",
  ...Array.from({ length: 28 }, (_, index) => `Reading paragraph ${index}: ${"content ".repeat(20)}`),
  `\`\`\`ts\nconst oversized = \"${"x".repeat(1_200)}\";\n\`\`\``,
  [
    `| ${Array.from({ length: 20 }, (_, index) => `column-${index}`).join(" | ")} |`,
    `| ${Array.from({ length: 20 }, () => "---").join(" | ")} |`,
    `| ${Array.from({ length: 20 }, (_, index) => `value-${index}`).join(" | ")} |`,
  ].join("\n"),
].join("\n\n");

async function inspectVerticalOwners(page: import("@playwright/test").Page) {
  return page.locator(".issue-detail-layout").evaluate((layout: any) => {
    const nodes = [
      layout.ownerDocument.scrollingElement,
      layout.ownerDocument.querySelector(".issue-page"),
      layout,
      ...layout.querySelectorAll("*"),
    ].filter((node, index, all) => node && all.indexOf(node) === index);
    return nodes
      .filter((node: any) => typeof node?.scrollHeight === "number")
      .filter((node: any) => {
        const style = node.ownerDocument.defaultView.getComputedStyle(node);
        return ["auto", "scroll", "overlay"].includes(style.overflowY)
          && node.scrollHeight > node.clientHeight + 1;
      })
      .map((node) => ({ id: node.id, className: node.className, tagName: node.tagName }));
  });
}

test.describe("Issue detail single-scroll workspace", () => {
  let issueKey: string;
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
    const created = await apiPost<CreatedIssue>(
      "/api/projects/KAN/issues",
      { title: "Single scroll coverage", type: "task", priority: "medium", description: issueDescription },
      token,
    );
    issueKey = created.key;

    await apiPost(`/api/issues/${issueKey}/comments`, { body: "Visible Kanon note", source: "human" }, token);
    for (let index = 0; index < SYNCED_HISTORY_COUNT; index += 1) {
      await apiPost(
        `/api/issues/${issueKey}/comments`,
        { body: `Synced history row ${index}`, source: "human" },
        token,
        { headers: { "X-Kanon-Client": "codex" } },
      );
    }
  });

  test.afterAll(async () => {
    await apiDelete(`/api/issues/${issueKey}`, token, {});
  });

  test("keeps exactly one real vertical owner and responsive metadata behavior at wide and narrow breakpoints", async ({ page }) => {
    await login(page);

    for (const viewport of [{ width: 1440, height: 800 }, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`/issue/${issueKey}`);
      const scroll = page.getByTestId("issue-detail-scroll");
      const rail = page.locator(".issue-metadata-rail");
      await expect(scroll).toBeVisible();
      await expect(rail).toBeVisible();
      await expect.poll(() => inspectVerticalOwners(page)).toEqual([
        expect.objectContaining({ id: "issue-detail-scroll" }),
      ]);

      const movement = await scroll.evaluate((element) => {
        const before = element.scrollTop;
        element.scrollTop = element.clientHeight;
        return { before, after: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
      });
      expect(movement.scrollHeight).toBeGreaterThan(movement.clientHeight);
      expect(movement.after).toBeGreaterThan(movement.before);

      const railIsVerticalOwner = await rail.evaluate((element) => {
        const style = element.ownerDocument.defaultView!.getComputedStyle(element);
        return ["auto", "scroll", "overlay"].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
      });
      expect(railIsVerticalOwner).toBe(false);

      const position = await rail.evaluate((element) => element.ownerDocument.defaultView!.getComputedStyle(element).position);
      if (viewport.width >= 1024) {
        expect(position).toBe("sticky");
      } else {
        expect(position).toBe("static");
        const reachability = await scroll.evaluate((workspace) => {
          const metadata = workspace.querySelector(".issue-metadata-rail") as any;
          if (!metadata) return { descendant: false, before: workspace.scrollTop, after: workspace.scrollTop };
          const before = workspace.scrollTop;
          workspace.scrollTop = metadata.offsetTop;
          return { descendant: workspace.contains(metadata), before, after: workspace.scrollTop };
        });
        expect(reachability.descendant).toBe(true);
        expect(reachability.after).toBeGreaterThan(reachability.before);
        await expect(rail).toBeInViewport();
      }
    }
  });

  test("moves all section targets in one document, announces current location, and disables smooth scrolling for reduced motion", async ({ page }) => {
    await page.addInitScript(() => {
      const globals = globalThis as any;
      const prototype = globals.Element.prototype;
      const original = prototype.scrollIntoView;
      globals.issueScrollBehaviors = [];
      prototype.scrollIntoView = function scrollIntoViewSpy(options: any) {
        globals.issueScrollBehaviors.push(typeof options === "object" ? options?.behavior : undefined);
        return original.call(this, options);
      };
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);
    await page.goto(`/issue/${issueKey}`);

    for (const section of ["General", "Activity", "Relationships", "Resources", "Development"]) {
      await page.getByRole("button", { name: section }).click();
      await expect(page.getByRole("heading", { name: section })).toBeFocused();
      await expect(page.getByRole("button", { name: section })).toHaveAttribute("aria-current", "location");
      await expect(page.getByTestId("issue-section-announcement")).toHaveText(`${section} section`);
    }

    await expect.poll(() => page.evaluate(() => (globalThis as any).issueScrollBehaviors)).toContain("auto");
  });

  test("renders full in-flow synced history and notes, preserves horizontal-only Markdown, and keeps the composer in document flow", async ({ page }) => {
    await login(page);
    await page.goto(`/issue/${issueKey}`);

    const general = page.locator("#issue-section-general");
    await expect(general.getByRole("heading", { name: "Kanon / Redmine notes" })).toBeVisible();
    await expect(general.getByText("Visible Kanon note")).toBeVisible();
    await expect(general.getByText("Synced history row 0")).toHaveCount(0);
    await expect(general.getByText(/created this issue/)).toHaveCount(0);

    await page.getByRole("button", { name: "Activity" }).click();
    await expect(page.locator("#issue-section-activity").getByText("Synced history row 0")).toBeVisible();
    await expect(page.locator("#issue-section-activity").getByText(/created this issue/)).toBeVisible();

    await page.getByRole("button", { name: "Resources" }).click();
    const rows = page.getByTestId("synced-row");
    await expect(rows).toHaveCount(SYNCED_HISTORY_COUNT);
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last()).toBeVisible();
    await expect(rows.last()).toContainText(/Synced history row \d+/);

    const summary = page.getByTestId("synced-tools-summary");
    await expect(summary).toContainText(`${SYNCED_HISTORY_COUNT} synced tool items`);
    await expect(summary.getByTestId("synced-tools-summary-latest")).toHaveCount(1);
    await expect(summary).toContainText("Codex");

    await page.getByRole("button", { name: "General" }).click();
    const pre = general.locator("pre");
    const table = general.locator(".markdown-table-scroll");
    await expect(pre).toBeVisible();
    await expect(table).toBeVisible();
    for (const markdown of [pre, table]) {
      const overflow = await markdown.evaluate((element) => {
        const style = element.ownerDocument.defaultView!.getComputedStyle(element);
        element.scrollLeft = 100;
        return { scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollLeft: element.scrollLeft, overflowY: style.overflowY };
      });
      expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
      expect(overflow.scrollLeft).toBeGreaterThan(0);
      expect(overflow.overflowY).toBe("hidden");
    }

    await page.getByRole("button", { name: "Activity" }).click();
    const composer = page.getByRole("textbox");
    await composer.fill(Array.from({ length: 20 }, (_, index) => `long composer line ${index}`).join("\n"));
    const composerLayout = await composer.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: element.ownerDocument.defaultView!.getComputedStyle(element).overflowY }));
    // Chromium rounds textarea layout to pixels; one sub-pixel difference is not a scrollbar.
    expect(composerLayout.clientHeight + 1).toBeGreaterThanOrEqual(composerLayout.scrollHeight);
    expect(composerLayout.overflowY).toBe("hidden");

    const submitted = "Composer lifecycle browser evidence";
    await composer.fill(submitted);
    await composer.press("Control+Enter");
    await expect(composer).toBeFocused();
    await expect(page.locator("#issue-section-activity").getByText(submitted)).toBeVisible();
  });

  test("deletes an authorized issue and replace-navigates to its originating board", async ({ page }) => {
    const issue = await apiPost<CreatedIssue>(
      "/api/projects/KAN/issues",
      { title: "Deletion route evidence", type: "task", priority: "medium" },
      token,
    );
    await login(page);
    await page.goto(`/issue/${issue.key}?from=board`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.waitForURL("**/board/KAN");
    await expect(page).toHaveURL(/\/board\/KAN$/);
  });

  test("renders the real API 404 as the safe five-landmark not-found document", async ({ page }) => {
    await login(page);
    await page.goto("/issue/KAN-999999999");

    await expect(page.getByTestId("issue-detail-scroll")).toBeVisible();
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Development" })).toBeVisible();
    await expect(page.getByText("This issue could not be found.")).toHaveCount(5);
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });
});
