import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { eventBus } from "../../services/event-bus/index.js";

// ── Constants ────────────────────────────────────────────────────────────────

const NON_TERMINAL_STATES = ["backlog", "todo", "in_progress", "review"] as const;
type NonTerminalState = (typeof NON_TERMINAL_STATES)[number];

type CycleWithIssuesAndProject = Prisma.CycleGetPayload<{
  include: {
    issues: { select: { id: true; key: true; state: true } };
    project: { select: { workspaceId: true } };
  };
}>;

// ── Types ────────────────────────────────────────────────────────────────────

interface DeleteCycleOpts {
  force?: boolean;
  reason?: string;
}

export interface DeleteCycleResult {
  auditLogId: string;
  deletedCycleId: string;
  cycleName: string;
  detachedIssueKeys: string[];
}

// ── Service function ─────────────────────────────────────────────────────────

/**
 * Hard-delete a cycle by id.
 *
 * Guards:
 *   1. Active-state guard — never bypassable via force.
 *   2. Non-terminal-issues guard — bypassable via force:true.
 *
 * Within a single transaction:
 *   - Writes an AdminAuditLog row with full cycle snapshot.
 *   - Detaches all attached issues (issue.updateMany → cycleId: null).
 *   - Deletes the cycle row (CycleScopeEvent rows cascade via DB).
 *
 * Post-commit (fire-and-forget):
 *   - Emits issue.updated per detached key.
 *   - Emits cycle.deleted once.
 *
 * Prisma P2025 (concurrent delete race) is caught OUTSIDE the transaction
 * and rethrown as AppError(404, "CYCLE_NOT_FOUND").
 */
export async function deleteCycle(
  cycleId: string,
  opts: DeleteCycleOpts,
  authorId: string,
): Promise<DeleteCycleResult> {
  let txResult: {
    auditLogId: string;
    deletedCycleId: string;
    cycleName: string;
    detachedIssueKeys: string[];
    projectId: string;
    workspaceId: string | undefined;
  };

  try {
    txResult = await prisma.$transaction(async (tx) => {
      // 1. Re-fetch cycle with attached issues and project for workspaceId
      const cycle: CycleWithIssuesAndProject | null = await tx.cycle.findUnique({
        where: { id: cycleId },
        include: {
          issues: { select: { id: true, key: true, state: true } },
          project: { select: { workspaceId: true } },
        },
      });

      if (!cycle) {
        throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");
      }

      // 2. Active-state guard — NOT bypassable by force
      if (cycle.state === "active") {
        throw new AppError(
          409,
          "CYCLE_ACTIVE",
          "Cannot delete an active cycle. Close it or change its state first.",
        );
      }

      // 3. Non-terminal-issues guard — bypassable by force
      const nonTerminal = cycle.issues.filter((i) =>
        (NON_TERMINAL_STATES as readonly string[]).includes(i.state),
      );
      if (nonTerminal.length > 0 && !opts.force) {
        throw new AppError(
          400,
          "CYCLE_HAS_NON_TERMINAL_ISSUES",
          "Cycle has issues in non-terminal states. Pass force:true to override.",
          { issueKeys: nonTerminal.map((i) => i.key) },
        );
      }

      // 4. All attached issue keys (to be detached)
      const detachedIssueKeys = cycle.issues.map((i) => i.key);

      // 5. Build audit payload — full cycle snapshot
      const payload = {
        cycleSnapshot: {
          id: cycle.id,
          name: cycle.name,
          goal: cycle.goal ?? null,
          state: cycle.state,
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          velocity: cycle.velocity ?? null,
          projectId: cycle.projectId,
          createdAt: cycle.createdAt,
          updatedAt: cycle.updatedAt,
        },
        detachedIssueKeys,
        force: opts.force ?? false,
      };

      // 6. Audit row — inside tx for atomicity
      const audit = await tx.adminAuditLog.create({
        data: {
          entityType: "cycle",
          entityId: cycle.id,
          action: "delete",
          payload,
          authorId,
          reason: opts.reason ?? null,
        },
        select: { id: true },
      });

      // 7. Explicit detach — BEFORE hard delete (even for zero rows)
      await tx.issue.updateMany({
        where: { cycleId: cycle.id },
        data: { cycleId: null },
      });

      // 8. Hard delete — CycleScopeEvent rows cascade via DB onDelete: Cascade
      await tx.cycle.delete({ where: { id: cycle.id } });

      return {
        auditLogId: audit.id,
        deletedCycleId: cycle.id,
        cycleName: cycle.name,
        detachedIssueKeys,
        projectId: cycle.projectId,
        workspaceId: cycle.project?.workspaceId,
      };
    });
  } catch (err) {
    // Map Prisma P2025 (concurrent delete race — winner already deleted)
    // to a user-friendly 404. This MUST be outside the tx callback.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      throw new AppError(
        404,
        "CYCLE_NOT_FOUND",
        "Cycle not found (may have been deleted concurrently).",
      );
    }
    throw err;
  }

  // Post-commit SSE — fire-and-forget; never let emission break the mutation
  try {
    for (const issueKey of txResult.detachedIssueKeys) {
      eventBus.emit({
        type: "issue.updated",
        workspaceId: txResult.workspaceId ?? "",
        actorId: authorId,
        payload: { issueKey, fields: ["cycleId"] },
      });
    }
    eventBus.emit({
      type: "cycle.deleted",
      workspaceId: txResult.workspaceId ?? "",
      actorId: authorId,
      payload: {
        cycleId: txResult.deletedCycleId,
        projectId: txResult.projectId,
      },
    });
  } catch {
    // Never let event emission break the mutation result
  }

  return {
    auditLogId: txResult.auditLogId,
    deletedCycleId: txResult.deletedCycleId,
    cycleName: txResult.cycleName,
    detachedIssueKeys: txResult.detachedIssueKeys,
  };
}
