// ─── Work Session Tools ─────────────────────────────────────────────────────

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { errorResult, dataResult } from "../errors.js";
import { startAutoHeartbeat, stopAutoHeartbeat } from "../heartbeat.js";

// ─── Input Schemas ─────────────────────────────────────────────────────────

const StartWorkInput = z.object({
  issue_key: z.string().describe("Issue key (e.g. 'KAN-42')"),
});

const StopWorkInput = z.object({
  issue_key: z.string().describe("Issue key (e.g. 'KAN-42')"),
});

const WhoIsWorkingInput = z.object({
  issue_key: z.string().describe("Issue key (e.g. 'KAN-42')"),
});

// ─── Registration ──────────────────────────────────────────────────────────

export function registerWorkSessionTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_start_work",
    "Signal that you're actively working on an issue. Auto-assigns if unassigned. Returns warnings if others are working on it. Starts automatic heartbeat to keep session alive.",
    StartWorkInput.shape,
    async ({ issue_key }) => {
      try {
        const result = await client.startWork(issue_key, "mcp");

        // Start auto-heartbeat for this issue
        startAutoHeartbeat(issue_key, client);

        const lines: string[] = [];
        lines.push(`Started work on ${issue_key}`);
        if (result.autoAssigned) {
          lines.push("Auto-assigned issue to you (was unassigned).");
        }
        if (result.warnings.length > 0) {
          lines.push("");
          lines.push("Warnings:");
          for (const w of result.warnings) {
            lines.push(`  - ${w}`);
          }
        }

        return dataResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_stop_work",
    "Signal that you've stopped working on an issue. Clears your active session and stops the automatic heartbeat.",
    StopWorkInput.shape,
    async ({ issue_key }) => {
      try {
        // Stop auto-heartbeat first
        stopAutoHeartbeat(issue_key);

        const result = await client.stopWork(issue_key);
        const message = result.deleted
          ? `Stopped work on ${issue_key}.`
          : `No active session found for ${issue_key} (already stopped).`;
        return dataResult(message);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_who_is_working",
    "Check who is currently working on an issue. Shows active workers with their username, source (mcp/web/etc), and how long they've been working.",
    WhoIsWorkingInput.shape,
    async ({ issue_key }) => {
      try {
        const workers = await client.listActiveSessions(issue_key);

        if (workers.length === 0) {
          return dataResult(`No one is currently working on ${issue_key}.`);
        }

        const lines: string[] = [`Active workers on ${issue_key}:`];
        for (const w of workers) {
          const elapsed = formatElapsed(w.startedAt);
          lines.push(`  - ${w.username} (since ${elapsed}, via ${w.source})`);
        }
        return dataResult(lines.join("\n"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatElapsed(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}
