// ─── Response Transform & Pagination Layer ─────────────────────────────────
// Reduces token usage by stripping unnecessary fields from API responses.
// Uses allowlist approach: only explicitly listed fields survive in "slim" mode.

import type {
  KanonIssue,
  KanonRoadmapItem,
  KanonProject,
  KanonWorkspace,
  GroupSummary,
} from "./kanon-client.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Format = "slim" | "full";
export type EntityType = "issue" | "issue-detail" | "roadmap" | "project" | "workspace" | "group";

// ─── Field Allowlists ───────────────────────────────────────────────────────

export const ISSUE_LIST_FIELDS = [
  "key", "title", "state", "type", "priority", "labels", "groupKey", "dueDate",
] as const;

export const ISSUE_DETAIL_FIELDS = [
  ...ISSUE_LIST_FIELDS, "description", "project", "children",
] as const;

export const ROADMAP_LIST_FIELDS = [
  "title", "horizon", "status", "effort", "impact", "labels", "promoted", "targetDate",
] as const;

export const PROJECT_FIELDS = [
  "key", "name", "description",
] as const;

export const WORKSPACE_FIELDS = [
  "id", "name", "slug",
] as const;

export const GROUP_FIELDS = [
  "groupKey", "count", "latestState", "title",
] as const;

// ─── Pagination Constants ───────────────────────────────────────────────────

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Pick only the specified fields from an object.
 * Returns a new object containing only keys present in both the source and the allowlist.
 */
export function slimPick<T extends Record<string, unknown>>(
  obj: T,
  fields: readonly string[],
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in obj) {
      result[field] = obj[field as keyof T];
    }
  }
  return result as Partial<T>;
}

// ─── Per-Entity Transform Functions ─────────────────────────────────────────

/**
 * Slim transform for issues in list context.
 * Flattens assignee object to just the username string.
 */
export function slimIssue(issue: KanonIssue): Record<string, unknown> {
  const base = slimPick(issue as unknown as Record<string, unknown>, ISSUE_LIST_FIELDS);
  // Flatten assignee: extract username/name if it's an object, otherwise pass through
  const raw = issue as unknown as Record<string, unknown>;
  const assignee = raw["assignee"];
  if (assignee && typeof assignee === "object" && assignee !== null) {
    const assigneeObj = assignee as Record<string, unknown>;
    base["assignee"] = assigneeObj["username"] ?? assigneeObj["name"] ?? null;
  } else if (assignee !== undefined) {
    base["assignee"] = assignee;
  }
  return base as Record<string, unknown>;
}

/**
 * Slim transform for a single issue detail view.
 * Includes description, project key, and slimmed children.
 */
export function slimIssueDetail(issue: KanonIssue): Record<string, unknown> {
  const base = slimIssue(issue);
  // Add detail-only fields
  base["description"] = issue.description ?? null;
  // Extract project key if project is an object
  const raw = issue as unknown as Record<string, unknown>;
  const project = raw["project"];
  if (project && typeof project === "object" && project !== null) {
    base["project"] = (project as Record<string, unknown>)["key"] ?? null;
  }
  // Slim children to just {key, title, state}
  const children = raw["children"];
  if (Array.isArray(children)) {
    base["children"] = children.map((child: Record<string, unknown>) => ({
      key: child["key"],
      title: child["title"],
      state: child["state"],
    }));
  } else {
    base["children"] = [];
  }
  // Include parentKey if present
  const parentKey = raw["parentKey"];
  if (parentKey !== undefined) {
    base["parentKey"] = parentKey;
  }
  return base;
}

/**
 * Slim transform for roadmap items.
 * Uses optional chaining for fields that may not exist on the TS type.
 */
export function slimRoadmapItem(item: KanonRoadmapItem): Record<string, unknown> {
  const raw = item as unknown as Record<string, unknown>;
  return slimPick(raw, ROADMAP_LIST_FIELDS) as Record<string, unknown>;
}

/**
 * Slim transform for projects.
 */
export function slimProject(project: KanonProject): Record<string, unknown> {
  return slimPick(project as unknown as Record<string, unknown>, PROJECT_FIELDS) as Record<string, unknown>;
}

/**
 * Slim transform for workspaces.
 * Workspaces are already compact; this just enforces the allowlist.
 */
export function slimWorkspace(workspace: KanonWorkspace): Record<string, unknown> {
  return slimPick(workspace as unknown as Record<string, unknown>, WORKSPACE_FIELDS) as Record<string, unknown>;
}

/**
 * Slim transform for group summaries.
 * Groups are already compact; this just enforces the allowlist.
 */
export function slimGroup(group: GroupSummary): Record<string, unknown> {
  return slimPick(group as unknown as Record<string, unknown>, GROUP_FIELDS) as Record<string, unknown>;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

const SLIM_TRANSFORMS: Record<EntityType, (data: unknown) => unknown> = {
  "issue": (data) => slimIssue(data as KanonIssue),
  "issue-detail": (data) => slimIssueDetail(data as KanonIssue),
  "roadmap": (data) => slimRoadmapItem(data as KanonRoadmapItem),
  "project": (data) => slimProject(data as KanonProject),
  "workspace": (data) => slimWorkspace(data as KanonWorkspace),
  "group": (data) => slimGroup(data as GroupSummary),
};

/**
 * Format a single entity. Returns raw data for "full", slim version for "slim".
 */
export function formatEntity(
  data: unknown,
  entityType: EntityType,
  format: Format = "slim",
): unknown {
  if (format === "full") return data;
  const transform = SLIM_TRANSFORMS[entityType];
  return transform(data);
}

// ─── Pagination + List Formatting ───────────────────────────────────────────

export interface PaginatedResult<T = unknown> {
  items: T[];
  total: number;
  hasMore: boolean;
  hint?: string;
}

/**
 * Paginate and optionally transform a list of items.
 * Slices the full array by offset/limit, then applies slim transforms if format != "full".
 */
export function formatList(
  items: unknown[],
  entityType: EntityType,
  format: Format = "slim",
  limit: number = DEFAULT_LIMIT,
  offset: number = 0,
): PaginatedResult {
  // Clamp limit
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const effectiveOffset = Math.max(0, offset);

  const total = items.length;
  const sliced = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);

  const transformed = format === "full"
    ? sliced
    : sliced.map((item) => SLIM_TRANSFORMS[entityType]!(item));

  const hasMore = effectiveOffset + effectiveLimit < total;

  const result: PaginatedResult = {
    items: transformed,
    total,
    hasMore,
  };

  if (hasMore) {
    result.hint = `Use offset=${effectiveOffset + effectiveLimit} to fetch the next page.`;
  }

  return result;
}
