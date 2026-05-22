// ─── Cycle Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient, KanonCycle, KanonCycleDetail } from "../kanon-client.js";
import {
  ListCyclesInput,
  GetCycleInput,
  CreateCycleInput,
  AttachIssuesToCycleShape,
  CloseCycleShape,
  DeleteCycleShape,
} from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import {
  formatList,
  formatCycle,
  formatCycleDetail,
  formatAck,
  formatCycleDelete,
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
): Promise<{ closed: KanonCycle; movedIssueKeys: string[]; disposition: string }> {
  const { cycleId, disposition, projectKey, reason } = input;

  if (disposition === "leave") {
    const closed = await client.closeCycle(cycleId);
    return { closed, movedIssueKeys: [], disposition };
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
    return { closed, movedIssueKeys: incompleteKeys, disposition };
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
  return { closed, movedIssueKeys: incompleteKeys, disposition };
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerCycleTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_cycles",
    "List cycles for projectKey. isActive boolean per entry — use it, don't infer from dates.",
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
    "Get cycle detail (burnup,scope events,risks,issues) by cycleId. includeAllScopeEvents for full audit. Returns slim; format:'full' for entity.",
    GetCycleInput.shape,
    async ({ cycleId, includeAllScopeEvents, format }) => {
      try {
        const cycle = await client.getCycle(cycleId, { includeAllScopeEvents: includeAllScopeEvents ?? false });
        return dataResult(formatCycleDetail(cycle, (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_create_cycle",
    "Create cycle (name,startDate,endDate,state,attachIssueKeys[]). Dates: YYYY-MM-DD or ISO. state:active demotes current active cycle. Returns ack {ok,id,name,state}; format:'full' for entity.",
    CreateCycleInput.shape,
    async ({ projectKey, name, goal, startDate, endDate, state, attachIssueKeys, format }) => {
      try {
        const body: {
          name: string;
          goal?: string;
          startDate: string;
          endDate: string;
          state?: "upcoming" | "active" | "done";
          attachIssueKeys?: string[];
        } = {
          name,
          startDate: normalizeDate(startDate),
          endDate: normalizeDate(endDate),
        };
        if (goal !== undefined) body.goal = goal;
        if (state !== undefined) body.state = state;
        if (attachIssueKeys !== undefined) body.attachIssueKeys = attachIssueKeys;

        const cycle = await client.createCycle(projectKey, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(cycle, "cycle"));
        return dataResult(formatCycle(cycle, fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_attach_issues_to_cycle",
    "Add/remove issues in a cycle (add[],remove[],reason). reason logged in audit trail. Returns ack {ok,cycleId,added,removed,scope,completed}; format:'full' for cycle detail.",
    AttachIssuesToCycleShape,
    async ({ cycleId, add, remove, reason, format }) => {
      try {
        const body: { add?: string[]; remove?: string[]; reason?: string } = {};
        if (add !== undefined) body.add = add;
        if (remove !== undefined) body.remove = remove;
        if (reason !== undefined) body.reason = reason;

        const detail = await client.attachIssuesToCycle(cycleId, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") {
          // Build ack from the cycle detail
          const raw = detail as unknown as Record<string, unknown>;
          const addedKeys = add ?? [];
          const removedKeys = remove ?? [];
          return dataResult(formatAck({
            cycleId,
            added: addedKeys,
            removed: removedKeys,
            scope: raw["scope"] ?? 0,
            completed: raw["completed"] ?? 0,
          }, "cycle-attach"));
        }
        return dataResult(formatCycleDetail(detail, fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_close_cycle",
    "Close cycle with disposition: move_to_next (needs projectKey), move_to_backlog, leave. Returns ack {ok,cycleId,disposition,movedIssueKeys}; format:'full' for detail.",
    CloseCycleShape,
    async (args) => {
      try {
        const summary = await closeCycleWithDisposition(client, {
          cycleId: args.cycleId,
          disposition: args.disposition,
          ...(args.projectKey !== undefined ? { projectKey: args.projectKey } : {}),
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
        });
        const fmt = args.format ?? "ack";
        if (fmt === "ack") {
          return dataResult(formatAck({
            cycleId: args.cycleId,
            disposition: summary.disposition,
            movedIssueKeys: summary.movedIssueKeys,
          }, "cycle-close"));
        }
        return dataResult({
          closed: formatCycle(summary.closed, fmt as Format),
          movedIssueKeys: summary.movedIssueKeys,
          disposition: summary.disposition,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_delete_cycle",
    "Hard-delete a cycle. Active cycles always refused (409). Non-terminal issues block unless force:true. Returns ack with detach count; slim adds detachedIssueKeys; full adds auditLogId.",
    DeleteCycleShape,
    async (args) => {
      try {
        const result = await client.deleteCycle(args.cycleId, {
          force: args.force ?? false,
          reason: args.reason,
        });
        const fmt = args.format ?? "ack";
        return dataResult(formatCycleDelete(result, fmt as "ack" | "slim" | "full"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
