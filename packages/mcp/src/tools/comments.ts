// ─── Comment Tools ───────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { SyncObservationInput } from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatEntity, formatAck, type Format } from "../transforms.js";

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
    "Post Engram observation as issue comment. Only when directly relevant — not every mem_save. Returns ack {ok,id,issueKey}; format:'full' for entity.",
    SyncObservationInput.shape,
    async ({
      issueKey,
      title,
      content,
      observationType,
      observationId,
      topicKey,
      source,
      format,
    }) => {
      try {
        const body = formatCommentBody({
          title,
          content,
          observationType,
          observationId,
          topicKey,
        });
        const comment = await client.createComment(issueKey, body, source ?? "engram_sync");
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(comment, "comment"));
        return dataResult(formatEntity(comment, "comment-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
