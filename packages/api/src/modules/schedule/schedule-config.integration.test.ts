/**
 * Integration tests: project working-day calendar config (KAN-147, ADR-0007).
 *
 * Covers:
 * - GET /api/projects/:key/schedule-config returns Mon–Fri default when no config
 * - PUT sets workDays + holidays; GET reflects them
 * - PUT validation: empty workDays → 400; bad date strings → 400
 * - viewer rejected on PUT (403); member+ allowed
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

describe("Project schedule-config routes (integration)", () => {
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

  async function seedProjectContext(
    role: "owner" | "admin" | "pm" | "member" | "viewer" = "member",
  ) {
    const ws = await seedTestWorkspace();
    await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, role);
    const project = await seedTestProject(ws.id);
    if (role !== "owner" && role !== "admin") {
      await seedTestProjectMember(member.userId, project.id, role);
    }
    return { ws, member, project };
  }

  it("returns Mon–Fri default when no config exists", async () => {
    const { member, project } = await seedProjectContext();

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ workDays: [1, 2, 3, 4, 5], holidays: [] });
  });

  it("PUT sets workDays + holidays and GET reflects them", async () => {
    const { member, project } = await seedProjectContext();

    const put = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [0, 1, 2, 3, 4], holidays: ["2026-12-25", "2026-01-01"] },
    });
    expect(put.statusCode).toBe(200);
    // Stored sorted + de-duplicated.
    expect(put.json()).toEqual({
      workDays: [0, 1, 2, 3, 4],
      holidays: ["2026-01-01", "2026-12-25"],
    });

    const get = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(get.json()).toEqual({
      workDays: [0, 1, 2, 3, 4],
      holidays: ["2026-01-01", "2026-12-25"],
    });
  });

  it("PUT upserts (second call replaces the first)", async () => {
    const { member, project } = await seedProjectContext();

    await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3], holidays: [] },
    });
    const put2 = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3, 4, 5], holidays: ["2026-07-04"] },
    });
    expect(put2.statusCode).toBe(200);
    expect(put2.json()).toEqual({
      workDays: [1, 2, 3, 4, 5],
      holidays: ["2026-07-04"],
    });
  });

  it("rejects empty workDays (400)", async () => {
    const { member, project } = await seedProjectContext();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [], holidays: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects out-of-range workDays (400)", async () => {
    const { member, project } = await seedProjectContext();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 7], holidays: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects bad holiday date strings (400)", async () => {
    const { member, project } = await seedProjectContext();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3, 4, 5], holidays: ["2026-13-99"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects rolled-over dates like 2026-02-30 (400) — round-trip validation", async () => {
    // JS parses 2026-02-30 as Mar 2 (no NaN), so !isNaN accepts it. The round-trip
    // check catches it: new Date("2026-02-30T...Z").toISOString().slice(0,10) = "2026-03-02" ≠ input.
    const { member, project } = await seedProjectContext();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3, 4, 5], holidays: ["2026-02-30"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects 2026-06-31 (400) — June has 30 days", async () => {
    const { member, project } = await seedProjectContext();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3, 4, 5], holidays: ["2026-06-31"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid leap day 2024-02-29 (200) — round-trip must not over-reject", async () => {
    const { member, project } = await seedProjectContext();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3, 4, 5], holidays: ["2024-02-29"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().holidays).toEqual(["2024-02-29"]);
  });

  it("rejects a viewer on PUT (403)", async () => {
    const { member, project } = await seedProjectContext("viewer");
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.key}/schedule-config`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { workDays: [1, 2, 3, 4, 5], holidays: [] },
    });
    expect(res.statusCode).toBe(403);
  });
});
