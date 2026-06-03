// ─── Group Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { ListGroupsInput, BatchTransitionInput, BatchTransitionInputShape } from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList } from "../transforms.js";
import { resolveProjectKey } from "../binding-resolver.js";
import type { KanonBinding } from "../kanon-binding.js";

export function registerGroupTools(server: McpServer, client: KanonClient, binding: KanonBinding | null = null): void {
  server.tool(
    "kanon_list_groups",
    "List issue groups for projectKey. Call before kanon_create_issue to get valid groupKey values.",
    ListGroupsInput.shape,
    async ({ projectKey, format, limit, offset }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const groups = await client.listIssueGroups(resolved.projectKey);
        return dataResult(formatList(groups, "group", (format ?? "compact"), limit, offset));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_batch_transition",
    "Batch-transition (projectKey,state,groupKey|keys[]). groupKey or keys — mutually exclusive. Returns ack {ok,count,keys}; format:'full' for raw.",
    BatchTransitionInputShape.shape,
    async (rawInput: unknown) => {
      try {
        // XOR validation: .shape bypasses .refine(), so parse manually
        const parsed = BatchTransitionInput.safeParse(rawInput);
        if (!parsed.success) {
          return errorResult(new Error(parsed.error.errors[0]?.message ?? "Invalid input"));
        }
        const { projectKey: explicitProjectKey, groupKey, keys, state, format } = parsed.data;
        const resolvedKey = resolveProjectKey(explicitProjectKey, binding);
        if (!resolvedKey.ok) return errorResult(new Error(resolvedKey.error));
        const projectKey = resolvedKey.projectKey;

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
