// ─── Group Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { ListGroupsInput, BatchTransitionInput } from "../types.js";
import { errorResult, successResult } from "../errors.js";
import { formatList } from "../transforms.js";

export function registerGroupTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_groups",
    "List issue groups for a Kanon project",
    ListGroupsInput.shape,
    async ({ projectKey, format, limit, offset }) => {
      try {
        const groups = await client.listIssueGroups(projectKey);
        return successResult(formatList(groups, "group", format, limit, offset));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_batch_transition",
    "Batch-transition all issues in a group to a new state",
    BatchTransitionInput.shape,
    async ({ projectKey, groupKey, state }) => {
      try {
        const result = await client.batchTransition(projectKey, groupKey, state);
        return successResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
