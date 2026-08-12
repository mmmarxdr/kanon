import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "./kanon-client.js";
import type { KanonBinding } from "./kanon-binding.js";
import type { InvalidBinding } from "./binding-resolver.js";
import { registerCaptureTools } from "./tools/capture.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerCycleTools } from "./tools/cycles.js";
import { registerDocumentTools } from "./tools/documents.js";
import { registerGroupTools } from "./tools/groups.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerMemberTools } from "./tools/members.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerRoadmapTools } from "./tools/roadmap.js";
import { registerTimesheetTools } from "./tools/timesheet.js";
import { registerTriageTools } from "./tools/triage.js";
import { registerWorkSessionTools } from "./tools/work-sessions.js";

export function registerKanonTools(
  server: McpServer,
  client: KanonClient,
  binding: KanonBinding | InvalidBinding | null,
  triageEnabled: boolean,
): void {
  registerProjectTools(server, client, binding);
  registerGroupTools(server, client, binding);
  registerIssueTools(server, client, binding);
  registerRoadmapTools(server, client, binding);
  registerWorkSessionTools(server, client);
  registerCycleTools(server, client, binding);
  registerDocumentTools(server, client);
  registerTimesheetTools(server, client);
  registerMemberTools(server, client);
  registerCommentTools(server, client);
  registerCaptureTools(server, client);
  if (triageEnabled) registerTriageTools(server, client);
}
