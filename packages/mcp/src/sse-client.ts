// ─── Background SSE Client ──────────────────────────────────────────────────
// Connects to the Kanon API's workspace SSE endpoint and maintains a local
// cache of recent events. The kanon_get_issue tool can check this cache to
// include warnings about recent changes to issues the AI is working on.
//
// Uses the simpler approach: local event cache + polling via tool calls,
// rather than MCP resource subscriptions.

const MAX_CACHED_EVENTS = 200;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export interface DomainEvent {
  id: number;
  type: string;
  workspaceId?: string;
  actorId?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** Recent events cache, newest last */
const eventCache: DomainEvent[] = [];

/** Last event ID for reconnection */
let lastEventId: string | undefined;

/** Current connection state */
let abortController: AbortController | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;
let running = false;

/**
 * Start the background SSE connection.
 * Connects to GET /api/events/workspace/:wid
 */
export function startSseClient(
  baseUrl: string,
  workspaceId: string,
  apiKey: string,
): void {
  if (running) return;
  running = true;
  connect(baseUrl, workspaceId, apiKey);
}

/**
 * Stop the background SSE connection.
 */
export function stopSseClient(): void {
  running = false;
  if (abortController) {
    abortController.abort();
    abortController = undefined;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

/**
 * Get recent events for a specific issue key (within the last N minutes).
 */
export function getRecentEventsForIssue(
  issueKey: string,
  maxAgeMs: number = 5 * 60_000,
): DomainEvent[] {
  const cutoff = Date.now() - maxAgeMs;
  return eventCache.filter(
    (e) =>
      (e.payload["issueKey"] === issueKey || e.payload["issue_key"] === issueKey) &&
      new Date(e.timestamp).getTime() > cutoff,
  );
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function connect(
  baseUrl: string,
  workspaceId: string,
  apiKey: string,
): Promise<void> {
  if (!running) return;

  const url = `${baseUrl.replace(/\/+$/, "")}/api/events/workspace/${workspaceId}`;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };

  if (apiKey.startsWith("eyJ")) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    headers["X-API-Key"] = apiKey;
  }

  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }

  abortController = new AbortController();

  try {
    const response = await fetch(url, {
      headers,
      signal: abortController.signal,
    });

    if (!response.ok) {
      console.error(`[sse] Connection failed: HTTP ${response.status}`);
      scheduleReconnect(baseUrl, workspaceId, apiKey);
      return;
    }

    if (!response.body) {
      console.error("[sse] No response body");
      scheduleReconnect(baseUrl, workspaceId, apiKey);
      return;
    }

    console.error("[sse] Connected to workspace event stream");
    reconnectAttempts = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // SSE parsing state
    let currentId = "";
    let currentEvent = "";
    let currentData = "";

    while (running) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep incomplete last line

      for (const line of lines) {
        if (line.startsWith("id:")) {
          currentId = line.slice(3).trim();
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData += line.slice(5).trim();
        } else if (line === "") {
          // Empty line = end of event
          if (currentData) {
            try {
              const parsed = JSON.parse(currentData) as Record<string, unknown>;
              const event: DomainEvent = {
                id: currentId ? parseInt(currentId, 10) : 0,
                type: currentEvent || (parsed["type"] as string) || "unknown",
                workspaceId: parsed["workspaceId"] as string | undefined,
                actorId: parsed["actorId"] as string | undefined,
                payload: (parsed["payload"] as Record<string, unknown>) ?? parsed,
                timestamp: (parsed["timestamp"] as string) ?? new Date().toISOString(),
              };
              pushEvent(event);
              if (currentId) lastEventId = currentId;
            } catch {
              // Skip malformed events
            }
          }
          currentId = "";
          currentEvent = "";
          currentData = "";
        }
        // Ignore comment lines starting with ":"
      }
    }
  } catch (err) {
    if (abortController?.signal.aborted) return; // Intentional abort
    console.error("[sse] Connection error:", err instanceof Error ? err.message : String(err));
  }

  if (running) {
    scheduleReconnect(baseUrl, workspaceId, apiKey);
  }
}

function scheduleReconnect(baseUrl: string, workspaceId: string, apiKey: string): void {
  if (!running) return;
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
    RECONNECT_MAX_MS,
  );
  reconnectAttempts++;
  console.error(`[sse] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    void connect(baseUrl, workspaceId, apiKey);
  }, delay);
  if (reconnectTimer.unref) {
    reconnectTimer.unref();
  }
}

function pushEvent(event: DomainEvent): void {
  eventCache.push(event);
  // Trim old events
  while (eventCache.length > MAX_CACHED_EVENTS) {
    eventCache.shift();
  }
}
