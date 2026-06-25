import { vi } from "vitest";

/**
 * Shared tx stub for cycle service unit tests.
 *
 * Covers all methods touched by:
 *   - createCycle (tx.cycle.create, tx.cycle.updateMany, tx.issue.updateMany, tx.cycleScopeEvent.*)
 *   - deleteCycle (tx.cycle.findUnique, tx.cycle.delete, tx.issue.updateMany, tx.adminAuditLog.create)
 *
 * Pass `overrides` to control return values or inject failures per test.
 */
export function makeTxMock(overrides?: {
  cycleCreateResult?: unknown;
  shouldThrow?: boolean;
  cycleFindUniqueResult?: unknown;
  auditLogCreateResult?: unknown;
}) {
  const cycleCreateResult = overrides?.cycleCreateResult ?? {
    id: "cycle-new",
    name: "Sprint",
    state: "upcoming",
    projectId: "project-1",
    startDate: new Date("2026-04-20"),
    endDate: new Date("2026-05-04"),
  };

  const cycleFindUniqueResult = overrides?.cycleFindUniqueResult ?? null;
  const auditLogCreateResult = overrides?.auditLogCreateResult ?? { id: "audit-1" };

  const tx = {
    cycle: {
      create: vi.fn().mockImplementation(async () => {
        if (overrides?.shouldThrow) throw new Error("tx-fail");
        return cycleCreateResult;
      }),
      update: vi.fn().mockResolvedValue(cycleCreateResult),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(cycleFindUniqueResult),
      delete: vi.fn().mockResolvedValue({}),
    },
    issue: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    cycleScopeEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    // KAN-152: baseline snapshot on activation + explicit re-baseline op.
    issueSchedule: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    activityLog: {
      create: vi.fn().mockResolvedValue({ id: "activity-1" }),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue(auditLogCreateResult),
    },
  };
  return tx;
}
