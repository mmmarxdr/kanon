// ─── Comment Tools ───────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { SyncObservationInput } from "../types.js";
import { errorResult, successResult } from "../errors.js";

const MAX_BODY_CHARS = 9900;
const FOOTER_RESERVE = 200; // chars reserved for header + footer template

export function formatCommentBody(params: {
  title: string;
  content: string;
  observationType?: string;
  observationId?: number;
  topicKey?: string;
}): string {
  const { title, content, observationType, observationId, topicKey } = params;

  const maxContent = MAX_BODY_CHARS - FOOTER_RESERVE;
  const truncated =
    content.length > maxContent
      ? content.slice(0, maxContent) + "\n\n*[content truncated]*"
      : content;

  const footerParts: string[] = ["Synced from Engram"];
  if (observationType) footerParts.push(observationType);
  if (observationId !== undefined) footerParts.push(`#${observationId}`);
  if (topicKey) footerParts.push(`\`${topicKey}\``);

  return [
    `## 🧠 ${title}`,
    "",
    truncated,
    "",
    "---",
    `*${footerParts.join(" • ")}*`,
  ].join("\n");
}

export function registerCommentTools(
  server: McpServer,
  client: KanonClient,
): void {
  server.tool(
    "kanon_sync_observation",
    [
      "Post an Engram observation as a comment on a Kanon issue.",
      "Call this AFTER saving a significant discovery, decision, or bug fix to Engram via mem_save,",
      "when that observation is directly relevant to a specific Kanon issue.",
      "Do NOT call this after every mem_save — only for observations that add meaningful context",
      "to an issue's thread (e.g. architecture decisions, root-cause findings, non-obvious discoveries).",
      "Requires issueKey and the observation's title + content.",
      "observationId should be passed when available to aid traceability.",
    ].join(" "),
    SyncObservationInput.shape,
    async ({
      issueKey,
      title,
      content,
      observationType,
      observationId,
      topicKey,
    }) => {
      try {
        const body = formatCommentBody({
          title,
          content,
          observationType,
          observationId,
          topicKey,
        });
        const comment = await client.createComment(issueKey, body, "engram_sync");
        return successResult(comment);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
