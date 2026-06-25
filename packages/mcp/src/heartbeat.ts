// ─── Activity-Driven Heartbeat Manager ───────────────────────────────────────
// KAN-156 Slice 2 (reviewed): heartbeat is ACTIVITY-DRIVEN, not a blind timer.
//
// Model:
//   - startAutoHeartbeat(issueKey, client): fires ONE immediate beat (the start
//     itself is activity), records {client, lastBeatAt, generation} in the active
//     map. No recurring timer is scheduled.
//   - noteActivity(): called by the index.ts tool wrapper on every MCP tool
//     invocation (fire-and-forget; never rejects). For each active issue, if
//     Date.now() - lastBeatAt >= HEARTBEAT_DEBOUNCE_MS, sets lastBeatAt = now
//     BEFORE the await (prevents concurrent double-fires) and fires one beat.
//   - If no activity → no beats → the session TTL-expires (server's 5-min
//     cleanupExpired). This fixes the idle over-count bug.
//
// Generation guard (stale-closure race fix):
//   startAutoHeartbeat increments a per-key generation counter. fireOnce
//   captures the generation at call-time. Before any terminal action
//   (stopAutoHeartbeat on 404/401 or retry-exhausted) and before scheduling a
//   retry, it checks activeIssues.get(issueKey)?.generation === capturedGen.
//   If stale, the beat no-ops: does not stop the new registration, does not
//   retry, does not beat again.
//
// Resilience (Slice A, preserved):
//   - Transient 5xx: exactly one retry after 1s; on second failure log + stop.
//   - 404/401: terminal — log + stop immediately, no retry.
//   - Pending retry timers are tracked in `pendingRetries` so stop/shutdown
//     can cancel them.
//
// wrapHandlerWithActivity (exported):
//   Used by index.ts to wrap every registered tool handler. Calls noteActivity
//   fire-and-forget (void + swallowed error) so heartbeat hiccups never block
//   or fail an unrelated tool call.

import type { KanonClient } from "./kanon-client.js";

const HEARTBEAT_DEBOUNCE_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_RETRY_MS = 1000; // 1s backoff for transient retry

interface ActiveEntry {
  client: KanonClient;
  lastBeatAt: number;
  generation: number;
}

/** Map of issueKey → active entry (client + lastBeatAt + generation). */
const activeIssues = new Map<string, ActiveEntry>();

/** Map of issueKey → pending retry timer (so stop/shutdown can cancel it). */
const pendingRetries = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Monotonic generation sequence. Each startAutoHeartbeat takes the next value,
 * so every registration is globally unique. A single number (not a per-key map)
 * means no unbounded state to prune AND generations are never reused — a stale
 * in-flight beat's captured generation can never match a later registration.
 */
let generationSeq = 0;

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
 * Fire a single heartbeat for the given issue.
 *
 * capturedGen is the generation token captured at the time fireOnce was
 * scheduled. If the issue has been stopped+restarted since then, the
 * generation will have advanced and this call must no-op on any terminal or
 * retry action (stale-closure guard).
 *
 * Resilience:
 *   - Success: returns.
 *   - 404/401: terminal — log + stopAutoHeartbeat (only if generation matches).
 *   - Transient 5xx: one retry after 1s (only if generation matches at retry time).
 *   - Retry-exhausted: log + stopAutoHeartbeat (only if generation matches).
 */
async function fireOnce(
  issueKey: string,
  client: KanonClient,
  isRetry: boolean,
  capturedGen: number,
): Promise<void> {
  // Stale-generation check: if the issue has been replaced since we were
  // scheduled, bail out entirely without touching the new registration.
  const current = activeIssues.get(issueKey);
  if (!current || current.generation !== capturedGen) return;

  let statusCode: number | undefined;
  let message = "";
  try {
    await client.heartbeat(issueKey);
    return; // success
  } catch (err) {
    statusCode = getStatusCode(err);
    message = err instanceof Error ? err.message : String(err);
  }

  // Re-check generation after the await — the issue might have been replaced
  // while the network call was in flight.
  const afterAwait = activeIssues.get(issueKey);
  if (!afterAwait || afterAwait.generation !== capturedGen) return;

  // Terminal failures — no retry.
  if (statusCode === 404 || statusCode === 401) {
    console.error(
      `[heartbeat] ${statusCode} for ${issueKey} — terminal, stopping: ${message}`,
    );
    stopAutoHeartbeat(issueKey);
    return;
  }

  // Transient (5xx or unknown): retry once after 1s unless already retrying.
  if (!isRetry) {
    const retryTimer = setTimeout(() => {
      pendingRetries.delete(issueKey);
      void fireOnce(issueKey, client, /* isRetry */ true, capturedGen);
    }, HEARTBEAT_RETRY_MS);
    if (retryTimer.unref) retryTimer.unref();
    pendingRetries.set(issueKey, retryTimer);
    return;
  }

  // Retry already exhausted — log + stop.
  console.error(
    `[heartbeat] Retry exhausted for ${issueKey} (${statusCode ?? "unknown"} ${message}) — stopping`,
  );
  stopAutoHeartbeat(issueKey);
}

/**
 * Start activity-driven heartbeat tracking for an issue.
 * Fires ONE immediate beat (the start itself is activity), records the issue
 * in the active map with lastBeatAt = now and a new generation token.
 * No recurring timer is scheduled. If a registration already exists it is replaced.
 */
export function startAutoHeartbeat(issueKey: string, client: KanonClient): void {
  // Cancel any pending retry timer for this key (from the old registration).
  const existingRetry = pendingRetries.get(issueKey);
  if (existingRetry) {
    clearTimeout(existingRetry);
    pendingRetries.delete(issueKey);
  }

  // Take the next globally-unique generation (monotonic, never reused).
  const generation = ++generationSeq;

  const now = Date.now();
  activeIssues.set(issueKey, { client, lastBeatAt: now, generation });

  // Fire the immediate first beat asynchronously with the new generation.
  void fireOnce(issueKey, client, /* isRetry */ false, generation);

  console.error(
    `[heartbeat] Started activity-driven heartbeat for ${issueKey} (debounce ${HEARTBEAT_DEBOUNCE_MS / 1000}s, gen ${generation})`,
  );
}

/**
 * Called on every MCP tool invocation via the server.tool wrapper in index.ts.
 * For each active issue, if the debounce window has elapsed since the last beat,
 * updates lastBeatAt FIRST (to prevent concurrent double-fires) then fires one
 * heartbeat asynchronously.
 *
 * This function NEVER rejects. Errors from individual beats are handled
 * internally by fireOnce (resilience policy). This is a defensive guarantee
 * so callers (the tool wrapper) can safely fire-and-forget without a catch.
 */
export async function noteActivity(): Promise<void> {
  try {
    const now = Date.now();
    const beats: Promise<void>[] = [];

    for (const [issueKey, entry] of activeIssues) {
      if (now - entry.lastBeatAt >= HEARTBEAT_DEBOUNCE_MS) {
        // Update timestamp BEFORE the async call so concurrent invocations skip.
        entry.lastBeatAt = now;
        beats.push(fireOnce(issueKey, entry.client, /* isRetry */ false, entry.generation));
      }
    }

    // allSettled (not all): one issue's beat failing must not cancel the others.
    await Promise.allSettled(beats);
  } catch (err) {
    // Defensive: noteActivity must never propagate a rejection to callers.
    console.error("[heartbeat] noteActivity internal error (suppressed):", err);
  }
}

/**
 * Wrap a tool handler so that noteActivity is called fire-and-forget before
 * delegating to the real handler. The heartbeat call is:
 *   - Non-blocking: handler runs immediately, result is not delayed by heartbeat I/O.
 *   - Error-isolated: a heartbeat failure never causes the tool call to fail.
 *
 * The optional `notify` parameter defaults to `noteActivity` and exists so tests
 * can inject a spy without module-level interception gymnastics. Production callers
 * always omit it.
 *
 * Exported so index.ts uses the real implementation and tests cover it directly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapHandlerWithActivity<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  notify: () => Promise<void> = noteActivity,
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (...args: any[]) => {
    // Fire-and-forget: do NOT await — this must not block the tool response.
    void notify().catch((e) => console.error("[heartbeat] noteActivity error:", e));
    return handler(...args);
  }) as T;
}

/**
 * Stop tracking an issue. Cancels any pending retry timer.
 */
export function stopAutoHeartbeat(issueKey: string): void {
  if (activeIssues.has(issueKey)) {
    activeIssues.delete(issueKey);
    console.error(`[heartbeat] Stopped heartbeat tracking for ${issueKey}`);
  }
  const retryTimer = pendingRetries.get(issueKey);
  if (retryTimer) {
    clearTimeout(retryTimer);
    pendingRetries.delete(issueKey);
  }
}

/**
 * Stop all active heartbeat tracking. Exposed for test teardown; production
 * code uses shutdownAllHeartbeats (which also calls stopWork per active session).
 */
export function stopAllAutoHeartbeats(): void {
  for (const key of activeIssues.keys()) {
    console.error(`[heartbeat] Stopped heartbeat tracking for ${key}`);
  }
  activeIssues.clear();

  for (const timer of pendingRetries.values()) {
    clearTimeout(timer);
  }
  pendingRetries.clear();
}

/**
 * Get all issue keys currently being tracked.
 */
export function getActiveIssueKeys(): string[] {
  return Array.from(activeIssues.keys());
}

/**
 * Shutdown: stop all tracking and call stopWork for each active session.
 * Called during process exit / MCP server shutdown.
 */
export async function shutdownAllHeartbeats(): Promise<void> {
  const entries = Array.from(activeIssues.entries());
  if (entries.length === 0) return;

  console.error(`[heartbeat] Shutting down ${entries.length} active heartbeat(s)...`);

  // Clear all tracking first (also cancels retry timers).
  stopAllAutoHeartbeats();

  // Best-effort stop work for each active session.
  const results = await Promise.allSettled(
    entries.map(([key, { client }]) => client.stopWork(key)),
  );
  for (let i = 0; i < entries.length; i++) {
    const [key] = entries[i]!;
    const result = results[i]!;
    if (result.status === "fulfilled") {
      console.error(`[heartbeat] Stopped work session for ${key}`);
    } else {
      console.error(`[heartbeat] Failed to stop work session for ${key}:`, result.reason);
    }
  }
}
