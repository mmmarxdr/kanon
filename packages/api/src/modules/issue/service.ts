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
  BatchTransitionByKeysBody,
} from "./schema.js";
import { ORDERED_STATES } from "../../shared/constants.js";
import { resolveTemplate } from "../../shared/issue-templates.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  getActiveWorkers,
  getActiveWorkersForIssues,
} from "../work-session/service.js";
import {
  recordCycleScopeEvent,
  validateCycleBelongsToProject,
  dayIndex,
} from "../cycle/service.js";
import { parseAndUpsertMentions } from "../mentions/service.js";
import { autoSubscribe, getStatus as getSubscriptionStatus } from "../issue-subscription/service.js";

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
 *
 * @param projectId - Gate-resolved project UUID (KAN-16 security fix).
 *   Callers downstream of requireProjectRole pass request.projectId so
 *   issue creation targets the SAME project the gate authorized.
 *   Internal callers (e.g. roadmap promoteToIssue) resolve the id themselves
 *   before calling this function.
 */
export async function createIssue(
  projectId: string,
  body: CreateIssueBody,
  memberId: string,
  via?: string | null,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
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

  // Cross-project guard for cycleId — runs BEFORE nextIssueKey so a rejection
  // does not burn a sequence number. Also returns the loaded cycle so we can
  // compute `day` once for the scope event below without a second findUnique.
  let validatedCycle:
    | {
        id: string;
        projectId: string;
        startDate: Date;
        endDate: Date;
      }
    | null = null;
  if (body.cycleId !== undefined && body.cycleId !== null) {
    validatedCycle = await validateCycleBelongsToProject(
      body.cycleId,
      project.id,
    );
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
    via,
  });

  // Record CycleScopeEvent if the new issue was placed in a cycle. Best-effort —
  // a failure here must not orphan the already-created issue.
  if (validatedCycle) {
    try {
      await recordCycleScopeEvent({
        cycleId: validatedCycle.id,
        kind: "add",
        issueKey: issue.key,
        authorId: memberId,
        day: dayIndex(validatedCycle.startDate, validatedCycle.endDate),
      });
    } catch {
      // Scope event is best-effort; never block issue creation
    }
  }

  // Auto-subscribe creator (best-effort, D9)
  void autoSubscribe(issue.id, memberId, "creator");

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "issue.created",
      workspaceId: project.workspaceId,
      actorId: memberId,
      payload: { issueKey: issue.key, issueId: issue.id, projectKey: project.key, title: issue.title },
      via,
    });
  } catch {
    // Never let event emission break the mutation
  }

  // Parse @mentions in description — best-effort; emit mention.created per new mention (D1 delta).
  // workspaceId comes from project (issue has no direct workspaceId field)
  if (issue.description) {
    try {
      const { created } = await parseAndUpsertMentions({
        workspaceId: project.workspaceId,
        issueId: issue.id,
        commentId: null,
        body: issue.description,
        authorMemberId: memberId,
      });
      for (const entry of created) {
        try {
          eventBus.emit({
            type: "mention.created",
            workspaceId: project.workspaceId,
            actorId: memberId,
            payload: {
              mentionId: entry.mentionId,
              issueId: issue.id,
              issueKey: issue.key,
              issueTitle: issue.title,
              commentId: null,
              mentionedMemberId: entry.mentionedMemberId,
              mentionedByMemberId: memberId,
              context: entry.context,
            },
            via: via ?? null,
          });
        } catch {
          // Fire-and-forget
        }
      }
    } catch {
      // Mention parsing failure is non-fatal — continue
    }
  }

  return issue;
}

/**
 * List issues for a project with optional filters.
 *
 * @param projectId - Gate-resolved project UUID (KAN-16 security fix).
 */
export async function listIssues(
  projectId: string,
  filters: IssueFilterQuery,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
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

  // CSV keys filter — split, trim, drop empties; cap at 100. Empty after
  // trim (or absent) → no-op. The projectId guard above already prevents
  // cross-project leakage, so non-existent or foreign keys are silently
  // omitted from results (Prisma returns the intersection only).
  if (filters.keys !== undefined) {
    const parsed = filters.keys
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    if (parsed.length > 100) {
      throw new AppError(
        400,
        "KEY_LIMIT_EXCEEDED",
        `Maximum 100 keys per request (received ${parsed.length})`,
      );
    }
    if (parsed.length > 0) {
      where.key = { in: parsed };
    }
  }

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
 *
 * @param projectId - Gate-resolved project UUID (KAN-16 security fix).
 */
export async function listIssueGroups(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
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
/**
 * Fetch full issue detail by key.
 *
 * When `memberId` is provided the response includes `subscribed: boolean`
 * so the web client can reflect subscription state on the issue-detail page
 * without a second round-trip (KAN-38).
 */
export async function getIssue(key: string, memberId?: string) {
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
      cycle: {
        select: { id: true, name: true },
      },
    },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${key}" not found`);
  }

  const [activeWorkers, subscriptionStatus] = await Promise.all([
    getActiveWorkers(issue.id),
    memberId
      ? getSubscriptionStatus(issue.id, memberId).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    ...issue,
    activeWorkers,
    ...(subscriptionStatus !== null ? { subscribed: subscriptionStatus.subscribed } : {}),
  };
}

/**
 * Update an issue by key.
 */
export async function updateIssue(
  key: string,
  body: UpdateIssueBody,
  memberId: string,
  via?: string | null,
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
      via,
    });
    // Note: auto-subscribe for the new assignee is called AFTER prisma.issue.update
    // (see below) so that a failed update does not leave a phantom subscription row.
    // Consistent with startWork auto-assign ordering (Fix 5 / KAN-28).
  }
  // Track cycleId change so we can emit scope events AFTER update.
  const prevCycleId: string | null = issue.cycleId;
  let cycleChanged = false;
  let validatedNewCycle:
    | {
        id: string;
        projectId: string;
        startDate: Date;
        endDate: Date;
      }
    | null = null;
  if (body.cycleId !== undefined) {
    if (body.cycleId === null) {
      data.cycle = { disconnect: true };
      cycleChanged = prevCycleId !== null;
    } else {
      // Cross-project guard runs BEFORE prisma.issue.update, so a reject
      // leaves the issue untouched. Only validate when value actually
      // differs (no-op writes don't need a DB roundtrip).
      if (body.cycleId !== prevCycleId) {
        validatedNewCycle = await validateCycleBelongsToProject(
          body.cycleId,
          issue.projectId,
        );
      }
      data.cycle = { connect: { id: body.cycleId } };
      cycleChanged = body.cycleId !== prevCycleId;
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

  // Auto-subscribe new assignee AFTER successful update (Fix 5 / KAN-28).
  // Placement here ensures a failed update leaves no phantom subscription row,
  // consistent with startWork auto-assign ordering (D9, best-effort).
  if (body.assigneeId !== undefined && body.assigneeId !== null) {
    void autoSubscribe(issue.id, body.assigneeId, "assignee");
  }

  // Record CycleScopeEvent rows for cycle membership changes. Best-effort —
  // failures must not break the update contract.
  if (cycleChanged) {
    try {
      if (prevCycleId !== null) {
        await recordCycleScopeEvent({
          cycleId: prevCycleId,
          kind: "remove",
          issueKey: key,
          authorId: memberId,
        });
      }
      if (validatedNewCycle !== null) {
        await recordCycleScopeEvent({
          cycleId: validatedNewCycle.id,
          kind: "add",
          issueKey: key,
          authorId: memberId,
          day: dayIndex(
            validatedNewCycle.startDate,
            validatedNewCycle.endDate,
          ),
        });
      }
    } catch {
      // Scope event is best-effort
    }
  }

  // Log field edit activity
  await createActivityLog({
    issueId: issue.id,
    memberId,
    action: "edited",
    details: { fields: Object.keys(body) },
    via,
  });

  // Emit domain events (fire-and-forget)
  try {
    eventBus.emit({
      type: "issue.updated",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: { issueKey: key, issueId: issue.id, fields: Object.keys(body) },
      via,
    });

    // Emit a specific assignment event if assignee changed
    if (body.assigneeId !== undefined) {
      eventBus.emit({
        type: "issue.assigned",
        workspaceId: issue.project.workspaceId,
        actorId: memberId,
        payload: { issueKey: key, issueId: issue.id, issueTitle: issue.title, from: issue.assigneeId, to: body.assigneeId },
        via,
      });
    }
  } catch {
    // Never let event emission break the mutation
  }

  // Parse @mentions in description if it was part of this update — best-effort
  // Emit mention.created per genuinely new mention (D1 delta).
  // workspaceId comes from issue.project (issue has no direct workspaceId field)
  if (body.description !== undefined) {
    try {
      const { created } = await parseAndUpsertMentions({
        workspaceId: issue.project.workspaceId,
        issueId: issue.id,
        commentId: null,
        body: body.description ?? "",
        authorMemberId: memberId,
      });
      for (const entry of created) {
        try {
          eventBus.emit({
            type: "mention.created",
            workspaceId: issue.project.workspaceId,
            actorId: memberId,
            payload: {
              mentionId: entry.mentionId,
              issueId: issue.id,
              issueKey: key,
              // updated.title reflects any title change in this update call
              issueTitle: (body.title !== undefined ? body.title : issue.title) ?? key,
              commentId: null,
              mentionedMemberId: entry.mentionedMemberId,
              mentionedByMemberId: memberId,
              context: entry.context,
            },
            via: via ?? null,
          });
        } catch {
          // Fire-and-forget
        }
      }
    } catch {
      // Mention parsing failure is non-fatal — continue
    }
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
  via?: string | null,
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

  // KAN-35 completion-timestamp contract: set completedAt when entering done, clear on any other transition.
  const updated = await prisma.issue.update({
    where: { key },
    data: {
      state: toState as any,
      completedAt: toState === "done" ? new Date() : null,
    },
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
    via,
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
      via,
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
  projectId: string,
  groupKey: string,
  toState: string,
  memberId: string,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
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
      `No issues found with groupKey "${groupKey}" in project "${project.key}"`,
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
    // Batch update all issues in one query.
    // KAN-35 completion-timestamp contract: set completedAt when entering done, clear on any other transition.
    // Single updateMany is correct here — transitionGroup enforces one targetState for the whole batch.
    const updateResult = await tx.issue.updateMany({
      where: {
        id: { in: issuesToTransition.map((i) => i.id) },
      },
      data: {
        state: targetState,
        completedAt: targetState === "done" ? new Date() : null,
      },
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

/**
 * Batch transition issues identified by keys (project-scoped, all-or-nothing).
 *
 * Pre-validation (BEFORE opening tx, no partial DB writes possible):
 *   1. Project exists.
 *   2. Every input key resolves to an issue.
 *   3. Every resolved issue belongs to the project (cross-project ⇒ reject).
 *   4. Every per-issue state transition is allowed by the state-machine.
 *
 * On any pre-validation failure, no Prisma write occurs. Mirrors the
 * `transitionGroup` pre-validate-then-tx pattern for consistency.
 */
export async function batchTransitionByKeys(
  projectId: string,
  body: BatchTransitionByKeysBody,
  memberId: string,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
    );
  }

  const targetState = body.to_state as IssueState;
  if (!ORDERED_STATES.includes(targetState)) {
    throw new AppError(400, "INVALID_STATE", `Invalid state: "${body.to_state}"`);
  }

  // Single SELECT covering existence + cross-project + state-machine input.
  const issues = await prisma.issue.findMany({
    where: { key: { in: body.keys } },
    select: {
      id: true,
      key: true,
      state: true,
      projectId: true,
      parentId: true,
      roadmapItemId: true,
    },
  });

  // Existence + cross-project guard (mirror cycle/service.attachIssues semantics).
  const foundKeySet = new Set(issues.map((i) => i.key));
  const missingKeys = body.keys.filter((k) => !foundKeySet.has(k));
  const crossProjectKeys = issues
    .filter((i) => i.projectId !== project.id)
    .map((i) => i.key);
  const offendingKeys = [...new Set([...missingKeys, ...crossProjectKeys])];
  if (offendingKeys.length > 0) {
    throw new AppError(
      400,
      "CROSS_PROJECT_ISSUE",
      `The following issue keys do not belong to project "${project.key}": ${offendingKeys.join(", ")}`,
    );
  }

  // Filter out same-state no-ops, validate the rest.
  const issuesToTransition = issues.filter((i) => i.state !== targetState);
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

  if (issuesToTransition.length === 0) {
    return {
      count: 0,
      keys: body.keys,
      state: targetState,
    };
  }

  // All-or-nothing transaction: bulk update + activity logs.
  const result = await prisma.$transaction(async (tx) => {
    // KAN-35 completion-timestamp contract: set completedAt when entering done, clear on any other transition.
    // Single updateMany is correct here — batchTransitionByKeys enforces one targetState for the whole batch.
    const updateResult = await tx.issue.updateMany({
      where: { id: { in: issuesToTransition.map((i) => i.id) } },
      data: {
        state: targetState,
        completedAt: targetState === "done" ? new Date() : null,
      },
    });

    await tx.activityLog.createMany({
      data: issuesToTransition.map((issue) => ({
        issueId: issue.id,
        memberId,
        action: "state_changed" as const,
        details: {
          from: issue.state,
          to: targetState,
          batchTransition: true,
          mode: "keys",
        },
      })),
    });

    return updateResult;
  });

  // Auto-advance parents + sync roadmap items (mirrors transitionGroup).
  const issuesWithParents = issuesToTransition.filter((i) => i.parentId);
  const uniqueParentIds = [
    ...new Set(issuesWithParents.map((i) => i.parentId!)),
  ];
  for (const _parentId of uniqueParentIds) {
    const rep = issuesWithParents.find((i) => i.parentId === _parentId)!;
    await checkAndAdvanceParent(prisma, { parentId: rep.parentId }, memberId);
  }

  const uniqueRoadmapItemIds = [
    ...new Set(
      issuesToTransition
        .map((i) => i.roadmapItemId)
        .filter((id): id is string => id !== null),
    ),
  ];
  for (const roadmapItemId of uniqueRoadmapItemIds) {
    const rep = issuesToTransition.find((i) => i.roadmapItemId === roadmapItemId)!;
    await syncRoadmapItemStatus(prisma, rep.id);
  }

  // Emit per-issue issue.transitioned events for SSE consumers (fire-and-forget).
  // These carry _skipSubscribedActivity=true because the single issue.batch_transitioned
  // event below handles the fan-out in ONE grouped DB query instead of one per issue (Fix 3 / KAN-28).
  try {
    for (const issue of issuesToTransition) {
      eventBus.emit({
        type: "issue.transitioned",
        workspaceId: project.workspaceId,
        actorId: memberId,
        payload: {
          issueKey: issue.key,
          issueId: issue.id,
          from: issue.state,
          to: targetState,
          // Tells the notification routeEvent to skip subscribed_activity for this event
          // — the batch event below handles fan-out grouped across all issues.
          _skipSubscribedActivity: true,
        },
      });
    }
  } catch (err) {
    // Never let per-issue event emission break the mutation; swallowed failures are logged.
    console.error(
      { issueIds: issuesToTransition.map((i) => i.id), err },
      "batchTransitionByKeys: per-issue event emission failed",
    );
  }

  // Single batched event → notification handler does ONE findMany+createMany
  // across all affected issues, eliminating the N+1 from per-issue fan-out.
  // Kept outside the per-issue try/catch so a per-issue emit failure and the
  // batch-fan-out emit failure are independently observable.
  try {
    eventBus.emit({
      type: "issue.batch_transitioned",
      workspaceId: project.workspaceId,
      actorId: memberId,
      payload: {
        // Each entry carries both id (for DB lookup) and key (for notification payload),
        // so the handler never needs a second query to resolve issueKey per row (Fix / KAN-28).
        issues: issuesToTransition.map((i) => ({ id: i.id, key: i.key })),
        to: targetState,
      },
    });
  } catch (err) {
    // Never let batch event emission break the mutation; log so failures are observable.
    console.error(
      { issueIds: issuesToTransition.map((i) => i.id), err },
      "batchTransitionByKeys: batch event emission failed",
    );
  }

  return {
    count: result.count,
    keys: issuesToTransition.map((i) => i.key),
    state: targetState,
  };
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
