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
import { resolveProjectKey } from "../binding-resolver.js";
import type { InvalidBinding } from "../binding-resolver.js";
import type { KanonBinding } from "../kanon-binding.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Thrown when a multi-step cycle close sequence fails mid-way.
 * Carries a human/agent-readable description of what completed, what failed,
 * and any compensation attempted — so the caller can surface it precisely
 * rather than a generic error message.
 */
export class PartialCycleMutationError extends Error {
  public readonly failedStep: string;
  public readonly partialState: string;
  public readonly compensationAttempted: boolean;
  public readonly compensationSucceeded: boolean | null;

  constructor(opts: {
    failedStep: string;
    partialState: string;
    compensationAttempted?: boolean;
    compensationSucceeded?: boolean | null;
    cause?: unknown;
  }) {
    const comp = opts.compensationAttempted
      ? opts.compensationSucceeded
        ? " Compensation (re-attach to current cycle) succeeded."
        : " Compensation (re-attach to current cycle) also failed — manual recovery required."
      : "";
    super(
      `Partial mutation: step '${opts.failedStep}' failed. ${opts.partialState}.${comp}`,
    );
    this.name = "PartialCycleMutationError";
    this.failedStep = opts.failedStep;
    this.partialState = opts.partialState;
    this.compensationAttempted = opts.compensationAttempted ?? false;
    this.compensationSucceeded = opts.compensationSucceeded ?? null;
    if (opts.cause instanceof Error) {
      this.cause = opts.cause;
    }
  }
}

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
    // If closeCycle fails here, issues have already been detached from the cycle.
    // There is no safe automatic compensation (re-attaching would undo the user's intent).
    try {
      const closed = await client.closeCycle(cycleId);
      return { closed, movedIssueKeys: incompleteKeys, disposition };
    } catch (err) {
      throw new PartialCycleMutationError({
        failedStep: "close cycle",
        partialState: incompleteKeys.length > 0
          ? `Issues [${incompleteKeys.join(", ")}] were detached from cycle ${cycleId} (moved to backlog) but the cycle was NOT closed`
          : `No issues needed moving but cycle ${cycleId} was NOT closed`,
        compensationAttempted: false,
        cause: err,
      });
    }
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

    // Step: attach to next cycle. If this fails, issues are in limbo (detached from current,
    // not yet in next). Attempt compensation: re-attach to current cycle.
    const addBody: { add: string[]; reason?: string } = { add: incompleteKeys };
    if (reason !== undefined) addBody.reason = reason;
    try {
      await client.attachIssuesToCycle(nextCycle.id, addBody);
    } catch (addErr) {
      let compensationSucceeded: boolean | null = null;
      try {
        const reattachBody: { add: string[]; reason?: string } = { add: incompleteKeys };
        if (reason !== undefined) reattachBody.reason = reason;
        await client.attachIssuesToCycle(cycleId, reattachBody);
        compensationSucceeded = true;
      } catch {
        compensationSucceeded = false;
      }
      throw new PartialCycleMutationError({
        failedStep: "attach issues to next cycle",
        partialState: `Issues [${incompleteKeys.join(", ")}] were detached from cycle ${cycleId} but could NOT be attached to next cycle ${nextCycle.id} (${nextCycle.name})`,
        compensationAttempted: true,
        compensationSucceeded,
        cause: addErr,
      });
    }
  }

  // Step: close the current cycle. By this point issues are already in the next cycle.
  // No safe compensation — do not move issues back, just report the partial state clearly.
  try {
    const closed = await client.closeCycle(cycleId);
    return { closed, movedIssueKeys: incompleteKeys, disposition };
  } catch (err) {
    throw new PartialCycleMutationError({
      failedStep: "close cycle",
      partialState: incompleteKeys.length > 0
        ? `Issues [${incompleteKeys.join(", ")}] were successfully moved to next cycle ${nextCycle.id} (${nextCycle.name}) but cycle ${cycleId} was NOT closed`
        : `No issues needed moving; cycle ${cycleId} was NOT closed`,
      compensationAttempted: false,
      cause: err,
    });
  }
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerCycleTools(server: McpServer, client: KanonClient, binding: KanonBinding | InvalidBinding | null = null): void {
  server.tool(
    "list_cycles",
    "List cycles for projectKey. isActive boolean per entry — use it, don't infer from dates.",
    ListCyclesInput.shape,
    async ({ projectKey, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const cycles = await client.listCycles(resolved.projectKey);
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
    "get_cycle",
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
    "create_cycle",
    "Create cycle (name,startDate,endDate,state,attachIssueKeys[]). Dates YYYY-MM-DD/ISO. state:active demotes current active. Returns ack {ok,id,name,state}.",
    CreateCycleInput.shape,
    async ({ projectKey, name, goal, startDate, endDate, state, attachIssueKeys, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));

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

        const cycle = await client.createCycle(resolved.projectKey, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(cycle, "cycle"));
        return dataResult(formatCycle(cycle, fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_cycle_scope",
    "Add/remove issues in a cycle (add[],remove[],reason). reason audited. Returns ack {ok,cycleId,added,removed}.",
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
    "close_cycle",
    "Close cycle with disposition: move_to_next (needs projectKey), move_to_backlog, leave. Returns ack {ok,cycleId,disposition,movedIssueKeys}.",
    CloseCycleShape,
    async (args) => {
      try {
        // For move_to_next, projectKey is required — route through resolveProjectKey
        // so we get: explicit wins, binding fallback, invalid/.kanon guidance on error.
        // leave / move_to_backlog do NOT need projectKey — skip resolution.
        let effectiveProjectKey: string | undefined;
        if (args.disposition === "move_to_next") {
          const resolved = resolveProjectKey(args.projectKey, binding);
          if (!resolved.ok) return errorResult(new Error(resolved.error));
          effectiveProjectKey = resolved.projectKey;
        } else {
          effectiveProjectKey = args.projectKey ?? undefined;
        }

        const summary = await closeCycleWithDisposition(client, {
          cycleId: args.cycleId,
          disposition: args.disposition,
          ...(effectiveProjectKey !== undefined ? { projectKey: effectiveProjectKey } : {}),
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
    "delete_cycle",
    "Hard-delete a cycle. Active refused (409). Non-terminal issues block unless force:true. Returns ack + detach count; slim adds detachedIssueKeys.",
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
