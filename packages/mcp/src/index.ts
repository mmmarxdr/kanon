// ─── Kanon MCP Server Entry Point ───────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KanonClient } from "./kanon-client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerRoadmapTools } from "./tools/roadmap.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerContextTools } from "./tools/context.js";

// ─── Env Validation (fail-fast) ────────────────────────────────────────────

const KANON_API_URL = process.env["KANON_API_URL"];
const KANON_API_KEY = process.env["KANON_API_KEY"];

if (!KANON_API_URL) {
  console.error("KANON_API_URL is required. Set it as an environment variable.");
  process.exit(1);
}

if (!KANON_API_KEY) {
  console.error("KANON_API_KEY is required. Set it as an environment variable.");
  process.exit(1);
}

// ─── Initialize ─────────────────────────────────────────────────────────────

const client = new KanonClient({
  baseUrl: KANON_API_URL,
  apiKey: KANON_API_KEY,
});

const server = new McpServer({
  name: "kanon-mcp",
  version: "0.0.1",
});

// ─── Register Tools ─────────────────────────────────────────────────────────

registerProjectTools(server, client);
registerGroupTools(server, client);
registerIssueTools(server, client);
registerCommentTools(server, client);
registerRoadmapTools(server, client);
registerContextTools(server);

// ─── Connect ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Kanon MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
