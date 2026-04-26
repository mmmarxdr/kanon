import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { getEngramClient } from "../../config/engram.js";
import { AppError } from "../../shared/types.js";
import { validateTransition } from "./state-machine.js";
import { createActivityLog } from "../activity/service.js";
import { checkAndAdvanceParent } from "./auto-transition.js";
import { syncRoadmapItemStatus } from "../roadmap/roadmap-sync.js";
import type { IssueState } from "@prisma/client";
import type {
  CreateIssueBody,
  UpdateIssueBody,
  IssueFilterQuery,
} from "./schema.js";
import { ORDERED_STATES } from "../../shared/constants.js";
import { resolveTemplate } from "../../shared/issue-templates.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  getActiveWorkers,
  getActiveWorkersForIssues,
} from "../work-session/service.js";

/**
 * Generate the next issue key for a project using MAX+1 in a transaction.
 */
async function nextIssueKey(
  projectId: string,
  projectKey: string,
): Promise<{ key: string; sequenceNum: number }> {
  // Use a transaction with serializable isolation to prevent race conditions
  return prisma.$transaction(async (tx) => {
    const maxResult = await tx.issue.aggregate({
      where: { projectId },
      _max: { sequenceNum: true },
    });

    const nextNum = (maxResult._max.sequenceNum ?? 0) + 1;
    return {
      key: `${projectKey}-${nextNum}`,
      sequenceNum: nextNum,
    };
  });
}

/**
 * Create a new issue with auto-generated key.
 */
export async function createIssue(
  projectKey: string,
  body: CreateIssueBody,
  memberId: string,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  // Resolve template defaults — user-supplied fields win, then template, then schema defaults
  let resolvedType = body.type ?? "task";
  let resolvedPriority = body.priority ?? "medium";
  let resolvedLabels = body.labels ?? [];
  let resolvedDescription = body.description;

  if (body.templateKey !== undefined) {
    const tmpl = resolveTemplate(body.templateKey);
    if (!tmpl) {
      throw new AppError(
        400,
        "INVALID_TEMPLATE_KEY",
        `Unknown template key: "${body.templateKey}"`,
      );
    }
    resolvedType = body.type ?? tmpl.type;
    resolvedPriority = body.priority ?? tmpl.priority;
    resolvedLabels = body.labels !== undefined && body.labels.length > 0 ? body.labels : tmpl.labels;
    resolvedDescription = body.description ?? tmpl.descriptionTemplate;
  }

  const { key, sequenceNum } = await nextIssueKey(project.id, project.key);

  const issue = await prisma.issue.create({
    data: {
      key,
      sequenceNum,
      title: body.title,
      description: resolvedDescription,
      type: resolvedType,
      priority: resolvedPriority,
      state: body.state,
      labels: resolvedLabels,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      groupKey: body.groupKey,
      projectId: project.id,
      assigneeId: body.assigneeId,
      cycleId: body.cycleId,
      parentId: body.parentId,
    },
  });

  // Auto-create activity log for issue creation
  await createActivityLog({
    issueId: issue.id,
    memberId,
    action: "created",
    details: { title: issue.title, type: issue.type, priority: issue.priority },
  });

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "issue.created",
      workspaceId: project.workspaceId,
      actorId: memberId,
      payload: { issueKey: issue.key, issueId: issue.id, projectKey: project.key, title: issue.title },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return issue;
}

/**
 * List issues for a project with optional filters.
 */
export async function listIssues(
  projectKey: string,
  filters: IssueFilterQuery,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const where: Prisma.IssueWhereInput = {
    projectId: project.id,
  };

  if (filters.state) where.state = filters.state;
  if (filters.type) where.type = filters.type;
  if (filters.priority) where.priority = filters.priority;
  // snake_case query params → camelCase Prisma fields (see issue/schema.ts)
  if (filters.assignee_id) where.assigneeId = filters.assignee_id;
  if (filters.cycle_id) where.cycleId = filters.cycle_id;
  if (filters.label) where.labels = { has: filters.label };
  if (filters.parent_only) where.parentId = null;
  if (filters.group_key) where.groupKey = filters.group_key;

  const issues = await prisma.issue.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      assignee: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  // Batch-fetch active workers to avoid N+1 queries
  const issueIds = issues.map((i) => i.id);
  const workersMap = await getActiveWorkersForIssues(issueIds);

  return issues.map((issue) => ({
    ...issue,
    activeWorkers: workersMap.get(issue.id) ?? [],
  }));
}

/**
 * List issue groups for a project.
 * Uses Prisma groupBy for count/updatedAt, then fetches representative titles.
 */
export async function listIssueGroups(projectKey: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  // Step 1: Aggregate with groupBy — get count, max updatedAt per groupKey
  const groups = await prisma.issue.groupBy({
    by: ["groupKey"],
    where: {
      projectId: project.id,
      groupKey: { not: null },
    },
    _count: { id: true },
    _max: { updatedAt: true },
  });

  if (groups.length === 0) return [];

  // Step 2: For each group, find the latest state and a representative title.
  // Use a single query that fetches one issue per groupKey (the most recently updated).
  const groupKeys = groups.map((g) => g.groupKey!);

  // Get the most recently updated issue per group for title + state
  // Using a single query with DISTINCT ON (PostgreSQL)
  const representatives = await prisma.$queryRaw<
    Array<{ group_key: string; title: string; state: string }>
  >`
    SELECT DISTINCT ON (group_key) group_key, title, state
    FROM issues
    WHERE project_id = ${project.id}::uuid
      AND group_key = ANY(${groupKeys})
    ORDER BY group_key, updated_at DESC
  `;

  // Build a lookup map
  const repMap = new Map(
    representatives.map((r) => [r.group_key, { title: r.title, state: r.state }]),
  );

  // Step 3: Merge results
  return groups.map((g) => {
    const rep = repMap.get(g.groupKey!);
    return {
      groupKey: g.groupKey!,
      count: g._count.id,
      latestState: (rep?.state ?? "backlog") as IssueState,
      title: rep?.title ?? g.groupKey!,
      updatedAt: g._max.updatedAt!.toISOString(),
    };
  });
}

/**
 * Get a single issue by key.
 */
export async function getIssue(key: string) {
  const issue = await prisma.issue.findUnique({
    where: { key },
    include: {
      assignee: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
      project: {
        select: { id: true, key: true, name: true },
      },
      children: {
        select: { id: true, key: true, title: true, state: true, labels: true },
      },
      blocks: {
        include: {
          target: { select: { id: true, key: true, title: true, state: true } },
        },
      },
      blockedBy: {
        include: {
          source: { select: { id: true, key: true, title: true, state: true } },
        },
      },
    },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${key}" not found`);
  }

  const activeWorkers = await getActiveWorkers(issue.id);

  return { ...issue, activeWorkers };
}

/**
 * Update an issue by key.
 */
export async function updateIssue(
  key: string,
  body: UpdateIssueBody,
  memberId: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { key },
    include: { project: { select: { workspaceId: true, key: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${key}" not found`);
  }

  const data: Prisma.IssueUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.type !== undefined) data.type = body.type;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.labels !== undefined) data.labels = body.labels;
  if (body.groupKey !== undefined) data.groupKey = body.groupKey;
  if (body.dueDate !== undefined) {
    data.dueDate = body.dueDate ? new Date(body.dueDate) : null;
  }

  // Handle relation fields
  if (body.assigneeId !== undefined) {
    if (body.assigneeId === null) {
      data.assignee = { disconnect: true };
    } else {
      data.assignee = { connect: { id: body.assigneeId } };
    }

    // Track assignment change
    await createActivityLog({
      issueId: issue.id,
      memberId,
      action: "assigned",
      details: {
        from: issue.assigneeId,
        to: body.assigneeId,
        source: "api",
      },
    });
  }
  if (body.cycleId !== undefined) {
    if (body.cycleId === null) {
      data.cycle = { disconnect: true };
    } else {
      data.cycle = { connect: { id: body.cycleId } };
    }
  }
  if (body.parentId !== undefined) {
    if (body.parentId === null) {
      data.parent = { disconnect: true };
    } else {
      data.parent = { connect: { id: body.parentId } };
    }
  }
  if (body.roadmapItemId !== undefined) {
    if (body.roadmapItemId === null) {
      data.roadmapItem = { disconnect: true };
    } else {
      data.roadmapItem = { connect: { id: body.roadmapItemId } };
    }
  }

  const updated = await prisma.issue.update({
    where: { key },
    data,
  });

  // Log field edit activity
  await createActivityLog({
    issueId: issue.id,
    memberId,
    action: "edited",
    details: { fields: Object.keys(body) },
  });

  // Emit domain events (fire-and-forget)
  try {
    eventBus.emit({
      type: "issue.updated",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: { issueKey: key, issueId: issue.id, fields: Object.keys(body) },
    });

    // Emit a specific assignment event if assignee changed
    if (body.assigneeId !== undefined) {
      eventBus.emit({
        type: "issue.assigned",
        workspaceId: issue.project.workspaceId,
        actorId: memberId,
        payload: { issueKey: key, issueId: issue.id, from: issue.assigneeId, to: body.assigneeId },
      });
    }
  } catch {
    // Never let event emission break the mutation
  }

  return updated;
}

/**
 * Transition an issue to a new state.
 */
export async function transitionIssue(
  key: string,
  toState: string,
  memberId: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { key },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${key}" not found`);
  }

  const result = validateTransition(issue.state, toState as any);
  if (!result.allowed) {
    throw new AppError(400, "INVALID_TRANSITION", result.reason);
  }

  const updated = await prisma.issue.update({
    where: { key },
    data: { state: toState as any },
  });

  // Create activity log for state change
  await createActivityLog({
    issueId: issue.id,
    memberId,
    action: "state_changed",
    details: {
      from: issue.state,
      to: toState,
      regression: result.isRegression,
    },
  });

  // Auto-advance parent if all children have moved past parent's column
  await checkAndAdvanceParent(prisma, updated, memberId);

  // Sync roadmap item status based on aggregate issue states
  await syncRoadmapItemStatus(prisma, updated.id);

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "issue.transitioned",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: { issueKey: key, issueId: issue.id, from: issue.state, to: toState },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return updated;
}

/**
 * Maximum number of issues allowed in a single batch transition.
 * Guards against accidentally transitioning very large groups.
 */
const MAX_GROUP_TRANSITION_SIZE = 100;

/**
 * Transition ALL issues in a group to a new state in a single DB transaction.
 * Used when a group card is dragged across columns on the board.
 */
export async function transitionGroup(
  projectKey: string,
  groupKey: string,
  toState: string,
  memberId: string,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  // Find all issues in the group
  const issues = await prisma.issue.findMany({
    where: {
      projectId: project.id,
      groupKey,
    },
    select: { id: true, key: true, state: true, parentId: true, roadmapItemId: true },
  });

  if (issues.length === 0) {
    throw new AppError(
      404,
      "GROUP_NOT_FOUND",
      `No issues found with groupKey "${groupKey}" in project "${projectKey}"`,
    );
  }

  if (issues.length > MAX_GROUP_TRANSITION_SIZE) {
    throw new AppError(
      400,
      "GROUP_TOO_LARGE",
      `Group "${groupKey}" has ${issues.length} issues, exceeding the limit of ${MAX_GROUP_TRANSITION_SIZE}. Transition issues individually.`,
    );
  }

  // Validate that the target state is valid
  const targetState = toState as IssueState;
  if (!ORDERED_STATES.includes(targetState)) {
    throw new AppError(400, "INVALID_STATE", `Invalid state: "${toState}"`);
  }

  // Filter out issues already in the target state
  const issuesToTransition = issues.filter((i) => i.state !== targetState);

  if (issuesToTransition.length === 0) {
    return { count: 0, groupKey, state: targetState };
  }

  // Validate each transition (some may be same-state, which we already filtered)
  for (const issue of issuesToTransition) {
    const result = validateTransition(issue.state, targetState);
    if (!result.allowed) {
      throw new AppError(
        400,
        "INVALID_TRANSITION",
        `Cannot transition issue "${issue.key}" from "${issue.state}" to "${targetState}": ${result.reason}`,
      );
    }
  }

  // Execute batch update + activity logs in a single transaction
  const result = await prisma.$transaction(async (tx) => {
    // Batch update all issues in one query
    const updateResult = await tx.issue.updateMany({
      where: {
        id: { in: issuesToTransition.map((i) => i.id) },
      },
      data: { state: targetState },
    });

    // Create activity logs for each transitioned issue
    await tx.activityLog.createMany({
      data: issuesToTransition.map((issue) => ({
        issueId: issue.id,
        memberId,
        action: "state_changed" as const,
        details: {
          from: issue.state,
          to: targetState,
          batchTransition: true,
          groupKey,
        },
      })),
    });

    return updateResult;
  });

  // Auto-advance parents for any issues that had parent relationships
  const issuesWithParents = issuesToTransition.filter((i) => i.parentId);
  const uniqueParentIds = [...new Set(issuesWithParents.map((i) => i.parentId!))];
  for (const _parentId of uniqueParentIds) {
    // Pass a representative issue to trigger parent check
    const rep = issuesWithParents.find((i) => i.parentId === _parentId)!;
    await checkAndAdvanceParent(prisma, { parentId: rep.parentId }, memberId);
  }

  // Sync roadmap item status — deduplicate roadmapItemIds across the batch
  const uniqueRoadmapItemIds = [
    ...new Set(
      issuesToTransition
        .map((i) => i.roadmapItemId)
        .filter((id): id is string => id !== null),
    ),
  ];
  for (const roadmapItemId of uniqueRoadmapItemIds) {
    // Pick a representative issue to pass to syncRoadmapItemStatus
    const rep = issuesToTransition.find((i) => i.roadmapItemId === roadmapItemId)!;
    await syncRoadmapItemStatus(prisma, rep.id);
  }

  return { count: result.count, groupKey, state: targetState };
}

// ─── Issue Context (Engram Session Summaries) ──────────────────────────────

interface SessionContext {
  id: number;
  date: string;
  goal: string;
  discoveries: string[];
  accomplished: string[];
  nextSteps: string[];
  relevantFiles: string[];
}

/**
 * Extract bullet items from a markdown section heading.
 */
function extractSection(content: string, heading: string): string[] {
  const pattern = new RegExp(
    `##\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = content.match(pattern);
  if (!match) return [];

  return match[1]!
    .split("\n")
    .map((line) => line.replace(/^[\s]*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * Extract the goal text from a session summary.
 */
function extractGoal(content: string): string {
  const pattern = /##\s+Goal[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i;
  const match = content.match(pattern);
  if (!match) return content.slice(0, 120).trim();

  return match[1]!
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ")
    .slice(0, 300);
}

/**
 * Parse session summary observations into structured context.
 */
function parseSessionSummaries(
  results: Array<{ id: number; content: string; created_at: string }>,
): SessionContext[] {
  return results.map((obs) => ({
    id: obs.id,
    date: obs.created_at,
    goal: extractGoal(obs.content),
    discoveries: extractSection(obs.content, "Discoveries"),
    accomplished: extractSection(obs.content, "Accomplished"),
    nextSteps: extractSection(obs.content, "Next Steps"),
    relevantFiles: extractSection(obs.content, "Relevant Files"),
  }));
}

/**
 * Get AI session context for an issue by searching Engram for session
 * summaries that mention the issue key.
 *
 * Returns empty results on any failure (Engram offline, timeout, etc.).
 */
export async function getIssueContext(
  issueKey: string,
  logger?: { warn: (obj: unknown, msg: string) => void },
): Promise<{ sessions: SessionContext[]; sessionCount: number }> {
  const client = getEngramClient();
  if (!client) {
    return { sessions: [], sessionCount: 0 };
  }

  try {
    const results = await client.search(issueKey, {
      project: "kanon",
      type: "session_summary",
      limit: 5,
    });
    const sessions = parseSessionSummaries(results ?? []);
    return { sessions, sessionCount: sessions.length };
  } catch (err) {
    if (logger) {
      logger.warn(
        { err, issueKey },
        "Failed to fetch issue context from Engram",
      );
    }
    return { sessions: [], sessionCount: 0 };
  }
}
