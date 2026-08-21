// ─── Group Tools ────────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { ListGroupsInput, BatchTransitionInput, BatchTransitionInputShape } from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList } from "../transforms.js";
import { resolveProjectKey } from "../binding-resolver.js";
import type { InvalidBinding } from "../binding-resolver.js";
import type { KanonBinding } from "../kanon-binding.js";
import {
  adoptCaptureByHeartbeat,
  forgetTrackedCapture,
  withIssueCaptureOperations,
} from "../heartbeat.js";

function exactTransitionedKeys(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result
      .map((issue) =>
        issue && typeof issue === "object" ? (issue as Record<string, unknown>)["key"] : undefined
      )
      .filter((key): key is string => typeof key === "string");
  }
  if (!result || typeof result !== "object") return [];
  const keys = (result as Record<string, unknown>)["keys"];
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

async function applyCapturePolicy(
  keys: readonly string[],
  state: string,
  client: KanonClient
): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      if (state === "analysis" || state === "in_progress") {
        try {
          await adoptCaptureByHeartbeat(key, client);
        } catch (error) {
          console.error(
            `[heartbeat] Batch transition committed but capture adoption failed for ${key}:`,
            error
          );
        }
      } else {
        forgetTrackedCapture(key);
      }
    })
  );
}

export function registerGroupTools(
  server: McpServer,
  client: KanonClient,
  binding: KanonBinding | InvalidBinding | null = null
): void {
  server.tool(
    "list_groups",
    "List issue groups for projectKey. Call before create_issue for valid groupKey values.",
    ListGroupsInput.shape,
    async ({ projectKey, format, limit, offset }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const groups = await client.listIssueGroups(resolved.projectKey);
        return dataResult(formatList(groups, "group", format ?? "compact", limit, offset));
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  server.tool(
    "transition_issues",
    "Batch-transition (projectKey,state,groupKey|keys[]). groupKey XOR keys. Returns ack {ok,count,keys}.",
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

        // KAN-188: batch transitions are not yet reconcile-aware — a
        // RECONCILIATION_REQUIRED 409 from either call below surfaces as-is
        // via the catch block's errorResult(err), same as any other error.
        // Full batch reconcile-awareness (e.g. per-issue blockedIssues
        // detail) is deferred and tracked separately.
        let result: unknown;
        if (keys && keys.length > 0) {
          const orderedKeys = [...new Set(keys)].sort();
          result = await withIssueCaptureOperations(orderedKeys, async () => {
            const response = await client.batchTransitionByKeys(projectKey, keys, state);
            await applyCapturePolicy(exactTransitionedKeys(response), state, client);
            return response;
          });
        } else {
          result = await client.batchTransition(projectKey, groupKey!, state);
          const transitionedKeys = exactTransitionedKeys(result);
          await withIssueCaptureOperations(transitionedKeys, () =>
            applyCapturePolicy(transitionedKeys, state, client)
          );
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
    }
  );
}
