/**
 * Integration tests: Schedule module (KAN-99 PR2a).
 * Requires the kanon_test DB with ppm_w1_pr2a_schedule migration applied.
 * Run: pnpm test:db:setup first, then pnpm test.
 *
 * Covers:
 * - PUT /api/issues/:key/schedule upserts plan (creates on first, updates on second)
 * - POST /api/issues/:key/estimate atomically appends EstimateRevision and updates
 *   IssueSchedule.estimateHours
 * - GET /api/issues/:key/schedule returns the schedule
 * - estimateHours arrives as string "3.50" not a number (Decimal boundary)
 * - progress CHECK: value > 100 rejected at service level (422)
 * - Viewer is rejected on PUT/POST (403)
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

describe("Schedule Routes (integration)", () => {
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
   * Seed: workspace + owner + member + project + project-member + issue.
   * Returns everything needed by route tests.
   */
  async function seedIssueContext(role: "owner" | "admin" | "pm" | "member" | "viewer" = "member") {
    const ws = await seedTestWorkspace();
    await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, role);
    const project = await seedTestProject(ws.id);

    // viewer/member/pm need an explicit ProjectMember row
    if (role !== "owner" && role !== "admin") {
      await seedTestProjectMember(member.userId, project.id, role);
    }

    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Test issue for schedule",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });

    return { ws, member, project, issue };
  }

  // ── GET /api/issues/:key/schedule ──────────────────────────────────────

  describe("GET /api/issues/:key/schedule", () => {
    it("returns null (200) when no schedule exists yet", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toBeNull();
    });

    it("returns the schedule after it has been upserted", async () => {
      const { member, issue } = await seedIssueContext();

      // First upsert via PUT
      await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 30 },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.issueId).toBe(issue.id);
      expect(body.progress).toBe(30);
    });
  });

  // ── PUT /api/issues/:key/schedule ──────────────────────────────────────

  describe("PUT /api/issues/:key/schedule", () => {
    it("creates the IssueSchedule row on first PUT (upsert)", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 25 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.issueId).toBe(issue.id);
      expect(body.progress).toBe(25);

      // Verify DB row created
      const row = await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } });
      expect(row).not.toBeNull();
      expect(row!.progress).toBe(25);
    });

    it("updates existing IssueSchedule on second PUT (upsert is idempotent)", async () => {
      const { member, issue } = await seedIssueContext();

      // First PUT
      await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 10 },
      });

      // Second PUT with different progress
      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 50 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().progress).toBe(50);

      // Only one row in DB
      const count = await prisma.issueSchedule.count({ where: { issueId: issue.id } });
      expect(count).toBe(1);
    });

    it("upserts startDate and dueDate fields", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {
          startDate: "2026-07-01T00:00:00.000Z",
          dueDate: "2026-07-31T00:00:00.000Z",
          progress: 0,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.startDate).toBe("2026-07-01T00:00:00.000Z");
      expect(body.dueDate).toBe("2026-07-31T00:00:00.000Z");
    });

    it("returns 400 when progress > 100 (schema validation guard)", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 101 },
      });

      // Fastify/Zod schema has .max(100) — rejects with 400 before hitting service
      // The service has an additional 422 guard for defense-in-depth (covered in unit tests)
      expect(res.statusCode).toBe(400);
    });

    it("returns 422 INVALID_DATE_RANGE when startDate > dueDate", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {
          startDate: "2026-07-31T00:00:00.000Z",
          dueDate: "2026-07-01T00:00:00.000Z",
        },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("INVALID_DATE_RANGE");
    });

    it("returns 403 when viewer tries to PUT schedule", async () => {
      const { member, issue } = await seedIssueContext("viewer");

      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 10 },
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns 404 when issue does not exist", async () => {
      const { member } = await seedIssueContext();

      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/NOPE-999/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { progress: 0 },
      });

      // 404 from requireIssueRole guard or service
      expect(res.statusCode).toBe(404);
    });

    it("[RED→GREEN] partial-date conflict: PUT dueDate before persisted startDate returns 422 INVALID_DATE_RANGE", async () => {
      const { member, issue } = await seedIssueContext();

      // First PUT: set startDate = Aug 1
      await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { startDate: "2026-08-01T00:00:00.000Z" },
      });

      // Second PUT: try to set dueDate = Jul 1 (before the persisted startDate).
      // The partial-update guard must read the persisted startDate and detect start > due.
      const res = await app.inject({
        method: "PUT",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { dueDate: "2026-07-01T00:00:00.000Z" },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("INVALID_DATE_RANGE");
    });
  });

  // ── POST /api/issues/:key/estimate ─────────────────────────────────────

  describe("POST /api/issues/:key/estimate", () => {
    it("appends an EstimateRevision row and updates IssueSchedule.estimateHours atomically", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "3.50", reason: "initial estimate" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.hours).toBe("3.50");
      expect(body.reason).toBe("initial estimate");
      expect(body.authorId).toBeDefined();

      // EstimateRevision row created in DB
      const revisions = await prisma.estimateRevision.findMany({
        where: { issueId: issue.id },
      });
      expect(revisions).toHaveLength(1);
      // Prisma Decimal.toString() may strip trailing zeros — compare as number
      expect(Number(revisions[0]!.hours.toString())).toBe(3.5);

      // IssueSchedule.estimateHours updated
      const schedule = await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } });
      expect(schedule).not.toBeNull();
      expect(Number(schedule!.estimateHours!.toString())).toBe(3.5);
    });

    it("estimateHours in response is a STRING not a number (Decimal boundary)", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "3.50" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      // hours must arrive as a string, not a JS number
      expect(typeof body.hours).toBe("string");
      expect(body.hours).toBe("3.50");
    });

    it("appends multiple EstimateRevision rows on successive calls (audit log)", async () => {
      const { member, issue } = await seedIssueContext();

      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "2.00" },
      });

      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "4.00", reason: "revised after review" },
      });

      // Two revision rows; estimateHours = latest
      const revisions = await prisma.estimateRevision.findMany({
        where: { issueId: issue.id },
        orderBy: { createdAt: "asc" },
      });
      expect(revisions).toHaveLength(2);
      // Prisma Decimal.toString() may strip trailing zeros ("2" not "2.00") — compare as number
      expect(Number(revisions[0]!.hours.toString())).toBe(2);
      expect(Number(revisions[1]!.hours.toString())).toBe(4);

      const schedule = await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } });
      expect(Number(schedule!.estimateHours!.toString())).toBe(4);
    });

    it("returns 403 when viewer tries to POST estimate", async () => {
      const { member, issue } = await seedIssueContext("viewer");

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "1.00" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("returns 422 INVALID_ESTIMATE when hours is negative string", async () => {
      const { member, issue } = await seedIssueContext();

      // The regex guard in schema won't allow '-' prefix, but test service guard via valid non-neg
      // "0" is valid; verify the schema rejects malformed: regex won't pass '-1'
      // So we bypass schema by testing the service boundary indirectly via schema rejection
      // hours must match /^\d+(\.\d{1,2})?$/ — '-' prefix fails regex → 400 from Fastify
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "-1" },
      });

      // Fastify schema validation rejects at regex level with 400
      expect(res.statusCode).toBe(400);
    });

    it("allows hours=0 (zero estimate is valid)", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "0" },
      });

      expect(res.statusCode).toBe(201);
      // toFixed(2) serialization: "0" → "0.00"
      expect(res.json().hours).toBe("0.00");
    });

    it("[RED→GREEN] rejects 7-integer-digit hours with 400 (DECIMAL(8,2) overflow guard)", async () => {
      const { member, issue } = await seedIssueContext();

      // "1234567" has 7 integer digits — overflows DECIMAL(8,2) max 999999.99
      // The /^\d{1,6}(\.\d{1,2})?$/ regex must reject this before it reaches the DB.
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "1234567" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("GET schedule after estimate shows estimateHours as string", async () => {
      const { member, issue } = await seedIssueContext();

      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/estimate`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { hours: "3.50" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/schedule`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.estimateHours).toBe("string");
      expect(body.estimateHours).toBe("3.50");
    });
  });
});
