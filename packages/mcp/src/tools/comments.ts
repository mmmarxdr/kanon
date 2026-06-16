// ─── Comment Tools ─────────────────────────────────────────────────────────────
//
// MCP tool for posting attributed comments on issues (KAN-120).
// Replaces the old engram sync_observation write path with a provenance-aware
// comment attributed to the calling agent client via X-Kanon-Client / via.
//
// Wraps POST /api/issues/:key/comments — source is always "mcp" so the
// comment is recorded as agent-authored in the provenance chain.
// Provenance (via) is derived server-side from the X-Kanon-Client header
// that KanonClient already sends via clientIdentity — do NOT pass via in body.
//
// Declared DEFERRED: posting a comment is an occasional agent communication
// action, not a daily board-flow operation (create/transition/update issues).
// Keeping it deferred avoids bloating every-turn tool context.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { errorResult, dataResult } from "../errors.js";

// ─── Deferred tool names ──────────────────────────────────────────────────────

/**
 * Comment tools declared DEFERRED behind ToolSearch.
 * Posting a comment is occasional agent communication — not core daily board flow.
 */
export const COMMENTS_DEFERRED_TOOLS = [
  "kanon_comment_issue",
] as const;

// ─── Input Schemas ──────────────────────────────────────────────────────────

const CommentIssueInput = z.object({
  issueKey: z
    .string()
    .describe("Issue key to comment on (e.g. 'KAN-42')"),
  body: z
    .string()
    .min(1)
    .max(10000)
    .describe("Comment text (1–10000 chars)"),
});

// ─── Registration ────────────────────────────────────────────────────────────

export function registerCommentTools(server: McpServer, client: KanonClient): void {
  // ── kanon_comment_issue ───────────────────────────────────────────────────

  server.tool(
    "kanon_comment_issue",
    "Post an attributed comment on issue issueKey. Use for status updates or agent notes during work. Provenance via X-Kanon-Client header — do not pass via in body.",
    CommentIssueInput.shape,
    async ({ issueKey, body }) => {
      try {
        const result = await client.createComment(issueKey, body, "mcp");
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
