import type {
  ConflictStrategy,
  CreateObservationPayload,
  EngramObservation,
  SyncError,
  SyncItemResult,
  SyncResult,
  SyncState,
} from "./types.js";
import { SyncStateManager } from "./sync-state.js";
import { DiffDetector } from "./diff-detector.js";
import type { DiffIssue, ExportCandidate, ImportCandidate } from "./diff-detector.js";
import { ConflictResolver } from "./conflict-resolver.js";
import type { SyncConflict } from "./conflict-resolver.js";
import { EntityMapper } from "./entity-mapper.js";
import { ReverseEntityMapper } from "./reverse-entity-mapper.js";
import type { ReverseMapperChild, ReverseMapperIssue } from "./reverse-entity-mapper.js";
import type { EngramClient } from "./engram-client.js";

// ─── Local Types ──────────────────────────────────────────────────────────────

/**
 * Issue shape consumed by the SyncEngine.
 *
 * Extends DiffIssue with fields needed for export and conflict resolution.
 * The `updatedAt` field is required for the `newest-wins` strategy.
 */
export interface SyncableIssue extends DiffIssue, ReverseMapperIssue {
  updatedAt?: string;
  children?: ReverseMapperChild[];
}

/**
 * Minimal Kanon client interface consumed by the SyncEngine.
 *
 * Matches the public API of `KanonClient` from `packages/cli/src/kanon-client.ts`
 * without importing it directly (avoids cross-package dependency).
 */
export interface SyncKanonClient {
  createIssue(
    projectKey: string,
    body: Record<string, unknown>,
  ): Promise<{ key: string }>;
  updateIssue(
    projectKey: string,
    issueKey: string,
    body: Record<string, unknown>,
  ): Promise<{ key: string }>;
}

/**
 * Configuration for the SyncEngine.
 */
export interface SyncEngineConfig {
  /** Kanon project key (e.g., "KAN") */
  projectKey: string;

  /** Engram project namespace */
  namespace: string;

  /** Default conflict resolution strategy */
  defaultStrategy: ConflictStrategy;

  /** Maximum concurrent HTTP requests (default: 5) */
  concurrency?: number;

  /** Optional progress callback */
  onProgress?: (current: number, total: number, item: string) => void;
}

// ─── Concurrency Limiter ──────────────────────────────────────────────────────

/**
 * Simple concurrency limiter (replaces p-limit dependency).
 * Limits the number of simultaneously active async operations.
 */
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    while (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

// ─── SyncEngine ───────────────────────────────────────────────────────────────

/**
 * Orchestrates bidirectional sync between Kanon issues and Engram observations.
 *
 * Composes:
 * - `DiffDetector` — identifies what changed
 * - `ConflictResolver` — resolves both-modified conflicts
 * - `ReverseEntityMapper` — converts issues to observation markdown
 * - `SyncStateManager` — manages content hashes and sync state
 * - `EngramClient` — reads/writes Engram observations
 * - `SyncKanonClient` — updates Kanon issues (engramContext)
 *
 * Error handling: collects per-item errors without aborting (R-SYNC-10).
 * Concurrency: limits parallel HTTP calls (R-SYNC-11, default 5).
 * Idempotency: content hash comparison prevents unnecessary writes (R-SYNC-12).
 */
export class SyncEngine {
  private readonly engram: EngramClient;
  private readonly kanon: SyncKanonClient;
  private readonly config: SyncEngineConfig;

  constructor(
    engramClient: EngramClient,
    kanonClient: SyncKanonClient,
    config: SyncEngineConfig,
  ) {
    this.engram = engramClient;
    this.kanon = kanonClient;
    this.config = config;
  }

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Export Kanon issues to Engram observations (R-SYNC-07).
   *
   * Steps:
   * 1. Detect which issues have changed since last sync
   * 2. Resolve conflicts for both-modified items
   * 3. Create or update observations in Engram
   * 4. Stamp engramContext on each issue after success
   */
  async exportToEngram(
    issues: SyncableIssue[],
    opts?: {
      strategy?: ConflictStrategy;
      dryRun?: boolean;
    },
  ): Promise<SyncResult> {
    const strategy = opts?.strategy ?? this.config.defaultStrategy;
    const dryRun = opts?.dryRun ?? false;

    // Fetch existing observations for revision comparison
    const observationMap = await this.fetchObservationMap(issues);

    // Detect export candidates
    const candidates = DiffDetector.findExportCandidates(issues, observationMap);

    // Separate conflicts from clean candidates
    const { clean, conflicts } = this.separateConflicts(candidates, issues);

    // Resolve conflicts — only export those where Kanon wins
    const resolvedExports = this.resolveExportConflicts(conflicts, strategy);

    // Merge clean candidates with resolved conflict exports
    const allExports = [...clean, ...resolvedExports];
    const conflictCount = conflicts.length;

    if (dryRun) {
      return this.buildDryRunResult(allExports, [], conflictCount);
    }

    // Apply exports with concurrency limiting
    const limit = createLimiter(this.config.concurrency ?? 5);
    const total = allExports.length;
    const items: SyncItemResult[] = [];
    const errors: SyncError[] = [];

    const tasks = allExports.map((candidate, index) =>
      limit(async () => {
        const issue = candidate.issue as SyncableIssue;
        this.config.onProgress?.(index + 1, total, issue.key);

        try {
          const observation = await this.applyExport(issue, candidate);
          await this.stampEngramContext(issue, observation, "exported");
          items.push({
            issueKey: issue.key,
            action: candidate.action,
            direction: "exported",
            success: true,
          });
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : String(err);
          errors.push({ item: issue.key, error: errorMsg });
          items.push({
            issueKey: issue.key,
            action: candidate.action,
            direction: "exported",
            success: false,
            error: errorMsg,
          });
        }
      }),
    );

    await Promise.all(tasks);

    return this.buildResult(items, errors, issues.length, conflictCount);
  }

  /**
   * Import Engram observations into Kanon issues (R-SYNC-08).
   *
   * Steps:
   * 1. Detect which observations have changed since last sync
   * 2. Resolve conflicts for both-modified items
   * 3. Update Kanon issues with Engram content
   * 4. Stamp engramContext on each issue after success
   */
  async importFromEngram(
    issues: SyncableIssue[],
    observations: EngramObservation[],
    opts?: {
      strategy?: ConflictStrategy;
      dryRun?: boolean;
    },
  ): Promise<SyncResult> {
    const strategy = opts?.strategy ?? this.config.defaultStrategy;
    const dryRun = opts?.dryRun ?? false;

    // Build sync state map from existing issues
    const syncStateMap = new Map<string, SyncState>();
    for (const issue of issues) {
      const state = SyncStateManager.parse(issue.engramContext);
      if (state != null) {
        syncStateMap.set(state.topicKey, state);
      }
    }

    // Detect import candidates
    const candidates = DiffDetector.findImportCandidates(
      observations,
      syncStateMap,
    );

    if (dryRun) {
      return this.buildDryRunResult([], candidates, 0);
    }

    // Apply imports with concurrency limiting
    const limit = createLimiter(this.config.concurrency ?? 5);
    const total = candidates.length;
    const items: SyncItemResult[] = [];
    const errors: SyncError[] = [];

    // Build issue lookup by topic key for updating engramContext
    const issueByTopicKey = new Map<string, SyncableIssue>();
    for (const issue of issues) {
      const state = SyncStateManager.parse(issue.engramContext);
      if (state != null) {
        issueByTopicKey.set(state.topicKey, issue);
      }
    }

    const tasks = candidates.map((candidate, index) =>
      limit(async () => {
        const topicKey = candidate.observation.topic_key ?? "unknown";
        let itemKey =
          issueByTopicKey.get(topicKey)?.key ?? topicKey;
        this.config.onProgress?.(index + 1, total, itemKey);

        try {
          const issue = issueByTopicKey.get(topicKey);
          if (candidate.action === "create") {
            // Create a new Kanon issue from the Engram observation
            const payload: Record<string, unknown> = {
              title: candidate.observation.title,
              description: candidate.observation.content,
              type: "task",
              priority: "medium",
              groupKey: EntityMapper.deriveGroupKey(candidate.observation.topic_key) ?? undefined,
              labels: candidate.observation.topic_key
                ? [`engram:${candidate.observation.topic_key.split("/")[0]}`]
                : [],
            };
            const created = await this.kanon.createIssue(
              this.config.projectKey,
              payload,
            );

            // Stamp engramContext on the newly created issue
            const createdIssue: SyncableIssue = {
              key: created.key,
              title: candidate.observation.title,
              description: candidate.observation.content,
              type: "task",
              state: "backlog",
              priority: "medium",
              engramContext: null,
            };
            await this.stampEngramContextFromObservation(
              createdIssue,
              candidate.observation,
              "imported",
            );

            itemKey = created.key;
          } else if (issue != null && candidate.action === "update") {
            // Update existing issue with Engram content
            await this.kanon.updateIssue(
              this.config.projectKey,
              issue.key,
              {
                description: candidate.observation.content,
                groupKey: EntityMapper.deriveGroupKey(candidate.observation.topic_key) ?? undefined,
              },
            );

            // Stamp engramContext
            await this.stampEngramContextFromObservation(
              issue,
              candidate.observation,
              "imported",
            );
          }

          items.push({
            issueKey: itemKey,
            action: candidate.action,
            direction: "imported",
            success: true,
          });
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : String(err);
          errors.push({ item: itemKey, error: errorMsg });
          items.push({
            issueKey: itemKey,
            action: candidate.action,
            direction: "imported",
            success: false,
            error: errorMsg,
          });
        }
      }),
    );

    await Promise.all(tasks);

    return this.buildResult(
      items,
      errors,
      issues.length + observations.length,
      0,
    );
  }

  /**
   * Full bidirectional sync (R-SYNC-09).
   *
   * Runs export then import, merging results.
   */
  async sync(
    issues: SyncableIssue[],
    observations: EngramObservation[],
    opts?: {
      strategy?: ConflictStrategy;
      dryRun?: boolean;
    },
  ): Promise<SyncResult> {
    const exportResult = await this.exportToEngram(issues, opts);
    const importResult = await this.importFromEngram(
      issues,
      observations,
      opts,
    );

    return {
      exported: exportResult.exported,
      imported: importResult.imported,
      unchanged:
        exportResult.unchanged + importResult.unchanged,
      conflicts: exportResult.conflicts + importResult.conflicts,
      errors: [...exportResult.errors, ...importResult.errors],
      items: [...exportResult.items, ...importResult.items],
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  /**
   * Fetch Engram observations for issues that have prior sync state.
   * Returns a map of engramId → EngramObservation.
   */
  private async fetchObservationMap(
    issues: SyncableIssue[],
  ): Promise<Map<number, EngramObservation>> {
    const map = new Map<number, EngramObservation>();
    const limit = createLimiter(this.config.concurrency ?? 5);

    const fetches = issues
      .map((issue) => {
        const state = SyncStateManager.parse(issue.engramContext);
        return state;
      })
      .filter((state): state is SyncState => state != null)
      .map((state) =>
        limit(async () => {
          try {
            const obs = await this.engram.getObservation(state.engramId);
            map.set(state.engramId, obs);
          } catch {
            // If we can't fetch the observation, skip — DiffDetector
            // will treat missing observations as Kanon-only change
          }
        }),
      );

    await Promise.all(fetches);
    return map;
  }

  /**
   * Separate export candidates into clean exports and conflicts.
   *
   * Conflicts are candidates where DiffDetector classified the item as
   * `both-modified` (reason contains "conflict").
   */
  private separateConflicts(
    candidates: ExportCandidate[],
    issues: SyncableIssue[],
  ): {
    clean: ExportCandidate[];
    conflicts: Array<{ candidate: ExportCandidate; issue: SyncableIssue }>;
  } {
    const clean: ExportCandidate[] = [];
    const conflicts: Array<{
      candidate: ExportCandidate;
      issue: SyncableIssue;
    }> = [];

    // Build issue lookup by key
    const issueMap = new Map<string, SyncableIssue>();
    for (const issue of issues) {
      issueMap.set(issue.key, issue);
    }

    for (const candidate of candidates) {
      if (candidate.reason.includes("conflict")) {
        const issue = issueMap.get(candidate.issue.key);
        if (issue != null) {
          conflicts.push({ candidate, issue });
        }
      } else {
        clean.push(candidate);
      }
    }

    return { clean, conflicts };
  }

  /**
   * Resolve export conflicts — returns only candidates where Kanon wins.
   */
  private resolveExportConflicts(
    conflicts: Array<{ candidate: ExportCandidate; issue: SyncableIssue }>,
    strategy: ConflictStrategy,
  ): ExportCandidate[] {
    if (conflicts.length === 0) return [];

    const syncConflicts: SyncConflict[] = conflicts.map(({ issue, candidate }) => ({
      issueKey: issue.key,
      engramId: candidate.syncState?.engramId ?? 0,
      kanonUpdatedAt: issue.updatedAt ?? new Date().toISOString(),
      engramUpdatedAt: candidate.syncState?.syncedAt ?? new Date().toISOString(),
    }));

    const resolved = ConflictResolver.resolve(syncConflicts, strategy);

    return resolved
      .filter((r) => r.winner === "kanon")
      .map((r) => {
        const match = conflicts.find(
          (c) => c.issue.key === r.conflict.issueKey,
        );
        return match?.candidate;
      })
      .filter((c): c is ExportCandidate => c != null);
  }

  /**
   * Create or update an observation in Engram for an export candidate.
   *
   * Uses ReverseEntityMapper's full markdown output for the content,
   * ensuring the content hash matches what we store in engramContext.
   */
  private async applyExport(
    issue: SyncableIssue,
    candidate: ExportCandidate,
  ): Promise<EngramObservation> {
    if (candidate.action === "create") {
      const payload: CreateObservationPayload =
        ReverseEntityMapper.issueToCreatePayload(
          issue,
          this.config.projectKey,
          this.config.namespace,
          issue.children,
        );
      return this.engram.createObservation(payload);
    }

    // Update existing observation
    const content = ReverseEntityMapper.issueToObservationContent(
      issue,
      issue.children,
    );
    return this.engram.updateObservation(candidate.syncState!.engramId, {
      title: `${issue.key}: ${issue.title}`,
      content,
    });
  }

  /**
   * Stamp engramContext on a Kanon issue after a successful export.
   *
   * Uses ReverseEntityMapper's full markdown output for content hashing,
   * matching the content that was actually sent to Engram. This avoids
   * hash mismatches between DiffDetector's simple title+description hash
   * and the richer markdown that ReverseEntityMapper produces.
   */
  private async stampEngramContext(
    issue: SyncableIssue,
    observation: EngramObservation,
    direction: "imported" | "exported" | "bidirectional",
  ): Promise<void> {
    // Hash the full markdown content that was sent to Engram
    const fullContent = ReverseEntityMapper.issueToObservationContent(
      issue,
      issue.children,
    );
    const contentHash = SyncStateManager.computeHash(fullContent);

    const syncState: SyncState = {
      engramId: observation.id,
      topicKey:
        observation.topic_key ??
        ReverseEntityMapper.issueToTopicKey(issue, this.config.projectKey),
      syncedAt: new Date().toISOString(),
      contentHash,
      engramRevision: observation.revision_count,
      direction,
    };

    await this.kanon.updateIssue(this.config.projectKey, issue.key, {
      engramContext: SyncStateManager.serialize(syncState),
    });
  }

  /**
   * Stamp engramContext on a Kanon issue after a successful import.
   */
  private async stampEngramContextFromObservation(
    issue: SyncableIssue,
    observation: EngramObservation,
    direction: "imported" | "exported" | "bidirectional",
  ): Promise<void> {
    const contentHash = SyncStateManager.computeHash(observation.content);

    const syncState: SyncState = {
      engramId: observation.id,
      topicKey:
        observation.topic_key ??
        ReverseEntityMapper.issueToTopicKey(issue, this.config.projectKey),
      syncedAt: new Date().toISOString(),
      contentHash,
      engramRevision: observation.revision_count,
      direction,
    };

    await this.kanon.updateIssue(this.config.projectKey, issue.key, {
      engramContext: SyncStateManager.serialize(syncState),
    });
  }

  /**
   * Build a SyncResult from completed items.
   */
  private buildResult(
    items: SyncItemResult[],
    errors: SyncError[],
    totalItems: number,
    conflictCount: number,
  ): SyncResult {
    const exported = items.filter(
      (i) => i.direction === "exported" && i.success,
    ).length;
    const imported = items.filter(
      (i) => i.direction === "imported" && i.success,
    ).length;
    const processed = items.filter((i) => i.success).length;

    return {
      exported,
      imported,
      unchanged: Math.max(0, totalItems - items.length),
      conflicts: conflictCount,
      errors,
      items,
    };
  }

  /**
   * Build a dry-run SyncResult (no mutations).
   */
  private buildDryRunResult(
    exportCandidates: ExportCandidate[],
    importCandidates: ImportCandidate[],
    conflictCount: number,
  ): SyncResult {
    const items: SyncItemResult[] = [
      ...exportCandidates.map(
        (c): SyncItemResult => ({
          issueKey: c.issue.key,
          action: c.action,
          direction: "exported",
          success: true,
        }),
      ),
      ...importCandidates.map(
        (c): SyncItemResult => ({
          issueKey: c.observation.topic_key ?? `obs-${c.observation.id}`,
          action: c.action,
          direction: "imported",
          success: true,
        }),
      ),
    ];

    return {
      exported: exportCandidates.length,
      imported: importCandidates.length,
      unchanged: 0,
      conflicts: conflictCount,
      errors: [],
      items,
    };
  }
}
