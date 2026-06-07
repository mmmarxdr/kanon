// ─── Document Tools ───────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { CreateDocumentInput, ListDocumentsInput, GetDocumentInput } from "../types.js";
import { errorResult, dataResult } from "../errors.js";

export function registerDocumentTools(
  server: McpServer,
  client: KanonClient,
): void {
  server.tool(
    "kanon_create_document",
    "Create design record for issue. Propose to user before writing.",
    CreateDocumentInput.shape,
    async ({ issueKey, kind, title, body }) => {
      try {
        const document = await client.createDocument(issueKey, { kind, title, body });
        return dataResult({ ok: true, id: document.id, issueKey, kind: document.kind });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_list_documents",
    "List all design records (adr/pdr/rfc/note) for an issue.",
    ListDocumentsInput.shape,
    async ({ issueKey }) => {
      try {
        const documents = await client.listDocuments(issueKey);
        return dataResult(documents);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_get_document",
    "Get a design record (adr/pdr/rfc/note) by document ID.",
    GetDocumentInput.shape,
    async ({ documentId }) => {
      try {
        const document = await client.getDocument(documentId);
        return dataResult(document);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
