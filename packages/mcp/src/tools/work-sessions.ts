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
    "start_work",
    "Start work session on issue_key. Auto-assigns if unassigned; starts heartbeat. Returns ack {ok,sessionId,action:'started'}.",
    StartWorkInput.shape,
    async ({ issue_key }) => {
      try {
        const result = await client.startWork(issue_key, "mcp");

        // Start auto-heartbeat for this issue
        startAutoHeartbeat(issue_key, client);

        const session = (result.session ?? {}) as Record<string, unknown>;
        return dataResult({
          ok: true,
          sessionId: session["id"] ?? null,
          action: "started" as const,
        });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "stop_work",
    "Stop work session on issue_key; clears session and heartbeat. Returns {ok,deleted,issueKey}.",
    StopWorkInput.shape,
    async ({ issue_key }) => {
      try {
        // Stop auto-heartbeat first
        stopAutoHeartbeat(issue_key);

        const result = await client.stopWork(issue_key);
        // S2 / KAN-26: include logged + durationSeconds when WorkLog captured
        const ack: Record<string, unknown> = {
          ok: true,
          deleted: result.deleted,
          issueKey: issue_key,
          logged: result.workLog !== null,
        };
        if (result.workLog !== null) {
          ack["durationSeconds"] = result.workLog.durationS;
        }
        return dataResult(ack);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_active_workers",
    "List active workers on issue_key: username, source (mcp/web/etc), elapsed time.",
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
