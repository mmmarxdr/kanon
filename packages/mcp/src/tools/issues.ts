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
    "List issues with filters (state,type,priority,assigneeId,cycleId,label,groupKey,keys[]). Returns slim list.",
    ListIssuesInput.shape,
    async ({ projectKey, state, type, priority, assigneeId, cycleId, label, groupKey, keys, format, limit, offset }) => {
      try {
        const filters: Record<string, string> & { keys?: string[] } = {};
        if (state) filters["state"] = state;
        if (type) filters["type"] = type;
        if (priority) filters["priority"] = priority;
        if (assigneeId) filters["assigneeId"] = assigneeId;
        if (cycleId) filters["cycleId"] = cycleId;
        if (label) filters["label"] = label;
        if (groupKey) filters["groupKey"] = groupKey;
        if (keys && keys.length > 0) filters["keys"] = keys;

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
    "kanon_create_issue",
    "Create issue (projectKey,title,description,type,priority,labels,groupKey,assigneeId,cycleId,parentId,dueDate,template). Title: imperative verb. kanon_list_groups for groupKey. cycleId attaches on create. Returns ack {ok,id,key}; format:'full' for entity.",
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
    "Update issue (issueKey,title,description,priority,labels,assigneeId,cycleId,dueDate,roadmapItemId). Read first, append don't overwrite. cycleId=null detaches. Returns ack {ok,id,key}; format:'full' for entity.",
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
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(issue, "issue"));
        return dataResult(formatEntity(issue, "issue-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_transition_issue",
    "Transition issueKey to state (backlog,todo,in_progress,review,done). Returns ack {ok,id,key}; format:'full' for entity.",
    TransitionIssueInput.shape,
    async ({ issueKey, state, format }) => {
      try {
        const issue = await client.transitionIssue(issueKey, state);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(issue, "issue"));
        return dataResult(formatEntity(issue, "issue-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

}
