import type {
  EngramObservation,
  SyncState,
} from "./types.js";
import { SyncStateManager } from "./sync-state.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal issue shape consumed by the diff detector.
 * Mirrors the fields actually needed for change detection.
 */
export interface DiffIssue {
  key: string;
  title: string;
  description?: string | null;
  engramContext?: unknown;
}

/**
 * Classification of an item's change status relative to last sync.
 */
export type ChangeClassification =
  | "unchanged"
  | "kanon-modified"
  | "engram-modified"
  | "both-modified"
  | "new";

/**
 * A candidate item identified for export (Kanon → Engram).
 */
export interface ExportCandidate {
  issue: DiffIssue;
  action: "create" | "update";
  reason: string;
  syncState: SyncState | null;
}

/**
 * A candidate item identified for import (Engram → Kanon).
 */
export interface ImportCandidate {
  observation: EngramObservation;
  action: "create" | "update";
  reason: string;
  syncState: SyncState | null;
}

// ─── DiffDetector ───────────────────────────────────────────────────────────

/**
 * Compares current Kanon issue state and Engram observation state against
 * the last sync snapshot to identify items that need syncing.
 *
 * Uses content hashing (SHA-256 via `SyncStateManager.computeHash`) for
 * efficient change detection.
 */
export class DiffDetector {
  /**
   * Build a content string from an issue for hashing purposes.
   * Uses title + description to match what ReverseEntityMapper would produce.
   */
  static buildIssueContent(issue: DiffIssue): string {
    return `${issue.title}\n${issue.description ?? ""}`;
  }

  /**
   * Classify an issue's change status relative to its last sync state
   * and the corresponding Engram observation.
   */
  static classify(
    issue: DiffIssue,
    syncState: SyncState | null,
    observation?: EngramObservation | null,
  ): ChangeClassification {
    // Never synced — it's new
    if (syncState == null) {
      return "new";
    }

    const currentContent = DiffDetector.buildIssueContent(issue);
    const kanonDirty = SyncStateManager.isDirty(currentContent, syncState);

    // Check Engram side: revision_count changed means Engram was modified
    const engramDirty =
      observation != null &&
      observation.revision_count !== syncState.engramRevision;

    if (kanonDirty && engramDirty) {
      return "both-modified";
    }
    if (kanonDirty) {
      return "kanon-modified";
    }
    if (engramDirty) {
      return "engram-modified";
    }

    return "unchanged";
  }

  /**
   * Find issues that need to be exported to Engram.
   *
   * Returns candidates classified as `new`, `kanon-modified`, or
   * `both-modified`. Items classified as `unchanged` or `engram-modified`
   * are skipped.
   *
   * @param issues    All Kanon issues to evaluate
   * @param observations  Map of engramId → EngramObservation (for revision checks).
   *                      Can be empty if observations haven't been fetched.
   */
  static findExportCandidates(
    issues: DiffIssue[],
    observations?: Map<number, EngramObservation>,
  ): ExportCandidate[] {
    const candidates: ExportCandidate[] = [];

    for (const issue of issues) {
      const syncState = SyncStateManager.parse(issue.engramContext);

      // Look up the corresponding Engram observation if we have it
      const observation =
        syncState != null && observations != null
          ? observations.get(syncState.engramId) ?? null
          : null;

      const classification = DiffDetector.classify(
        issue,
        syncState,
        observation,
      );

      switch (classification) {
        case "new":
          candidates.push({
            issue,
            action: "create",
            reason: "Issue has no prior sync state — first export",
            syncState,
          });
          break;

        case "kanon-modified":
          candidates.push({
            issue,
            action: "update",
            reason: "Issue content changed since last sync",
            syncState,
          });
          break;

        case "both-modified":
          // Both-modified items are still export candidates — conflict
          // resolution happens downstream in ConflictResolver
          candidates.push({
            issue,
            action: "update",
            reason: "Both Kanon and Engram changed since last sync (conflict)",
            syncState,
          });
          break;

        // "unchanged" and "engram-modified" are not export candidates
        default:
          break;
      }
    }

    return candidates;
  }

  /**
   * Find observations that need to be imported into Kanon.
   *
   * Returns candidates where the Engram observation has changed since
   * last sync, or where no matching Kanon issue exists yet.
   *
   * @param observations  Engram observations to evaluate
   * @param syncStates    Map of topicKey → SyncState (from existing Kanon issues)
   */
  static findImportCandidates(
    observations: EngramObservation[],
    syncStates: Map<string, SyncState>,
  ): ImportCandidate[] {
    const candidates: ImportCandidate[] = [];

    for (const observation of observations) {
      const topicKey = observation.topic_key;
      if (topicKey == null) {
        continue;
      }

      const syncState = syncStates.get(topicKey) ?? null;

      if (syncState == null) {
        // No matching Kanon issue — create
        candidates.push({
          observation,
          action: "create",
          reason: "No matching Kanon issue found — first import",
          syncState,
        });
        continue;
      }

      // Check if Engram side changed (revision bump)
      const engramDirty =
        observation.revision_count !== syncState.engramRevision;

      if (engramDirty) {
        candidates.push({
          observation,
          action: "update",
          reason: "Engram observation has new revisions since last sync",
          syncState,
        });
      }
      // If not dirty, skip (unchanged)
    }

    return candidates;
  }
}
