// ─── Kanon Domain Types ────────────────────────────────────────────────────────
// Relocated here from the former @kanon/bridge package (KAN-68 PR A).
// CreateIssuePayload was NOT relocated: its specArtifacts field referenced
// SpecArtifactRef (engramId: number), an Engram-coupled type removed with the
// bridge package in KAN-68 PR B.

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
