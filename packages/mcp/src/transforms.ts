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

export type Format = "slim" | "full" | "compact";
export type EntityType =
  | "issue" | "issue-detail" | "issue-write"
  | "roadmap" | "roadmap-write"
  | "project" | "project-write"
  | "workspace"
  | "group"
  | "comment-write";

// ─── Field Allowlists ───────────────────────────────────────────────────────

export const ISSUE_LIST_FIELDS = [
  "key", "title", "state", "type", "priority", "labels", "groupKey", "dueDate",
] as const;

export const ISSUE_DETAIL_FIELDS = [
  ...ISSUE_LIST_FIELDS, "description", "project", "children",
] as const;

export const ROADMAP_LIST_FIELDS = [
  "id", "title", "horizon", "status", "effort", "impact", "labels", "promoted", "targetDate",
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

// ─── Write-Slim Field Allowlists ───────────────────────────────────────────

export const ISSUE_WRITE_FIELDS = [
  "key", "title", "state", "type", "priority",
] as const;

export const ROADMAP_WRITE_FIELDS = [
  "id", "title", "horizon", "status", "promoted",
] as const;

export const PROJECT_WRITE_FIELDS = [
  "key", "name",
] as const;

export const COMMENT_WRITE_FIELDS = [
  "id", "issueKey", "source",
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
  "issue-write": (data) => slimPick(data as Record<string, unknown>, ISSUE_WRITE_FIELDS) as Record<string, unknown>,
  "roadmap": (data) => slimRoadmapItem(data as KanonRoadmapItem),
  "roadmap-write": (data) => slimPick(data as Record<string, unknown>, ROADMAP_WRITE_FIELDS) as Record<string, unknown>,
  "project": (data) => slimProject(data as KanonProject),
  "project-write": (data) => slimPick(data as Record<string, unknown>, PROJECT_WRITE_FIELDS) as Record<string, unknown>,
  "workspace": (data) => slimWorkspace(data as KanonWorkspace),
  "group": (data) => slimGroup(data as GroupSummary),
  "comment-write": (data) => slimPick(data as Record<string, unknown>, COMMENT_WRITE_FIELDS) as Record<string, unknown>,
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

// ─── Compact Table Rendering ───────────────────────────────────────────────

/**
 * Escape pipe characters in a cell value so they don't break markdown tables.
 */
function escapeCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  return str.replace(/\|/g, "\\|");
}

/**
 * Render an array of objects as a pipe-delimited markdown table.
 * Headers are derived from the keys of the first item.
 * Pipe characters in values are escaped as `\|`.
 */
export function toCompactTable(items: Record<string, unknown>[]): string {
  if (items.length === 0) return "";

  const headers = Object.keys(items[0]!);
  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `|${headers.map(() => "---").join("|")}|`;
  const dataRows = items.map(
    (item) => `| ${headers.map((h) => escapeCell(item[h])).join(" | ")} |`,
  );

  return [headerRow, separator, ...dataRows].join("\n");
}

// ─── Pagination + List Formatting ───────────────────────────────────────────

export interface CompactResult {
  table: string;
  total: number;
  hasMore: boolean;
  hint?: string;
}

export interface PaginatedResult<T = unknown> {
  items: T[];
  total: number;
  hasMore: boolean;
  hint?: string;
}

/**
 * Paginate and optionally transform a list of items.
 * Slices the full array by offset/limit, then applies slim transforms if format != "full".
 * For "compact" format, applies slim transform then renders as a markdown table.
 */
export function formatList(
  items: unknown[],
  entityType: EntityType,
  format: Format = "slim",
  limit: number = DEFAULT_LIMIT,
  offset: number = 0,
): PaginatedResult | CompactResult {
  // Clamp limit
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const effectiveOffset = Math.max(0, offset);

  const total = items.length;
  const sliced = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);
  const hasMore = effectiveOffset + effectiveLimit < total;
  const hint = hasMore
    ? `Use offset=${effectiveOffset + effectiveLimit} to fetch the next page.`
    : undefined;

  if (format === "compact") {
    const slimmed = sliced.map((item) => SLIM_TRANSFORMS[entityType]!(item)) as Record<string, unknown>[];
    const table = toCompactTable(slimmed);
    const result: CompactResult = { table, total, hasMore };
    if (hint) result.hint = hint;
    return result;
  }

  const transformed = format === "full"
    ? sliced
    : sliced.map((item) => SLIM_TRANSFORMS[entityType]!(item));

  const result: PaginatedResult = { items: transformed, total, hasMore };
  if (hint) result.hint = hint;
  return result;
}
