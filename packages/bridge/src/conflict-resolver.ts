import type { ConflictStrategy, SyncDirection } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A conflict between a Kanon issue and an Engram observation where
 * both sides have changed since the last sync.
 */
export interface SyncConflict {
  /** Kanon issue key (e.g., "KAN-5") */
  issueKey: string;

  /** Engram observation ID */
  engramId: number;

  /** When the Kanon side was last updated (ISO 8601) */
  kanonUpdatedAt: string;

  /** When the Engram side was last updated (ISO 8601) */
  engramUpdatedAt: string;
}

/**
 * The resolved action to take for a conflict.
 */
export interface ResolvedAction {
  /** The original conflict */
  conflict: SyncConflict;

  /** Which direction the data flows to resolve the conflict */
  winner: "kanon" | "engram";

  /** The direction of the sync operation to apply */
  direction: SyncDirection;

  /** Human-readable reason for the resolution */
  reason: string;
}

// ─── ConflictResolver ───────────────────────────────────────────────────────

/**
 * Resolves sync conflicts between Kanon issues and Engram observations
 * using a configurable strategy.
 *
 * Strategies:
 * - `engram-wins`: Engram content overwrites Kanon (import direction)
 * - `kanon-wins`: Kanon content overwrites Engram (export direction)
 * - `newest-wins`: Compare `updatedAt` timestamps; newest source wins
 */
export class ConflictResolver {
  /**
   * Resolve an array of conflicts using the specified strategy.
   *
   * @param conflicts  Array of detected conflicts (both sides changed)
   * @param strategy   The conflict resolution strategy to apply
   * @returns          Array of resolved actions, one per conflict
   */
  static resolve(
    conflicts: SyncConflict[],
    strategy: ConflictStrategy,
  ): ResolvedAction[] {
    return conflicts.map((conflict) =>
      ConflictResolver.resolveOne(conflict, strategy),
    );
  }

  /**
   * Resolve a single conflict using the specified strategy.
   */
  private static resolveOne(
    conflict: SyncConflict,
    strategy: ConflictStrategy,
  ): ResolvedAction {
    switch (strategy) {
      case "engram-wins":
        return {
          conflict,
          winner: "engram",
          direction: "imported",
          reason: `Strategy "engram-wins": Engram content overwrites Kanon for ${conflict.issueKey}`,
        };

      case "kanon-wins":
        return {
          conflict,
          winner: "kanon",
          direction: "exported",
          reason: `Strategy "kanon-wins": Kanon content overwrites Engram for ${conflict.issueKey}`,
        };

      case "newest-wins":
        return ConflictResolver.resolveByTimestamp(conflict);
    }
  }

  /**
   * Resolve a conflict by comparing timestamps (newest wins).
   *
   * Compares `kanonUpdatedAt` vs `engramUpdatedAt` as ISO 8601 dates.
   * If timestamps are equal, defaults to Kanon (local source of truth).
   */
  private static resolveByTimestamp(conflict: SyncConflict): ResolvedAction {
    const kanonTime = new Date(conflict.kanonUpdatedAt).getTime();
    const engramTime = new Date(conflict.engramUpdatedAt).getTime();

    if (engramTime > kanonTime) {
      return {
        conflict,
        winner: "engram",
        direction: "imported",
        reason: `Strategy "newest-wins": Engram is newer (${conflict.engramUpdatedAt} > ${conflict.kanonUpdatedAt})`,
      };
    }

    // Kanon wins if timestamps are equal or Kanon is newer
    return {
      conflict,
      winner: "kanon",
      direction: "exported",
      reason:
        engramTime === kanonTime
          ? `Strategy "newest-wins": Timestamps equal — defaulting to Kanon for ${conflict.issueKey}`
          : `Strategy "newest-wins": Kanon is newer (${conflict.kanonUpdatedAt} > ${conflict.engramUpdatedAt})`,
    };
  }
}
