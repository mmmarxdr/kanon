// ─── Engram API Response Types ─────────────────────────────────────────────

/**
 * An observation returned by Engram's HTTP API.
 */
export interface EngramObservation {
  id: number;
  sync_id: string;
  session_id: string;
  type: string;
  title: string;
  content: string;
  project?: string;
  scope: string;
  topic_key?: string;
  revision_count: number;
  duplicate_count: number;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * A search result from Engram — observation with a relevance rank.
 */
export interface EngramSearchResult extends EngramObservation {
  rank: number;
}

/**
 * Health check response from Engram.
 */
export interface EngramHealthResponse {
  service: string;
  status: string;
  version: string;
}

// ─── SDD Domain Types ──────────────────────────────────────────────────────

/**
 * Recognized SDD artifact phases.
 */
export type SddPhase =
  | "explore"
  | "proposal"
  | "spec"
  | "design"
  | "tasks"
  | "apply-progress"
  | "verify-report"
  | "archive-report"
  | "state";

/**
 * A single SDD artifact, linked to an Engram observation.
 */
export interface SddArtifact {
  changeName: string;
  phase: SddPhase;
  observationId: number;
  content: string;
  createdAt: string;
}

/**
 * A parsed task item from an SDD tasks artifact.
 */
export interface SddTask {
  title: string;
  done: boolean;
  description?: string;
}

/**
 * A grouped SDD change with all its artifacts and parsed tasks.
 */
export interface SddChange {
  name: string;
  artifacts: Map<SddPhase, SddArtifact>;
  tasks: SddTask[];
  latestPhase: SddPhase;
}

// ─── Kanon Entity Types (for mapping) ──────────────────────────────────────

/**
 * Kanon issue states — mirrors the Prisma IssueState enum.
 */
export type KanonIssueState =
  | "backlog"
  | "explore"
  | "propose"
  | "design"
  | "spec"
  | "tasks"
  | "apply"
  | "verify"
  | "archived";

/**
 * Kanon issue types — mirrors the Prisma IssueType enum.
 */
export type KanonIssueType = "feature" | "bug" | "task" | "spike";

/**
 * Kanon issue priority — mirrors the Prisma IssuePriority enum.
 */
export type KanonIssuePriority = "critical" | "high" | "medium" | "low";

/**
 * Payload shape for creating an issue in Kanon's API.
 */
export interface CreateIssuePayload {
  title: string;
  type: KanonIssueType;
  state: KanonIssueState;
  priority: KanonIssuePriority;
  description?: string;
  parentId?: string;
  labels?: string[];
  groupKey?: string;
  specArtifacts?: SpecArtifactRef;
}

/**
 * Traceability reference stored in Issue.specArtifacts JSON column.
 */
export interface SpecArtifactRef {
  topicKey: string;
  engramId: number;
  phase: SddPhase;
}

// ─── Sync Types ───────────────────────────────────────────────────────────

/**
 * Direction of the last sync operation for an issue.
 */
export type SyncDirection = "imported" | "exported" | "bidirectional";

/**
 * Conflict resolution strategy when both sides have changed.
 */
export type ConflictStrategy = "engram-wins" | "kanon-wins" | "newest-wins";

/**
 * Sync state stored in Issue.engramContext JSON column.
 * Tracks the link between a Kanon issue and an Engram observation.
 */
export interface SyncState {
  engramId: number;
  topicKey: string;
  syncedAt: string; // ISO 8601
  contentHash: string; // "sha256:{hex}"
  engramRevision: number;
  direction: SyncDirection;
}

/**
 * Payload for creating a new observation in Engram via POST /observations.
 */
export interface CreateObservationPayload {
  title: string;
  content: string;
  type: string;
  project: string;
  scope: string;
  topic_key: string;
}

/**
 * Payload for updating an existing observation in Engram via PATCH /observations/:id.
 */
export interface UpdateObservationPayload {
  title?: string;
  content?: string;
  type?: string;
  topic_key?: string;
}

/**
 * Classification of an item's sync status.
 */
export type SyncAction = "create" | "update" | "skip";

/**
 * Result for a single item in a sync operation.
 */
export interface SyncItemResult {
  issueKey: string;
  action: SyncAction;
  direction: SyncDirection;
  success: boolean;
  error?: string;
}

/**
 * Error detail for a failed sync item.
 */
export interface SyncError {
  item: string;
  error: string;
}

/**
 * Aggregated result of a sync operation.
 */
export interface SyncResult {
  exported: number;
  imported: number;
  unchanged: number;
  conflicts: number;
  errors: SyncError[];
  items: SyncItemResult[];
}

// ─── Error Types ───────────────────────────────────────────────────────────

/**
 * Typed error for Engram connection/API failures.
 */
export class EngramConnectionError extends Error {
  public readonly url: string;
  public override readonly cause?: unknown;

  constructor(message: string, url: string, cause?: unknown) {
    super(message, { cause });
    this.name = "EngramConnectionError";
    this.url = url;
  }
}
