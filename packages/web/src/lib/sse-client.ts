/**
 * SSE client using fetch() + ReadableStream.
 *
 * Uses cookie-based authentication (credentials: 'include').
 *
 * Features:
 * - Cookie-based auth (no Authorization header needed)
 * - Auto-reconnect with exponential backoff (1s -> 2s -> 4s -> 8s max)
 * - Event and status change callbacks
 * - Emits 'reconnected' pseudo-event on successful reconnect
 */

export type SyncStatus = "connected" | "connecting" | "disconnected" | "error";

export interface SyncEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

type EventCallback = (event: SyncEvent) => void;
type StatusCallback = (status: SyncStatus) => void;

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 8000;

export class SseClient {
  private url: string;
  private status: SyncStatus = "disconnected";
  private eventListeners: Set<EventCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private closed = false;
  private wasConnected = false;

  constructor(url: string) {
    this.url = url;
  }

  /** Start the SSE connection. */
  connect(): void {
    this.closed = false;
    this.doConnect();
  }

  /** Permanently close the connection and stop reconnection. */
  close(): void {
    this.closed = true;
    this.clearReconnectTimer();
    this.abortController?.abort();
    this.abortController = null;
    this.setStatus("disconnected");
  }

  /** Subscribe to SSE events. Returns an unsubscribe function. */
  onEvent(cb: EventCallback): () => void {
    this.eventListeners.add(cb);
    return () => {
      this.eventListeners.delete(cb);
    };
  }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChange(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    // Immediately notify with current status
    cb(this.status);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private setStatus(newStatus: SyncStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const cb of this.statusListeners) {
      try {
        cb(newStatus);
      } catch {
        // listener errors must not break the client
      }
    }
  }

  private emitEvent(event: SyncEvent): void {
    for (const cb of this.eventListeners) {
      try {
        cb(event);
      } catch {
        // listener errors must not break the client
      }
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.clearReconnectTimer();
    this.setStatus("connecting");

    this.reconnectTimer = setTimeout(() => {
      this.doConnect();
    }, this.backoffMs);

    // Exponential backoff: 1s -> 2s -> 4s -> 8s (cap)
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private async doConnect(): Promise<void> {
    if (this.closed) return;

    this.setStatus("connecting");
    this.abortController?.abort();
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.url, {
        headers: { Accept: "text/event-stream" },
        credentials: "include",
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        // 503 = sync feature disabled server-side — no point retrying
        if (response.status === 503) {
          this.setStatus("disconnected");
          return;
        }
        this.setStatus("error");
        this.scheduleReconnect();
        return;
      }

      if (!response.body) {
        this.setStatus("error");
        this.scheduleReconnect();
        return;
      }

      // Connection succeeded — reset backoff
      this.backoffMs = INITIAL_BACKOFF_MS;

      // If we were previously connected, this is a reconnect
      const isReconnect = this.wasConnected;
      this.wasConnected = true;
      this.setStatus("connected");

      if (isReconnect) {
        this.emitEvent({
          type: "reconnected",
          timestamp: new Date().toISOString(),
        });
      }

      // Read the stream
      await this.readStream(response.body);
    } catch (err: unknown) {
      // AbortError is expected when we call close()
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (!this.closed) {
        this.setStatus("error");
        this.scheduleReconnect();
      }
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          this.processLine(line);
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      // Stream broken — will reconnect below
    } finally {
      reader.releaseLock();
    }

    // Stream ended (server closed connection) — reconnect unless we closed
    if (!this.closed) {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  private processLine(line: string): void {
    // SSE protocol: lines starting with "data:" contain the payload
    // Lines starting with ":" are comments (heartbeat keep-alive)
    // Empty lines delimit events (we handle single-line data events)
    const trimmed = line.trim();

    if (trimmed.startsWith("data:")) {
      const payload = trimmed.slice(5).trim();
      if (!payload) return;

      try {
        const event = JSON.parse(payload) as SyncEvent;
        this.emitEvent(event);
      } catch {
        // Malformed JSON — skip
      }
    }
    // Ignore comment lines (":...") and other SSE fields (event:, id:, retry:)
  }
}
