// ─── Group Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { ListGroupsInput, BatchTransitionInput } from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList } from "../transforms.js";

export function registerGroupTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_groups",
    "List issue groups for projectKey. Call before kanon_create_issue to get valid groupKey values.",
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
    "Batch-transition (projectKey,state,groupKey|keys[]). groupKey or keys — mutually exclusive. Returns ack {ok,count,keys}; format:'full' for raw.",
    BatchTransitionInput.shape,
    async (rawInput) => {
      try {
        // XOR validation: .shape bypasses .refine(), so parse manually
        const parsed = BatchTransitionInput.safeParse(rawInput);
        if (!parsed.success) {
          return errorResult(new Error(parsed.error.errors[0]?.message ?? "Invalid input"));
        }
        const { projectKey, groupKey, keys, state, format } = parsed.data;

        let result: unknown;
        if (keys && keys.length > 0) {
          result = await client.batchTransitionByKeys(projectKey, keys, state);
        } else {
          result = await client.batchTransition(projectKey, groupKey!, state);
        }

        if (format === "full") return dataResult(result);
        const raw = result as Record<string, unknown>;
        const count = Array.isArray(result) ? result.length : (raw["count"] ?? 0);
        const resultKeys = Array.isArray(result)
          ? (result as Array<Record<string, unknown>>).map((i) => i["key"]).filter(Boolean)
          : (raw["keys"] ?? []);
        return dataResult({ ok: true, count, keys: resultKeys });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
