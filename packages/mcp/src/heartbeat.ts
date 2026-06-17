// ─── Auto-Heartbeat Manager ─────────────────────────────────────────────────
// Sends periodic heartbeats for active work sessions without LLM intervention.
// On MCP server shutdown, stops all heartbeats and calls stopWork for each.
//
// work-session-resilience (Slice A):
//   - ±20% jitter on the base interval so concurrent MCP processes do not
//     synchronize against the API.
//   - Bounded retry: on transient 5xx, exactly one retry after 1s; on second
//     failure, log + clear (silent give-up).
//   - NO retry on HTTP 404 (session terminal) or HTTP 401 (auth boundary).

import type { KanonClient } from "./kanon-client.js";

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_JITTER = 0.2; // ±20%
const HEARTBEAT_RETRY_MS = 1000; // 1s backoff before bounded retry

/** Map of issue_key → pending timer (Timeout, not Interval — self-rescheduling) */
const activeHeartbeats = new Map<string, ReturnType<typeof setTimeout>>();

/** Track the client for shutdown cleanup */
let _client: KanonClient | undefined;

/** Compute the next jittered delay in ms, in [interval*(1-J), interval*(1+J)]. */
export function jitteredHeartbeatMs(): number {
  const factor = 1 - HEARTBEAT_JITTER + Math.random() * (HEARTBEAT_JITTER * 2);
  return Math.round(HEARTBEAT_INTERVAL_MS * factor);
}

/** Extract a status code from a thrown error. KanonClient throws KanonApiError
 *  with `.statusCode`; other shapes may use `.status`. Returns undefined if
 *  neither is present. */
function getStatusCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const e = err as { statusCode?: unknown; status?: unknown };
    if (typeof e.statusCode === "number") return e.statusCode;
    if (typeof e.status === "number") return e.status;
  }
  return undefined;
}

/**
 * Start a background heartbeat for an issue.
 * If a heartbeat is already running for this issue, it is replaced.
 */
export function startAutoHeartbeat(issueKey: string, client: KanonClient): void {
  _client = client;

  // Clear existing heartbeat for this key if any
  stopAutoHeartbeat(issueKey);

  const schedule = (): void => {
    const timer = setTimeout(() => {
      void runOnce(issueKey, client, /* isRetry */ false);
    }, jitteredHeartbeatMs());
    if (timer.unref) timer.unref();
    activeHeartbeats.set(issueKey, timer);
  };

  schedule();
  console.error(`[heartbeat] Started auto-heartbeat for ${issueKey} (every ~${HEARTBEAT_INTERVAL_MS / 1000}s ±${HEARTBEAT_JITTER * 100}%)`);
}

/**
 * One heartbeat fire. Handles transient retry (one attempt), 404/401
 * give-up, and the success path. Replaces the entry in activeHeartbeats
 * with the NEXT scheduled tick so the chain continues (or removes it on
 * give-up).
 */
async function runOnce(issueKey: string, client: KanonClient, isRetry: boolean): Promise<void> {
  let statusCode: number | undefined;
  let message = "";
  try {
    await client.heartbeat(issueKey);
    // Success: schedule the NEXT jittered tick.
    scheduleNext(issueKey, client);
    return;
  } catch (err) {
    statusCode = getStatusCode(err);
    message = err instanceof Error ? err.message : String(err);
  }

  // Terminal failures — no retry, log + clear.
  if (statusCode === 404 || statusCode === 401) {
    console.error(
      `[heartbeat] ${statusCode} for ${issueKey} — terminal, stopping heartbeat: ${message}`,
    );
    stopAutoHeartbeat(issueKey);
    return;
  }

  // First failure (transient, e.g. 5xx) → one retry after 1s, unless we
  // already retried.
  if (!isRetry) {
    const retryTimer = setTimeout(() => {
      void runOnce(issueKey, client, /* isRetry */ true);
    }, HEARTBEAT_RETRY_MS);
    if (retryTimer.unref) retryTimer.unref();
    // Track the retry in the map so stopAutoHeartbeat can clear it.
    activeHeartbeats.set(issueKey, retryTimer);
    return;
  }

  // Second failure (retry exhausted) — log + clear.
  console.error(
    `[heartbeat] Retry exhausted for ${issueKey} (${statusCode ?? "unknown"} ${message}) — stopping heartbeat`,
  );
  stopAutoHeartbeat(issueKey);
}

function scheduleNext(issueKey: string, client: KanonClient): void {
  const timer = setTimeout(() => {
    void runOnce(issueKey, client, /* isRetry */ false);
  }, jitteredHeartbeatMs());
  if (timer.unref) timer.unref();
  activeHeartbeats.set(issueKey, timer);
}

/**
 * Stop the background heartbeat for an issue.
 */
export function stopAutoHeartbeat(issueKey: string): void {
  const timer = activeHeartbeats.get(issueKey);
  if (timer) {
    clearTimeout(timer);
    activeHeartbeats.delete(issueKey);
    console.error(`[heartbeat] Stopped auto-heartbeat for ${issueKey}`);
  }
}

/**
 * Stop all active heartbeats. Exposed for test teardown; production code
 * uses shutdownAllHeartbeats (which also calls stopWork per active session).
 */
export function stopAllAutoHeartbeats(): void {
  for (const [key, timer] of activeHeartbeats) {
    clearTimeout(timer);
    console.error(`[heartbeat] Stopped auto-heartbeat for ${key}`);
  }
  activeHeartbeats.clear();
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

  // Clear all timers first
  for (const key of keys) {
    const timer = activeHeartbeats.get(key);
    if (timer) clearTimeout(timer);
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
