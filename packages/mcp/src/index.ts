// ─── Kanon MCP Server Entry Point ───────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as nodeFs from "node:fs";
import { KanonClient } from "./kanon-client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerRoadmapTools } from "./tools/roadmap.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerContextTools } from "./tools/context.js";
import { registerWorkSessionTools } from "./tools/work-sessions.js";
import { registerCycleTools } from "./tools/cycles.js";
import { shutdownAllHeartbeats } from "./heartbeat.js";
import { startSseClient, stopSseClient } from "./sse-client.js";
import { SERVER_INSTRUCTIONS, DEFERRED_TOOLS } from "./instructions.js";
import { findKanonConfig } from "./kanon-binding.js";
import type { KanonBinding } from "./kanon-binding.js";
import type { InvalidBinding } from "./binding-resolver.js";

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

// ─── .kanon Binding (cwd-snapshot-at-spawn) ─────────────────────────────────
// Resolved ONCE from process.cwd() at process start. The cwd is snapshotted
// at spawn time by the agent (e.g. Claude Code) — it reflects the working
// directory when the wrapper was launched, not any later cd. For repos with
// nested .kanon files, the nearest ancestor (up to .git) wins.
const kanonBinding: KanonBinding | InvalidBinding | null = (() => {
  try {
    return findKanonConfig(process.cwd(), {
      existsSync: nodeFs.existsSync,
      readFileSync: (p: string) => nodeFs.readFileSync(p, "utf-8"),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[kanon] Warning: .kanon file found but invalid: ${reason}`);
    return { invalid: reason } satisfies InvalidBinding;
  }
})();

const server = new McpServer(
  {
    name: "kanon-mcp",
    version: "0.4.0",
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  },
);

// ─── Register Tools ─────────────────────────────────────────────────────────

registerProjectTools(server, client, kanonBinding);
registerGroupTools(server, client, kanonBinding);
registerIssueTools(server, client, kanonBinding);
registerCommentTools(server, client);
registerRoadmapTools(server, client, kanonBinding);
registerContextTools(server);
registerWorkSessionTools(server, client);
registerCycleTools(server, client, kanonBinding);

// ─── Connect ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Kanon MCP v0.4.0 — 30 tools registered, ${DEFERRED_TOOLS.length} declared deferred via instructions`);

  // Start background SSE client if workspace ID is configured
  const workspaceId = process.env["KANON_WORKSPACE_ID"];
  if (workspaceId && KANON_API_URL && KANON_API_KEY) {
    startSseClient(KANON_API_URL, workspaceId, KANON_API_KEY);
    console.error(`SSE client started for workspace ${workspaceId}`);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

// ─── Graceful Shutdown ─────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  console.error("Kanon MCP Server shutting down...");
  stopSseClient();
  await shutdownAllHeartbeats();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("beforeExit", () => void shutdownAllHeartbeats());
