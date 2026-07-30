// ─── Member Tools ─────────────────────────────────────────────────────────────
//
// MCP tool for listing project members (id ↔ name resolution).
// Wraps GET /api/projects/:key/members — returns each member's userId,
// displayName, email, and role so agents can resolve assigneeId values.
//
// Declared DEFERRED: member listing is a resolution helper (used when reading
// activity logs or picking assignees), not a daily board-flow action. Keeping
// it out of eager context avoids bloating every-turn tool lists.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { errorResult, dataResult } from "../errors.js";

// ─── Deferred tool names ──────────────────────────────────────────────────────

/**
 * Member tools declared DEFERRED behind ToolSearch.
 * Resolution helpers — needed for assignee-lookup and activity-log id→name,
 * not part of the core daily board flow (create/update/transition issues).
 */
export const MEMBERS_DEFERRED_TOOLS = [
  "list_members",
] as const;

// ─── Input Schemas ─────────────────────────────────────────────────────────

const ListMembersInput = z.object({
  projectKey: z
    .string()
    .describe("Project key (e.g. 'KAN') whose members to list"),
});

// ─── Registration ──────────────────────────────────────────────────────────

export function registerMemberTools(server: McpServer, client: KanonClient): void {
  // ── list_members ────────────────────────────────────────────────────

  server.tool(
    "list_members",
    "List members of project projectKey. Returns userId, displayName, email, role per member. Use to resolve assigneeId↔name or pick an assignee.",
    ListMembersInput.shape,
    async ({ projectKey }) => {
      try {
        const result = await client.listProjectMembers(projectKey);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
