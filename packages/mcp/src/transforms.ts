// ─── Response Transform & Pagination Layer ─────────────────────────────────
// Reduces token usage by stripping unnecessary fields from API responses.
// Uses allowlist approach: only explicitly listed fields survive in "slim" mode.

import type {
  KanonIssue,
  KanonRoadmapItem,
  KanonProject,
  KanonWorkspace,
  GroupSummary,
  KanonCycle,
  KanonCycleDetail,
} from "./kanon-client.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type Format = "slim" | "full" | "compact";
export type EntityType =
  | "issue" | "issue-detail" | "issue-write"
  | "roadmap" | "roadmap-write"
  | "project" | "project-write"
  | "workspace"
  | "group"
  | "comment-write"
  | "cycle" | "cycle-detail";

// ─── Field Allowlists ───────────────────────────────────────────────────────

export const ISSUE_LIST_FIELDS = [
  "key", "title", "state", "type", "priority", "labels", "groupKey", "dueDate", "activeWorkers", "cycle",
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
  "key", "title", "state", "type", "priority", "cycle",
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
  // Format activeWorkers into human-readable strings
  const activeWorkers = raw["activeWorkers"];
  if (Array.isArray(activeWorkers) && activeWorkers.length > 0) {
    base["activeWorkers"] = (activeWorkers as Array<Record<string, unknown>>).map((w) => {
      const elapsed = formatWorkerElapsed(w["startedAt"] as string);
      return `${w["username"]} (since ${elapsed}, via ${w["source"]})`;
    });
  } else {
    // Omit if no active workers to save tokens
    delete base["activeWorkers"];
  }
  return base as Record<string, unknown>;
}

/**
 * Slim transform for a single issue detail view.
 * Includes description, project key, and slimmed children.
 */
export function slimIssueDetail(issue: KanonIssue): Record<string, unknown> {
  const base = slimIssue(issue); // activeWorkers already handled by slimIssue
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

// ─── Cycle Transforms ──────────────────────────────────────────────────────

export const CYCLE_LIST_FIELDS = [
  "id", "name", "state", "startDate", "endDate", "velocity",
] as const;

/**
 * Slim transform for cycles in list context.
 * Adds derived `isActive` boolean to make state clear without parsing dates.
 */
export function slimCycle(cycle: KanonCycle): Record<string, unknown> {
  const base = slimPick(cycle as unknown as Record<string, unknown>, CYCLE_LIST_FIELDS) as Record<string, unknown>;
  base["isActive"] = cycle.state === "active";
  return base;
}

/**
 * Slim transform for cycle detail. Includes burnup arrays, scope, risks.
 * Issues are slimmed to {key, title, state}. Scope events kept compact.
 */
export function slimCycleDetail(cycle: KanonCycleDetail): Record<string, unknown> {
  const base = slimCycle(cycle) as Record<string, unknown>;
  base["goal"] = cycle.goal ?? null;
  base["dayIndex"] = cycle.dayIndex;
  base["days"] = cycle.days;
  base["scope"] = cycle.scope;
  base["completed"] = cycle.completed;
  base["scopeAdded"] = cycle.scopeAdded;
  base["scopeRemoved"] = cycle.scopeRemoved;
  base["burnup"] = cycle.burnup;
  base["scopeLine"] = cycle.scopeLine;
  base["risks"] = cycle.risks ?? [];
  base["issues"] = (cycle.issues ?? []).map((i) => ({
    key: i.key,
    title: i.title,
    state: i.state,
  }));
  base["scopeEvents"] = (cycle.scopeEvents ?? []).map((e) => ({
    type: e.type,
    issueId: e.issueId,
    reason: e.reason,
    createdAt: e.createdAt,
  }));
  return base;
}

/**
 * Format a cycle (list context). Wraps slim/full/compact formatting.
 */
export function formatCycle(cycle: KanonCycle, format: Format = "slim"): unknown {
  if (format === "full") return cycle;
  return slimCycle(cycle);
}

/**
 * Format a cycle detail (single-entity full inspection).
 */
export function formatCycleDetail(cycle: KanonCycleDetail, format: Format = "slim"): unknown {
  if (format === "full") return cycle;
  return slimCycleDetail(cycle);
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Format elapsed time for active workers.
 */
function formatWorkerElapsed(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
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
  "cycle": (data) => slimCycle(data as KanonCycle),
  "cycle-detail": (data) => slimCycleDetail(data as KanonCycleDetail),
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

// ─── Ack Tier (minimal write-tool acknowledgement) ─────────────────────────

/**
 * Identity-only acknowledgement tier for write tools. Each kind picks the
 * minimal identity surface so callers can reference the entity in a follow-up
 * call without paying for the full payload. Pass `format: "full"` on the tool
 * to opt out and receive the legacy entity shape.
 */
export type AckKind =
  | "issue"
  | "cycle"
  | "cycle-attach"
  | "cycle-close"
  | "roadmap-item"
  | "work-session"
  | "work-session-stop"
  | "project"
  | "issue-dependency"
  | "batch-transition"
  | "comment";

/**
 * Format an ack payload for a write tool. The returned object always has
 * `ok: true` as the first key. For composite payloads (`cycle-attach`,
 * `cycle-close`) the supplied fields pass through verbatim — the caller is
 * responsible for assembling them. For single-entity kinds we read identity
 * fields off the entity by name.
 */
export function formatAck(
  payload: unknown,
  kind: AckKind,
): Record<string, unknown> {
  const src = (payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "issue":
      return { ok: true, id: src["id"], key: src["key"] };
    case "cycle":
      return {
        ok: true,
        id: src["id"],
        name: src["name"],
        state: src["state"],
      };
    case "roadmap-item":
      return {
        ok: true,
        id: src["id"],
        title: src["title"],
        horizon: src["horizon"],
      };
    case "work-session":
      return {
        ok: true,
        id: src["id"],
        issueId: src["issueId"],
        startedAt: src["startedAt"],
      };
    case "project":
      return {
        ok: true,
        id: src["id"],
        key: src["key"],
        name: src["name"],
      };
    case "cycle-attach":
      return {
        ok: true,
        cycleId: src["cycleId"],
        added: src["added"],
        removed: src["removed"],
        scope: src["scope"],
        completed: src["completed"],
      };
    case "cycle-close":
      return {
        ok: true,
        cycleId: src["cycleId"],
        disposition: src["disposition"],
        movedIssueKeys: src["movedIssueKeys"],
      };
    case "issue-dependency":
      return {
        ok: true,
        id: src["id"],
        projectId: src["projectId"],
      };
    case "batch-transition":
      return {
        ok: true,
        count: src["count"],
        keys: src["keys"],
      };
    case "comment":
      return {
        ok: true,
        id: src["id"],
        issueKey: src["issueKey"],
      };
    case "work-session-stop":
      return {
        ok: true,
        deleted: src["deleted"],
        issueKey: src["issueKey"],
      };
  }
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
