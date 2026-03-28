// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  EngramObservation,
  EngramSearchResult,
  EngramHealthResponse,
  SddPhase,
  SddArtifact,
  SddTask,
  SddChange,
  KanonIssueState,
  KanonIssueType,
  KanonIssuePriority,
  CreateIssuePayload,
  SpecArtifactRef,
  // Sync types (Phase B)
  SyncDirection,
  ConflictStrategy,
  SyncState,
  CreateObservationPayload,
  UpdateObservationPayload,
  SyncAction,
  SyncItemResult,
  SyncError,
  SyncResult,
} from "./types.js";
export { EngramConnectionError } from "./types.js";

// ─── Classes ───────────────────────────────────────────────────────────────
export { EngramClient } from "./engram-client.js";
export type { EngramClientOptions } from "./engram-client.js";
export { SddParser } from "./sdd-parser.js";
export { EntityMapper } from "./entity-mapper.js";
export { SyncStateManager, SyncStateSchema } from "./sync-state.js";

// ─── Phase B: Core Components ───────────────────────────────────────────────
export { ReverseEntityMapper } from "./reverse-entity-mapper.js";
export type {
  ReverseMapperIssue,
  ReverseMapperChild,
} from "./reverse-entity-mapper.js";
export { DiffDetector } from "./diff-detector.js";
export type {
  DiffIssue,
  ChangeClassification,
  ExportCandidate,
  ImportCandidate,
} from "./diff-detector.js";
export { ConflictResolver } from "./conflict-resolver.js";
export type {
  SyncConflict,
  ResolvedAction,
} from "./conflict-resolver.js";

// ─── Phase B: Orchestration ─────────────────────────────────────────────────
export { SyncEngine } from "./sync-engine.js";
export type {
  SyncableIssue,
  SyncKanonClient,
  SyncEngineConfig,
} from "./sync-engine.js";
