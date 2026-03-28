import { createHash } from "node:crypto";
import { z } from "zod";
import type { SyncState } from "./types.js";

// ─── Zod Schema ──────────────────────────────────────────────────────────────

/**
 * Zod schema for validating the SyncState stored in Issue.engramContext.
 *
 * Matches R-SYNC-04:
 * ```
 * { engramId: number, topicKey: string, syncedAt: ISO8601,
 *   contentHash: string (sha256:...), engramRevision: number,
 *   direction: "imported"|"exported"|"bidirectional" }
 * ```
 */
export const SyncStateSchema = z.object({
  engramId: z.number().int().positive(),
  topicKey: z.string().min(1),
  syncedAt: z.string().datetime(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/, "Must be sha256:{64-char hex}"),
  engramRevision: z.number().int().nonnegative(),
  direction: z.enum(["imported", "exported", "bidirectional"]),
});

// ─── SyncStateManager ────────────────────────────────────────────────────────

/**
 * Manages sync state stored in the Issue.engramContext JSON column.
 *
 * Responsibilities:
 * - Parse and validate engramContext via Zod
 * - Serialize SyncState back to a plain object for storage
 * - Compute deterministic content hashes (SHA-256 of normalized content)
 * - Detect whether an issue has changed since last sync
 */
export class SyncStateManager {
  /**
   * Parse an engramContext value into a typed SyncState.
   *
   * Returns `null` if the input is null, undefined, or fails validation.
   */
  static parse(engramContext: unknown): SyncState | null {
    if (engramContext == null) {
      return null;
    }

    const result = SyncStateSchema.safeParse(engramContext);
    if (!result.success) {
      return null;
    }

    return result.data;
  }

  /**
   * Serialize a SyncState to a plain object for JSON storage.
   */
  static serialize(state: SyncState): Record<string, unknown> {
    return { ...state };
  }

  /**
   * Compute a deterministic SHA-256 hash of content.
   *
   * Normalization: lowercase, trimmed, collapsed whitespace.
   * Returns `"sha256:{hex}"` format.
   */
  static computeHash(content: string): string {
    const normalized = content.toLowerCase().trim().replace(/\s+/g, " ");
    const hex = createHash("sha256").update(normalized, "utf8").digest("hex");
    return `sha256:${hex}`;
  }

  /**
   * Check whether an issue's content has changed since the last sync.
   *
   * Compares the current content hash against the stored contentHash.
   * Returns `true` if they differ (i.e., the issue is "dirty").
   */
  static isDirty(currentContent: string, syncState: SyncState | null): boolean {
    if (syncState == null) {
      // Never synced — always considered dirty
      return true;
    }

    const currentHash = SyncStateManager.computeHash(currentContent);
    return currentHash !== syncState.contentHash;
  }
}
