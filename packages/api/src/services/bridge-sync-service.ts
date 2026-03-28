import { EventEmitter } from "events";
import type { EngramClient } from "@kanon/bridge";
import type { EngramObservation } from "@kanon/bridge";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncEvent {
  type: "sync_complete" | "sync_error" | "heartbeat";
  projectKey?: string;
  changedCount?: number;
  message?: string;
  timestamp: string;
}

export interface BridgeSyncServiceConfig {
  /** Poll interval in milliseconds (>= 5000) */
  pollIntervalMs: number;
  /** Engram project key to filter observations */
  projectKey?: string;
}

export type BridgeSyncStatus = "idle" | "polling" | "syncing" | "error";

// ─── Typed Event Emitter ────────────────────────────────────────────────────

export interface BridgeSyncServiceEvents {
  sync_complete: (event: SyncEvent) => void;
  sync_error: (event: SyncEvent) => void;
  heartbeat: (event: SyncEvent) => void;
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * Polls Engram for new/updated observations and emits sync events.
 *
 * Tracks a high-water mark (`updated_at` timestamp) so each poll only
 * processes observations that changed since the last successful poll.
 *
 * Lifecycle: call `start()` to begin polling, `stop()` to tear down.
 * Emits typed events: `sync_complete`, `sync_error`, `heartbeat`.
 */
export interface ForcePollResult {
  triggered: boolean;
  retryAfterMs?: number;
}

export class BridgeSyncService extends EventEmitter {
  private readonly engram: EngramClient;
  private readonly config: BridgeSyncServiceConfig;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private highWaterMark: string;
  private status: BridgeSyncStatus = "idle";
  private polling = false; // guard against overlapping polls
  private lastForcePollAt: number = 0;

  private static readonly FORCE_POLL_COOLDOWN_MS = 10_000;

  constructor(engramClient: EngramClient, config: BridgeSyncServiceConfig) {
    super();
    this.engram = engramClient;
    this.config = config;
    // Start with current time so we only pick up changes from now on
    this.highWaterMark = new Date().toISOString();
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * Begin polling Engram at the configured interval.
   * No-op if already started.
   */
  start(): void {
    if (this.pollTimer != null) return;

    this.status = "polling";
    this.pollTimer = setInterval(
      () => void this.poll(),
      this.config.pollIntervalMs,
    );

    // Run an initial poll immediately
    void this.poll();
  }

  /**
   * Stop polling and clean up resources.
   */
  stop(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.status = "idle";
    this.removeAllListeners();
  }

  /**
   * Current service status.
   */
  getStatus(): BridgeSyncStatus {
    return this.status;
  }

  /**
   * Current high-water mark (last seen updated_at timestamp).
   * Useful for testing and debugging.
   */
  getHighWaterMark(): string {
    return this.highWaterMark;
  }

  /**
   * Whether a force-poll cooldown is currently active.
   */
  isOnCooldown(): boolean {
    return (
      Date.now() - this.lastForcePollAt <
      BridgeSyncService.FORCE_POLL_COOLDOWN_MS
    );
  }

  /**
   * Trigger an immediate poll, bypassing the interval timer.
   *
   * Enforces a 10-second cooldown between force polls.
   * Rejects if a poll is already in progress.
   */
  async forcePoll(): Promise<ForcePollResult> {
    // Reject if a poll is already in progress
    if (this.polling) {
      return { triggered: false, retryAfterMs: 1000 };
    }

    // Enforce cooldown
    const elapsed = Date.now() - this.lastForcePollAt;
    if (elapsed < BridgeSyncService.FORCE_POLL_COOLDOWN_MS) {
      return {
        triggered: false,
        retryAfterMs: BridgeSyncService.FORCE_POLL_COOLDOWN_MS - elapsed,
      };
    }

    this.lastForcePollAt = Date.now();
    await this.poll();
    return { triggered: true };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  /**
   * Single poll iteration.
   *
   * Fetches observations updated after the high-water mark.
   * If changes are found, emits `sync_complete` and advances the mark.
   * On error, emits `sync_error` and continues polling.
   */
  private async poll(): Promise<void> {
    // Prevent overlapping polls (e.g., if a poll takes longer than the interval)
    if (this.polling) return;
    this.polling = true;

    try {
      this.status = "syncing";

      const changed: EngramObservation[] =
        await this.engram.listRecentSince(
          this.highWaterMark,
          this.config.projectKey,
        );

      if (changed.length > 0) {
        // Advance high-water mark to the latest updated_at
        const latest = changed.reduce((max, obs) =>
          obs.updated_at > max ? obs.updated_at : max,
          this.highWaterMark,
        );
        this.highWaterMark = latest;

        const event: SyncEvent = {
          type: "sync_complete",
          projectKey: this.config.projectKey,
          changedCount: changed.length,
          timestamp: new Date().toISOString(),
        };

        this.status = "polling";
        this.emit("sync_complete", event);
      } else {
        // No changes — emit heartbeat
        this.status = "polling";
        const event: SyncEvent = {
          type: "heartbeat",
          timestamp: new Date().toISOString(),
        };
        this.emit("heartbeat", event);
      }
    } catch (err) {
      this.status = "error";

      const message = err instanceof Error ? err.message : String(err);
      const event: SyncEvent = {
        type: "sync_error",
        message,
        timestamp: new Date().toISOString(),
      };

      this.emit("sync_error", event);

      // Do NOT advance high-water mark on error — retry next poll
      // Status reverts to polling so the next interval continues
      this.status = "polling";
    } finally {
      this.polling = false;
    }
  }
}
