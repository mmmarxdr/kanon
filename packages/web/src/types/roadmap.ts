export type Horizon = "now" | "next" | "later" | "someday";
export type RoadmapStatus = "idea" | "planned" | "in_progress" | "done";

/**
 * A dependency relationship between two roadmap items.
 */
export interface RoadmapDependency {
  id: string;
  type: "blocks";
  sourceId: string;
  targetId: string;
  createdAt: string;
  source?: { id: string; title: string; status: RoadmapStatus };
  target?: { id: string; title: string; status: RoadmapStatus };
}

/**
 * Roadmap item shape matching the API response from
 * GET /api/projects/:key/roadmap
 */
export interface RoadmapItem {
  id: string;
  title: string;
  description?: string | null;
  horizon: Horizon;
  effort?: number | null;
  impact?: number | null;
  labels: string[];
  sortOrder: number;
  targetDate?: string | null;
  promoted: boolean;
  status: RoadmapStatus;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  /** Items this item blocks (source side of dependency). */
  blocks?: RoadmapDependency[];
  /** Items that block this item (target side of dependency). */
  dependsOn?: RoadmapDependency[];
}

/**
 * Input shape for creating a new roadmap item via POST /api/projects/:key/roadmap.
 */
export interface CreateRoadmapItemInput {
  title: string;
  description?: string;
  horizon?: Horizon;
  effort?: number;
  impact?: number;
  labels?: string[];
  sortOrder?: number;
  targetDate?: string;
}

/**
 * Input shape for updating a roadmap item via PATCH /api/projects/:key/roadmap/:id.
 */
export interface UpdateRoadmapItemInput {
  title?: string;
  description?: string | null;
  horizon?: Horizon;
  effort?: number | null;
  impact?: number | null;
  labels?: string[];
  sortOrder?: number;
  targetDate?: string | null;
}

/**
 * Input shape for promoting a roadmap item to an issue via POST /api/projects/:key/roadmap/:id/promote.
 */
export interface PromoteRoadmapItemInput {
  title?: string;
  type?: "feature" | "bug" | "task" | "spike";
  priority?: "critical" | "high" | "medium" | "low";
  labels?: string[];
  groupKey?: string;
}
