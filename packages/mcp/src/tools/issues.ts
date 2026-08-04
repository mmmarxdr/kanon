// ─── Issue Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { z } from "zod";
import {
  ListIssuesInput,
  GetIssueInput,
  CreateIssueInput,
  UpdateIssueInput,
  TransitionIssueInput,
  ReconcileTimeInput,
  WriteFormatField,
} from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList, formatEntity, formatAck } from "../transforms.js";
import type { Format } from "../transforms.js";
import { resolveProjectKey } from "../binding-resolver.js";
import type { InvalidBinding } from "../binding-resolver.js";
import { normalizeDate } from "./cycles.js";
import type { KanonBinding } from "../kanon-binding.js";
import { KanonApiError } from "../kanon-client.js";

// Extend CreateIssueInput's shape with the new write-format field. The legacy
// `format: FormatParam.optional()` (slim/full/compact) is overridden to the
// ack-aware enum without breaking other write-tool schemas yet (Batch C wires
// the rest).
const CreateIssueInputShape = { ...CreateIssueInput.shape, ...WriteFormatField };

// KAN-188: `details.totalHours` on the 409 RECONCILIATION_REQUIRED payload is
// untyped (Record<string, unknown>) — validate before interpolating it into a
// user-facing message so a missing/absent field never renders as the literal
// string "undefined". Accepts a finite number or a numeric string (e.g. "5.5").
function toFiniteHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function registerIssueTools(server: McpServer, client: KanonClient, binding: KanonBinding | InvalidBinding | null = null): void {
  server.tool(
    "list_issues",
    "List issues with filters (state,type,priority,assigneeId,cycleId,label,groupKey,keys[]). Returns slim list.",
    ListIssuesInput.shape,
    async ({ projectKey, state, type, priority, assigneeId, cycleId, label, groupKey, keys, format, limit, offset }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));

        const filters: Record<string, string> & { keys?: string[] } = {};
        if (state) filters["state"] = state;
        if (type) filters["type"] = type;
        if (priority) filters["priority"] = priority;
        if (assigneeId) filters["assigneeId"] = assigneeId;
        if (cycleId) filters["cycleId"] = cycleId;
        if (label) filters["label"] = label;
        if (groupKey) filters["groupKey"] = groupKey;
        if (keys && keys.length > 0) filters["keys"] = keys;

        const issues = await client.listIssues(resolved.projectKey, filters);
        const result = formatList(
          issues as unknown[],
          "issue",
          (format ?? "compact") as Format,
          limit ?? undefined,
          offset ?? undefined,
        );
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_issue",
    "Get issue detail by issueKey. Returns slim; format:'full' for full entity.",
    GetIssueInput.shape,
    async ({ issueKey, format }) => {
      try {
        const issue = await client.getIssue(issueKey);
        const result = formatEntity(issue, "issue-detail", (format ?? "slim") as Format);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── Write Tools ────────────────────────────────────────────────────────

  server.tool(
    "create_issue",
    "Create PM-facing issue; no local paths/worktrees. Title: [Area] imperative verb. Call list_groups for groupKey; if starting now pass list_members.memberId as assigneeId. Returns ack; format:'full' for entity.",
    CreateIssueInputShape,
    async (input) => {
      try {
        const {
          projectKey: explicitProjectKey, title, description, type, priority, labels, groupKey,
          assigneeId, cycleId, parentId, template, format,
        } = input as z.infer<typeof CreateIssueInput> & { format?: "ack" | "slim" | "full" };
        const resolved = resolveProjectKey(explicitProjectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const projectKey = resolved.projectKey;
        const body: Record<string, unknown> = { title };
        if (description !== undefined) body["description"] = description;
        if (type !== undefined) body["type"] = type;
        if (priority !== undefined) body["priority"] = priority;
        if (labels !== undefined) body["labels"] = labels;
        if (groupKey !== undefined) body["groupKey"] = groupKey;
        if (assigneeId !== undefined) body["assigneeId"] = assigneeId;
        if (cycleId !== undefined) body["cycleId"] = cycleId;
        if (parentId !== undefined) body["parentId"] = parentId;
        if (template !== undefined) body["templateKey"] = template;

        const issue = await client.createIssue(projectKey, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") {
          return dataResult(formatAck(issue, "issue"));
        }
        return dataResult(formatEntity(issue, "issue-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_issue",
    "Update issue and plan fields. Read first, append don't overwrite. Dates accept YYYY-MM-DD or ISO; cycleId=null detaches. Returns ack {ok,id,key}; format:'full' for entity.",
    UpdateIssueInput.shape,
    async ({
      issueKey,
      title,
      description,
      type,
      priority,
      labels,
      groupKey,
      assigneeId,
      cycleId,
      parentId,
      roadmapItemId,
      startDate,
      dueDate,
      progress,
      format,
    }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body["title"] = title;
        if (description !== undefined) body["description"] = description;
        if (type !== undefined) body["type"] = type;
        if (priority !== undefined) body["priority"] = priority;
        if (labels !== undefined) body["labels"] = labels;
        if (groupKey !== undefined) body["groupKey"] = groupKey;
        if (assigneeId !== undefined) body["assigneeId"] = assigneeId;
        if (cycleId !== undefined) body["cycleId"] = cycleId;
        if (parentId !== undefined) body["parentId"] = parentId;
        if (roadmapItemId !== undefined) body["roadmapItemId"] = roadmapItemId;

        const schedule = {
          ...(startDate !== undefined ? { startDate: normalizeDate(startDate) } : {}),
          ...(dueDate !== undefined ? { dueDate: normalizeDate(dueDate) } : {}),
          ...(progress !== undefined ? { progress } : {}),
        };
        let issue = Object.keys(body).length > 0
          ? await client.updateIssue(issueKey, body)
          : await client.getIssue(issueKey);
        if (Object.keys(schedule).length > 0) {
          await client.updateIssueSchedule(issueKey, schedule);
          issue = await client.getIssue(issueKey);
        }
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(issue, "issue"));
        return dataResult(formatEntity(issue, "issue-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "transition_issue",
    "Transition issueKey to state (backlog,todo,in_progress,review,done). Returns ack {ok,id,key}; format:'full' for entity. Done with unconfirmed time is blocked — call reconcile_time then retry.",
    TransitionIssueInput.shape,
    async ({ issueKey, state, format }) => {
      try {
        const issue = await client.transitionIssue(issueKey, state);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(issue, "issue"));
        return dataResult(formatEntity(issue, "issue-write", fmt as Format));
      } catch (err) {
        // KAN-188: the review→done reconcile gate blocks with a 409 carrying
        // the captured hours in `details.totalHours`. Surface it directly so
        // the agent can act (accept-as-is or adjust) instead of hitting a
        // dead-end error — do NOT auto-reconcile silently.
        if (
          err instanceof KanonApiError &&
          err.code === "RECONCILIATION_REQUIRED" &&
          state === "done"
        ) {
          const rawTotalHours = err.details?.["totalHours"];
          const totalHours = toFiniteHours(rawTotalHours);
          const message =
            totalHours !== null
              ? `${totalHours} hours were reported on this ticket and need confirmation. ` +
                `Call reconcile_time with issueKey "${issueKey}" and confirmedTotalHours ` +
                `(accept ${totalHours}, or set a corrected value), then retry the transition to done.`
              : `This ticket has unconfirmed reported time that must be confirmed before it can move to done. ` +
                `Call reconcile_time with issueKey "${issueKey}" (optionally set confirmedTotalHours to ` +
                `correct the total), then retry the transition to done.`;
          return errorResult(
            new KanonApiError(err.statusCode, err.code, message, err.details),
          );
        }
        return errorResult(err);
      }
    },
  );

  server.tool(
    "reconcile_time",
    "Reconcile captured time on issueKey — clears the review→done gate. confirmedTotalHours accepts reported hours as-is or corrects up/down, then retry transition_issue to done.",
    ReconcileTimeInput.shape,
    async ({ issueKey, confirmedTotalHours }) => {
      try {
        const body: Record<string, unknown> = {};
        if (confirmedTotalHours !== undefined) body["confirmedTotalHours"] = confirmedTotalHours;

        const summary = await client.reconcileTime(issueKey, body);
        return dataResult(summary);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

}
