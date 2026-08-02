/**
 * KAN-188 — integration coverage for the confirmedTotalHours override path
 * against a real Postgres test DB (the gap left by unit-only coverage:
 * mocked tests cannot catch a missing/invalid adjustsId hitting the real
 * DB CHECK constraint `time_entries_hours_sign`).
 *
 * Scenario: reconcile a DOWNWARD override end-to-end.
 *   1. No CHECK-constraint violation is thrown (negative entry correctly
 *      anchors adjustsId to the approved entry).
 *   2. The resulting confirmed total equals the override value exactly.
 *   3. issue.timeConfirmedAt is stamped so a subsequent transition→done
 *      succeeds (the reconciliation gate clears).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

async function seedIssueInReview(projectId: string, keySuffix: string) {
  const count = await prisma.issue.count();
  return prisma.issue.create({
    data: {
      key: `RCO-${keySuffix}`,
      sequenceNum: count + 1,
      title: `Reconcile override test issue ${keySuffix}`,
      type: "task",
      priority: "medium",
      state: "review",
      projectId,
    },
    select: { id: true, key: true },
  });
}

describe("KAN-188 reconcile-time confirmedTotalHours override — integration (real DB)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await cleanDatabase();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  it("corrects hours DOWNWARD end-to-end: no CHECK violation, exact confirmed total, and →done succeeds after reconcile", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "RCOA");
    await seedTestProjectMember(member.userId, project.id, "pm");
    const issue = await seedIssueInReview(project.id, "down1");

    // Seed an existing APPROVED TimeEntry totalling 6h.
    await prisma.timeEntry.create({
      data: {
        memberId: member.id,
        issueId: issue.id,
        hours: "6",
        workedOn: new Date("2026-06-24T09:00:00.000Z"),
        status: "approved",
        approvedById: member.id,
        approvedAt: new Date("2026-06-24T09:00:00.000Z"),
        via: "reconcile",
      },
    });

    // Reconcile with a downward override: 6h → 4h (delta = -2h).
    const reconcileRes = await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/reconcile-time`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { confirmedTotalHours: "4" },
    });

    // (a) No CHECK-constraint violation — the request must succeed (200),
    // not blow up with a Postgres constraint error (500).
    expect(reconcileRes.statusCode).toBe(200);

    // (b) The resulting confirmed total equals the override value exactly.
    const body = reconcileRes.json();
    expect(body.totalHours).toBe(4);

    const entries = await prisma.timeEntry.findMany({
      where: { issueId: issue.id },
      select: { hours: true, status: true, adjustsId: true, via: true },
    });
    const total = entries.reduce((sum, e) => sum + parseFloat(e.hours.toString()), 0);
    expect(Math.round(total * 100) / 100).toBe(4);

    // The negative corrective entry must anchor adjustsId to an approved entry.
    const correctiveEntry = entries.find((e) => e.via === "reconcile-override");
    expect(correctiveEntry).toBeDefined();
    expect(parseFloat(correctiveEntry!.hours.toString())).toBe(-2);
    expect(correctiveEntry!.adjustsId).not.toBeNull();

    // (c) issue.timeConfirmedAt is stamped so a subsequent transition→done succeeds.
    const transitionRes = await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/transition`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { to_state: "done" },
    });

    expect(transitionRes.statusCode).toBe(200);
    expect(transitionRes.json().state).toBe("done");
  });

  it("does not count another member's draft as confirmed time", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "RCOB");
    await seedTestProjectMember(member.userId, project.id, "pm");
    const issue = await seedIssueInReview(project.id, "noanchor1");

    // Seed only a DRAFT (non-approved) TimeEntry totalling 5h.
    await prisma.timeEntry.create({
      data: {
        memberId: member.id,
        issueId: issue.id,
        hours: "5",
        workedOn: new Date("2026-06-24T09:00:00.000Z"),
        status: "draft",
        via: "manual",
      },
    });

    // A cross-member draft is not approved by this reconcile call and must not
    // inflate the authoritative confirmed total.
    const other = await seedTestMemberWithRole(ws.id, "member");
    await seedTestProjectMember(other.userId, project.id, "member");
    await prisma.timeEntry.updateMany({
      where: { issueId: issue.id },
      data: { memberId: other.id },
    });

    const reconcileRes = await app.inject({
      method: "POST",
      url: `/api/issues/${issue.key}/reconcile-time`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { confirmedTotalHours: "2" },
    });

    expect(reconcileRes.statusCode).toBe(200);
    expect(reconcileRes.json().totalHours).toBe(2);

    const entries = await prisma.timeEntry.findMany({ where: { issueId: issue.id } });
    const correction = entries.find((entry) => entry.via === "reconcile-override");
    expect(correction).toBeDefined();
    expect(parseFloat(correction!.hours.toString())).toBe(2);
    expect(correction!.adjustsId).toBeNull();
  });
});
