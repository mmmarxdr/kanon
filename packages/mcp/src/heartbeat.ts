// ─── Auto-Heartbeat Manager ─────────────────────────────────────────────────
// Sends periodic heartbeats for active work sessions without LLM intervention.
// On MCP server shutdown, stops all heartbeats and calls stopWork for each.

import type { KanonClient } from "./kanon-client.js";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Map of issue_key → interval timer */
const activeHeartbeats = new Map<string, ReturnType<typeof setInterval>>();

/** Track the client for shutdown cleanup */
let _client: KanonClient | undefined;

/**
 * Start a background heartbeat for an issue.
 * If a heartbeat is already running for this issue, it is replaced.
 */
export function startAutoHeartbeat(issueKey: string, client: KanonClient): void {
  _client = client;

  // Clear existing heartbeat for this key if any
  stopAutoHeartbeat(issueKey);

  const timer = setInterval(async () => {
    try {
      await client.heartbeat(issueKey);
    } catch (err) {
      // If heartbeat fails (session expired, network issue), stop retrying
      console.error(`[heartbeat] Failed for ${issueKey}:`, err instanceof Error ? err.message : String(err));
      stopAutoHeartbeat(issueKey);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Allow the process to exit even if this timer is running
  if (timer.unref) {
    timer.unref();
  }

  activeHeartbeats.set(issueKey, timer);
  console.error(`[heartbeat] Started auto-heartbeat for ${issueKey} (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop the background heartbeat for an issue.
 */
export function stopAutoHeartbeat(issueKey: string): void {
  const timer = activeHeartbeats.get(issueKey);
  if (timer) {
    clearInterval(timer);
    activeHeartbeats.delete(issueKey);
    console.error(`[heartbeat] Stopped auto-heartbeat for ${issueKey}`);
  }
}

/**
 * Get all issue keys with active heartbeats.
 */
export function getActiveIssueKeys(): string[] {
  return Array.from(activeHeartbeats.keys());
}

/**
 * Shutdown: stop all heartbeats and call stopWork for each active session.
 * Called during process exit / MCP server shutdown.
 */
export async function shutdownAllHeartbeats(): Promise<void> {
  const keys = getActiveIssueKeys();
  if (keys.length === 0) return;

  console.error(`[heartbeat] Shutting down ${keys.length} active heartbeat(s)...`);

  // Clear all intervals first
  for (const key of keys) {
    const timer = activeHeartbeats.get(key);
    if (timer) clearInterval(timer);
  }
  activeHeartbeats.clear();

  // Best-effort stop work for each active session
  if (_client) {
    const results = await Promise.allSettled(
      keys.map((key) => _client!.stopWork(key)),
    );
    for (let i = 0; i < keys.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled") {
        console.error(`[heartbeat] Stopped work session for ${keys[i]}`);
      } else {
        console.error(`[heartbeat] Failed to stop work session for ${keys[i]}:`, result.reason);
      }
    }
  }
}
