/**
 * Integration tests: Timesheet module (KAN-100 PR3).
 * Requires the kanon_test DB with ppm_w1_pr3_timesheet migration applied.
 * Run: pnpm test:db:setup first, then pnpm test.
 *
 * Covers:
 * - POST /api/worklogs/:id/promote → creates draft TimeEntry
 * - Promote idempotency: same workLogId twice → same id (409 guard via unique index)
 * - PATCH /api/time-entries/:id — owner-only, rejects when approved
 * - POST /api/time-entries/:id/submit — owner-only, transitions draft→submitted
 * - POST /api/time-entries/:id/approve — PM gate (member 403 / pm 200)
 * - POST /api/time-entries/:id/reject — PM gate
 * - POST /api/time-entries/:id/adjust — creates a new draft entry; negative hours allowed
 * - PATCH on approved → 409 ENTRY_IMMUTABLE
 * - hours response is string "2.00" (Decimal boundary)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkLog,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

describe("Timesheet Routes (integration)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * Seed: workspace + owner + project + issue + member-with-role.
   * Returns everything needed by route tests.
   */
  async function seedContext(
    memberRole: "owner" | "admin" | "pm" | "member" | "viewer" = "member",
  ) {
    const ws = await seedTestWorkspace();
    // owner needed so the workspace always has an owner row
    const owner = await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, memberRole);
    const project = await seedTestProject(ws.id);

    // member/pm/viewer need an explicit ProjectMember row (owner/admin bypass)
    if (memberRole !== "owner" && memberRole !== "admin") {
      await seedTestProjectMember(member.userId, project.id, memberRole);
    }

    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Test issue for timesheet",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });

    return { ws, owner, member, project, issue };
  }

  /**
   * Seed context with both a regular member AND a PM so we can test role gates.
   */
  async function seedDualContext() {
    const ws = await seedTestWorkspace();
    await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, "member");
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id);

    await seedTestProjectMember(member.userId, project.id, "member");
    await seedTestProjectMember(pm.userId, project.id, "pm");

    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Dual-context issue",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });

    return { ws, member, pm, project, issue };
  }

  // ── POST /api/worklogs/:id/promote ─────────────────────────────────────

  describe("POST /api/worklogs/:id/promote", () => {
    it("creates a draft TimeEntry from a WorkLog (happy path)", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id, { durationS: 7200 });

      const res = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe("draft");
      expect(body.memberId).toBe(member.id);
      expect(body.issueId).toBe(issue.id);
      expect(body.sourceWorkLogId).toBe(wl.id);
    });

    it("hours response is a STRING not a number (Decimal boundary)", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id, { durationS: 7200 });

      const res = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      // hours must be a string "2.00", not a JS number
      expect(typeof body.hours).toBe("string");
      expect(body.hours).toBe("2.00");
    });

    it("promote idempotency: same workLogId twice returns the same entry id", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      // First promote
      const res1 = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      expect(res1.statusCode).toBe(201);
      const id1 = res1.json().id;

      // Second promote — unique index fires; service catches P2002 and returns existing
      const res2 = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      expect(res2.statusCode).toBe(201);
      const id2 = res2.json().id;

      expect(id1).toBe(id2);
    });

    it("returns 404 when WorkLog does not exist", async () => {
      const { member } = await seedContext();

      const res = await app.inject({
        method: "POST",
        url: `/api/worklogs/00000000-0000-0000-0000-000000000001/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      // 404 from route guard (requireWorkLogRole) when worklog not in DB
      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /api/time-entries/:id ────────────────────────────────────────

  describe("PATCH /api/time-entries/:id", () => {
    it("updates hours on a draft entry (happy path)", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      // Create draft entry via promote
      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      const res = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${entryId}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "3.50" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().hours).toBe("3.50");
    });

    it("[GUARD] returns 409 ENTRY_IMMUTABLE when updating an approved entry", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      // Promote → submit → approve
      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/approve`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: {},
      });

      // Now try to PATCH the approved entry
      const res = await app.inject({
        method: "PATCH",
        url: `/api/time-entries/${entryId}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "5.00" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("ENTRY_IMMUTABLE");
    });
  });

  // ── POST /api/time-entries/:id/submit ──────────────────────────────────

  describe("POST /api/time-entries/:id/submit", () => {
    it("transitions draft → submitted (happy path)", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("submitted");
    });
  });

  // ── POST /api/time-entries/:id/approve ─────────────────────────────────

  describe("POST /api/time-entries/:id/approve", () => {
    it("[GUARD] pm 200 on approve", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/approve`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("approved");
      expect(res.json().approvedById).toBe(pm.id);
    });

    it("[GUARD] member cannot approve — 403 from requireEntryRole pm gate", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      // member tries to approve — should get 403 from route-level pm gate
      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/approve`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });

    it("full promote → submit → approve happy path (end-to-end)", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id, { durationS: 3600 });

      // Promote
      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      expect(promoteRes.statusCode).toBe(201);
      expect(promoteRes.json().status).toBe("draft");
      expect(promoteRes.json().hours).toBe("1.00"); // 3600s / 3600 = 1.00

      const entryId = promoteRes.json().id;

      // Submit
      const submitRes = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("submitted");

      // Approve (PM gate)
      const approveRes = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/approve`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: {},
      });
      expect(approveRes.statusCode).toBe(200);
      const approved = approveRes.json();
      expect(approved.status).toBe("approved");
      expect(approved.approvedById).toBe(pm.id);
      expect(approved.approvedAt).toBeTruthy();

      // Verify in DB
      const row = await prisma.timeEntry.findUnique({ where: { id: entryId } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe("approved");
      expect(row!.approvedById).toBe(pm.id);
    });
  });

  // ── POST /api/time-entries/:id/reject ──────────────────────────────────

  describe("POST /api/time-entries/:id/reject", () => {
    it("pm can reject a submitted entry", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/reject`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("rejected");
    });

    it("[GUARD] member cannot reject — 403 from requireEntryRole pm gate", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/reject`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /api/time-entries/:id/adjust ──────────────────────────────────

  describe("POST /api/time-entries/:id/adjust", () => {
    /**
     * Helper: promote → submit → approve (via pm), returns approvedEntry.
     */
    async function createApprovedEntry(
      memberToken: string,
      pmToken: string,
      workLogId: string,
    ) {
      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${workLogId}/promote`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {},
      });
      const entryId = promoteRes.json().id;

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/submit`,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: {},
      });

      await app.inject({
        method: "POST",
        url: `/api/time-entries/${entryId}/approve`,
        headers: { authorization: `Bearer ${pmToken}` },
        payload: {},
      });

      return entryId;
    }

    it("creates a draft adjustment entry with negative hours (happy path)", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id, { durationS: 7200 });
      const approvedId = await createApprovedEntry(member.token, pm.token, wl.id);

      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${approvedId}/adjust`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {
          hours: "-1.00",
          workedOn: "2026-06-14T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.adjustsId).toBe(approvedId);
      expect(body.status).toBe("draft");
      expect(body.hours).toBe("-1.00");
    });

    it("[GUARD] returns 409 NOT_APPROVED when original is not approved", async () => {
      const { member, issue } = await seedContext();
      const wl = await seedTestWorkLog(member.id, issue.id);

      // Promote to draft (not submitted/approved)
      const promoteRes = await app.inject({
        method: "POST",
        url: `/api/worklogs/${wl.id}/promote`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      const draftId = promoteRes.json().id;

      const res = await app.inject({
        method: "POST",
        url: `/api/time-entries/${draftId}/adjust`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {
          hours: "-0.50",
          workedOn: "2026-06-14T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("NOT_APPROVED");
    });

    it("adjustment flows through submit→approve gate independently", async () => {
      const { member, pm, issue } = await seedDualContext();
      const wl = await seedTestWorkLog(member.id, issue.id, { durationS: 7200 });
      const approvedId = await createApprovedEntry(member.token, pm.token, wl.id);

      // Create the adjustment (negative hours)
      const adjustRes = await app.inject({
        method: "POST",
        url: `/api/time-entries/${approvedId}/adjust`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {
          hours: "-0.50",
          workedOn: "2026-06-14T00:00:00.000Z",
        },
      });
      expect(adjustRes.statusCode).toBe(201);
      const adjustId = adjustRes.json().id;

      // Submit the adjustment
      const submitRes = await app.inject({
        method: "POST",
        url: `/api/time-entries/${adjustId}/submit`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("submitted");

      // Approve the adjustment (PM gate)
      const approveRes = await app.inject({
        method: "POST",
        url: `/api/time-entries/${adjustId}/approve`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: {},
      });
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().status).toBe("approved");
      expect(approveRes.json().hours).toBe("-0.50");
    });

    it("DB CHECK: hours < 0 without adjustsId violates the time_entries_hours_sign CHECK", async () => {
      // This test verifies the DB CHECK is present by attempting a direct DB insert
      // with negative hours and no adjustsId — should fail with Prisma error.
      const { member, issue } = await seedContext();

      await expect(
        prisma.timeEntry.create({
          data: {
            memberId: member.id,
            issueId: issue.id,
            hours: new (await import("@prisma/client")).Prisma.Decimal("-1.00"),
            workedOn: new Date(),
            status: "draft",
            // adjustsId intentionally NOT set — should violate CHECK
          },
        }),
      ).rejects.toThrow(); // Prisma throws on CHECK constraint violation
    });
  });
});
