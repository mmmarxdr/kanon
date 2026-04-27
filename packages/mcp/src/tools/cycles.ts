// ─── Cycle Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient, KanonCycle, KanonCycleDetail } from "../kanon-client.js";
import {
  ListCyclesInput,
  GetCycleInput,
  CreateCycleInput,
  AttachIssuesToCycleShape,
  CloseCycleShape,
} from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import {
  formatList,
  formatCycle,
  formatCycleDetail,
} from "../transforms.js";
import type { Format } from "../transforms.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a YYYY-MM-DD string to a full ISO datetime at UTC midnight.
 * Pass through full ISO datetimes unchanged.
 */
export function normalizeDate(s: string): string {
  return DATE_ONLY.test(s) ? `${s}T00:00:00.000Z` : s;
}

/**
 * Compose disposition logic for closing a cycle.
 * The backend `POST /cycles/:id/close` does not natively accept a disposition
 * argument, so we orchestrate detach/attach calls before closing — same pattern
 * as the web `close-cycle-dialog`.
 */
export async function closeCycleWithDisposition(
  client: KanonClient,
  input: {
    cycleId: string;
    disposition: "move_to_next" | "move_to_backlog" | "leave";
    projectKey?: string;
    reason?: string;
  },
): Promise<{ closed: KanonCycle; moved: number; disposition: string }> {
  const { cycleId, disposition, projectKey, reason } = input;

  if (disposition === "leave") {
    const closed = await client.closeCycle(cycleId);
    return { closed, moved: 0, disposition };
  }

  // Both move_to_backlog and move_to_next need the current cycle's incomplete issues.
  const detail: KanonCycleDetail = await client.getCycle(cycleId);
  const incompleteKeys = (detail.issues ?? [])
    .filter((i) => i.state !== "done")
    .map((i) => i.key);

  if (disposition === "move_to_backlog") {
    if (incompleteKeys.length > 0) {
      const body: { remove: string[]; reason?: string } = { remove: incompleteKeys };
      if (reason !== undefined) body.reason = reason;
      await client.attachIssuesToCycle(cycleId, body);
    }
    const closed = await client.closeCycle(cycleId);
    return { closed, moved: incompleteKeys.length, disposition };
  }

  // disposition === "move_to_next"
  if (!projectKey) {
    throw new Error(
      "projectKey is required when disposition='move_to_next'",
    );
  }

  const cycles = await client.listCycles(projectKey);
  const currentEnd = new Date(detail.endDate).getTime();
  const candidates = cycles
    .filter((c) =>
      c.id !== cycleId &&
      c.state === "upcoming" &&
      new Date(c.startDate).getTime() >= currentEnd,
    )
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
  const nextCycle = candidates[0];

  if (!nextCycle) {
    throw new Error(
      "No upcoming cycle exists to receive incomplete issues. Create one first or use disposition: 'move_to_backlog' / 'leave'.",
    );
  }

  if (incompleteKeys.length > 0) {
    const removeBody: { remove: string[]; reason?: string } = { remove: incompleteKeys };
    if (reason !== undefined) removeBody.reason = reason;
    await client.attachIssuesToCycle(cycleId, removeBody);

    const addBody: { add: string[]; reason?: string } = { add: incompleteKeys };
    if (reason !== undefined) addBody.reason = reason;
    await client.attachIssuesToCycle(nextCycle.id, addBody);
  }

  const closed = await client.closeCycle(cycleId);
  return { closed, moved: incompleteKeys.length, disposition };
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerCycleTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_cycles",
    "List cycles in a Kanon project. Each entry includes an `isActive` boolean — use it instead of inferring from dates.",
    ListCyclesInput.shape,
    async ({ projectKey, format }) => {
      try {
        const cycles = await client.listCycles(projectKey);
        const result = formatList(
          cycles as unknown[],
          "cycle",
          (format ?? "compact") as Format,
        );
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_get_cycle",
    "Get a Kanon cycle's full detail. Use to inspect burnup progress, scope changes, computed risks, and attached issues before proposing changes.",
    GetCycleInput.shape,
    async ({ cycleId, format }) => {
      try {
        const cycle = await client.getCycle(cycleId);
        return dataResult(formatCycleDetail(cycle, (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_create_cycle",
    "Create a Kanon cycle. Dates accept YYYY-MM-DD or full ISO. Setting state='active' demotes any other active cycle in the project.",
    CreateCycleInput.shape,
    async ({ projectKey, name, goal, startDate, endDate, state, format }) => {
      try {
        const body: {
          name: string;
          goal?: string;
          startDate: string;
          endDate: string;
          state?: "upcoming" | "active" | "done";
        } = {
          name,
          startDate: normalizeDate(startDate),
          endDate: normalizeDate(endDate),
        };
        if (goal !== undefined) body.goal = goal;
        if (state !== undefined) body.state = state;

        const cycle = await client.createCycle(projectKey, body);
        return dataResult(formatCycle(cycle, (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_attach_issues_to_cycle",
    "Move issues into or out of a cycle. Use for AI-driven scope changes. Provide a `reason` when the change isn't trivial — it appears in the cycle's scope event audit trail.",
    AttachIssuesToCycleShape,
    async ({ cycleId, add, remove, reason, format }) => {
      try {
        const body: { add?: string[]; remove?: string[]; reason?: string } = {};
        if (add !== undefined) body.add = add;
        if (remove !== undefined) body.remove = remove;
        if (reason !== undefined) body.reason = reason;

        const detail = await client.attachIssuesToCycle(cycleId, body);
        return dataResult(formatCycleDetail(detail, (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_close_cycle",
    "Close a cycle and dispose of incomplete issues. disposition: 'move_to_next' (requires projectKey, attaches incomplete issues to the next upcoming cycle), 'move_to_backlog' (detach incomplete issues), or 'leave' (keep them attached). Velocity is computed from done issues.",
    CloseCycleShape,
    async (args) => {
      try {
        const summary = await closeCycleWithDisposition(client, {
          cycleId: args.cycleId,
          disposition: args.disposition,
          ...(args.projectKey !== undefined ? { projectKey: args.projectKey } : {}),
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
        });
        return dataResult({
          closed: formatCycle(summary.closed, (args.format ?? "slim") as Format),
          moved: summary.moved,
          disposition: summary.disposition,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
