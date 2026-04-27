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
  WriteFormatField,
} from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList, formatEntity, formatAck } from "../transforms.js";
import type { Format } from "../transforms.js";

// Extend CreateIssueInput's shape with the new write-format field. The legacy
// `format: FormatParam.optional()` (slim/full/compact) is overridden to the
// ack-aware enum without breaking other write-tool schemas yet (Batch C wires
// the rest).
const CreateIssueInputShape = { ...CreateIssueInput.shape, ...WriteFormatField };

export function registerIssueTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_issues",
    "List issues in a Kanon project with optional filters",
    ListIssuesInput.shape,
    async ({ projectKey, state, type, priority, assigneeId, cycleId, label, groupKey, format, limit, offset }) => {
      try {
        const filters: Record<string, string> = {};
        if (state) filters["state"] = state;
        if (type) filters["type"] = type;
        if (priority) filters["priority"] = priority;
        if (assigneeId) filters["assigneeId"] = assigneeId;
        if (cycleId) filters["cycleId"] = cycleId;
        if (label) filters["label"] = label;
        if (groupKey) filters["groupKey"] = groupKey;

        const issues = await client.listIssues(projectKey, filters);
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
    "kanon_get_issue",
    "Get full details of a Kanon issue by its key",
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
    "kanon_create_issue",
    "Create a Kanon issue. Title: imperative, no key prefix (e.g. 'Fix login redirect'). Call kanon_list_groups first for valid groupKey. Pass cycleId to attach the issue to a cycle on create — backend emits the scope event natively. Default returns minimal ack `{ok, id, key}`. Pass `format:'full'` to receive the entity.",
    CreateIssueInputShape,
    async (input) => {
      try {
        const {
          projectKey, title, description, type, priority, labels, groupKey,
          assigneeId, cycleId, parentId, dueDate, template, format,
        } = input as z.infer<typeof CreateIssueInput> & { format?: "ack" | "slim" | "full" };
        const body: Record<string, unknown> = { title };
        if (description !== undefined) body["description"] = description;
        if (type !== undefined) body["type"] = type;
        if (priority !== undefined) body["priority"] = priority;
        if (labels !== undefined) body["labels"] = labels;
        if (groupKey !== undefined) body["groupKey"] = groupKey;
        if (assigneeId !== undefined) body["assigneeId"] = assigneeId;
        if (cycleId !== undefined) body["cycleId"] = cycleId;
        if (parentId !== undefined) body["parentId"] = parentId;
        if (dueDate !== undefined) body["dueDate"] = dueDate;
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
    "kanon_update_issue",
    "Update fields of an existing Kanon issue. Always call kanon_get_issue first to read current state before updating — append, don't overwrite. Pass cycleId to attach (or null to detach).",
    UpdateIssueInput.shape,
    async ({ issueKey, title, description, priority, labels, assigneeId, cycleId, dueDate, roadmapItemId, format }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body["title"] = title;
        if (description !== undefined) body["description"] = description;
        if (priority !== undefined) body["priority"] = priority;
        if (labels !== undefined) body["labels"] = labels;
        if (assigneeId !== undefined) body["assigneeId"] = assigneeId;
        if (cycleId !== undefined) body["cycleId"] = cycleId;
        if (dueDate !== undefined) body["dueDate"] = dueDate;
        if (roadmapItemId !== undefined) body["roadmapItemId"] = roadmapItemId;

        const issue = await client.updateIssue(issueKey, body);
        return dataResult(formatEntity(issue, "issue-write", (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_transition_issue",
    "Transition a Kanon issue to a new state. Call kanon_get_issue first to check current state. Valid states: backlog, todo, in_progress, review, done.",
    TransitionIssueInput.shape,
    async ({ issueKey, state, format }) => {
      try {
        const issue = await client.transitionIssue(issueKey, state);
        return dataResult(formatEntity(issue, "issue-write", (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
