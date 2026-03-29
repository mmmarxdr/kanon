// ─── Group Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { ListGroupsInput, BatchTransitionInput } from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList } from "../transforms.js";

export function registerGroupTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_groups",
    "List issue groups for a Kanon project",
    ListGroupsInput.shape,
    async ({ projectKey, format, limit, offset }) => {
      try {
        const groups = await client.listIssueGroups(projectKey);
        return dataResult(formatList(groups, "group", (format ?? "compact"), limit, offset));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_batch_transition",
    "Batch-transition all issues in a group to a new state",
    BatchTransitionInput.shape,
    async ({ projectKey, groupKey, state, format }) => {
      try {
        const result = await client.batchTransition(projectKey, groupKey, state);
        if (format === "full") return dataResult(result);
        const count = Array.isArray(result) ? result.length : (result as unknown as Record<string, unknown>)["count"] ?? 0;
        return dataResult({ transitioned: count, state });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
