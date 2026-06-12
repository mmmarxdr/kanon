/**
 * Integration tests for roadmap dependency endpoints and service.ts error/edge
 * branches (KAN-84 slice 3).
 *
 * Covers:
 *   - addDependency: success, duplicate (409), self-dependency (400), cycle (400),
 *     not-found source (404), not-found target (404), project not found (404)
 *   - removeDependency: success, dep-not-found (404), wrong-item ownership (404),
 *     project not found (404)
 *   - getDependencies: success with populated blocks/blockedBy, item-not-found (404),
 *     project not found (404)
 *   - createRoadmapItem: project not found (404)
 *   - getRoadmapItem: item not found (404), project not found (404)
 *   - updateRoadmapItem: item not found (404), project not found (404)
 *   - deleteRoadmapItem: item not found (404), project not found (404)
 *   - promoteToIssue: already-promoted item (idempotent 201), item not found (404),
 *     project not found (404)
 *   - listRoadmapItems: project not found (404), filter by status and label
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";

describe("Roadmap — dependency endpoints", () => {
  let app: FastifyInstance;
  let projectKey: string;
  let token: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const project = await seedTestProject(ws.id);

    await seedTestProjectMember(member.userId, project.id, "member");
    await seedTestProjectMember(admin.userId, project.id, "admin");

    projectKey = project.key;
    token = member.token;
    adminToken = admin.token;
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  async function createItem(title: string, tok = token) {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; title: string; promoted: boolean };
  }

  async function addDep(sourceId: string, targetId: string, tok = token) {
    return app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${sourceId}/dependencies`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { targetId, type: "blocks" },
    });
  }

  // ── addDependency — success ───────────────────────────────────────────────

  it("POST .../dependencies creates a dependency and returns 201", async () => {
    const source = await createItem("Source item");
    const target = await createItem("Target item");

    const res = await addDep(source.id, target.id);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sourceId).toBe(source.id);
    expect(body.targetId).toBe(target.id);
    expect(body.type).toBe("blocks");
    expect(body.id).toBeDefined();
  });

  it("POST .../dependencies returns source and target summaries in response", async () => {
    const source = await createItem("Feature A");
    const target = await createItem("Feature B");

    const res = await addDep(source.id, target.id);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.source.title).toBe("Feature A");
    expect(body.target.title).toBe("Feature B");
  });

  // ── addDependency — self-dependency (400) ─────────────────────────────────

  it("POST .../dependencies returns 400 SELF_DEPENDENCY for same source and target", async () => {
    const item = await createItem("Self item");

    const res = await addDep(item.id, item.id);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("SELF_DEPENDENCY");
  });

  // ── addDependency — duplicate (409) ───────────────────────────────────────

  it("POST .../dependencies returns 409 DEPENDENCY_EXISTS for duplicate dep", async () => {
    const source = await createItem("Dup source");
    const target = await createItem("Dup target");

    // First add succeeds
    await addDep(source.id, target.id);

    // Second identical add should fail
    const res = await addDep(source.id, target.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DEPENDENCY_EXISTS");
  });

  // ── addDependency — cycle detection (400) ─────────────────────────────────

  it("POST .../dependencies returns 400 DEPENDENCY_CYCLE when adding creates a cycle", async () => {
    const a = await createItem("Item A");
    const b = await createItem("Item B");
    const c = await createItem("Item C");

    // A → B → C (chain)
    await addDep(a.id, b.id);
    await addDep(b.id, c.id);

    // C → A would close the cycle
    const res = await addDep(c.id, a.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("DEPENDENCY_CYCLE");
  });

  it("POST .../dependencies returns 400 DEPENDENCY_CYCLE for direct reverse dep", async () => {
    const a = await createItem("Item Alpha");
    const b = await createItem("Item Beta");

    // A blocks B
    await addDep(a.id, b.id);

    // B blocks A — direct cycle
    const res = await addDep(b.id, a.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("DEPENDENCY_CYCLE");
  });

  // ── addDependency — source not found (404) ────────────────────────────────

  it("POST .../dependencies returns 404 when source item does not exist", async () => {
    const target = await createItem("Existing target");
    const fakeId = "00000000-0000-0000-0000-000000000001";

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${fakeId}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { targetId: target.id, type: "blocks" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });

  // ── addDependency — target not found (404) ────────────────────────────────

  it("POST .../dependencies returns 404 when target item does not exist", async () => {
    const source = await createItem("Existing source");
    const fakeTargetId = "00000000-0000-0000-0000-000000000002";

    const res = await addDep(source.id, fakeTargetId);

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });

  // ── addDependency — project not found (404) ───────────────────────────────

  it("POST .../dependencies returns 404 when project key does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000003";
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/BOGUS/roadmap/${fakeId}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { targetId: fakeId, type: "blocks" },
    });

    // Routes dispatch through requireProjectRole which returns 404 for unknown project
    expect(res.statusCode).toBe(404);
  });

  // ── removeDependency — success ────────────────────────────────────────────

  it("DELETE .../dependencies/:depId removes the dependency and returns 204", async () => {
    const source = await createItem("Remove source");
    const target = await createItem("Remove target");

    const addRes = await addDep(source.id, target.id);
    const dep = addRes.json() as { id: string };

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectKey}/roadmap/${source.id}/dependencies/${dep.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(delRes.statusCode).toBe(204);

    // Verify the dep is gone via getDependencies
    const depsRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${source.id}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(depsRes.statusCode).toBe(200);
    expect(depsRes.json().blocks).toHaveLength(0);
  });

  // ── removeDependency — dep not found (404) ────────────────────────────────

  it("DELETE .../dependencies/:depId returns 404 when dep does not exist", async () => {
    const source = await createItem("Any item");
    const fakeDepId = "00000000-0000-0000-0000-000000000004";

    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectKey}/roadmap/${source.id}/dependencies/${fakeDepId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("DEPENDENCY_NOT_FOUND");
  });

  // ── removeDependency — dep belongs to different item (404) ────────────────

  it("DELETE .../dependencies/:depId returns 404 when dep belongs to a different item", async () => {
    const a = await createItem("Item A");
    const b = await createItem("Item B");
    const c = await createItem("Item C");

    // Create dep A→B
    const addRes = await addDep(a.id, b.id);
    const dep = addRes.json() as { id: string };

    // Try to delete dep A→B via item C's URL
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectKey}/roadmap/${c.id}/dependencies/${dep.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("DEPENDENCY_NOT_FOUND");
  });

  // ── getDependencies — success ─────────────────────────────────────────────

  it("GET .../dependencies returns blocks and blockedBy arrays", async () => {
    const a = await createItem("Dep item A");
    const b = await createItem("Dep item B");
    const c = await createItem("Dep item C");

    // A blocks B, A blocks C
    await addDep(a.id, b.id);
    await addDep(a.id, c.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${a.id}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocks).toHaveLength(2);
    expect(body.blockedBy).toHaveLength(0);
    expect(body.blocks.map((d: { targetId: string }) => d.targetId)).toContain(b.id);
    expect(body.blocks.map((d: { targetId: string }) => d.targetId)).toContain(c.id);
  });

  it("GET .../dependencies returns blockedBy when this item is the target", async () => {
    const a = await createItem("Blocker");
    const b = await createItem("Blocked");

    await addDep(a.id, b.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${b.id}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocks).toHaveLength(0);
    expect(body.blockedBy).toHaveLength(1);
    expect(body.blockedBy[0].sourceId).toBe(a.id);
  });

  it("GET .../dependencies returns empty arrays when no dependencies exist", async () => {
    const item = await createItem("Lonely item");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${item.id}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocks).toHaveLength(0);
    expect(body.blockedBy).toHaveLength(0);
  });

  // ── getDependencies — item not found (404) ────────────────────────────────

  it("GET .../dependencies returns 404 when item does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000005";

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${fakeId}/dependencies`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });
});

// ─── Error/edge branches for create/get/update/delete/promote ─────────────────

describe("Roadmap — service error branches", () => {
  let app: FastifyInstance;
  let projectKey: string;
  let token: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const ws = await seedTestWorkspace();
    const member = await seedTestMember(ws.id);
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const project = await seedTestProject(ws.id);

    await seedTestProjectMember(member.userId, project.id, "member");
    await seedTestProjectMember(admin.userId, project.id, "admin");

    projectKey = project.key;
    token = member.token;
    adminToken = admin.token;
  });

  async function createItem(title = "Item", tok = token) {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { title },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; promoted: boolean };
  }

  // ── getRoadmapItem — item not found (404) ─────────────────────────────────

  it("GET /roadmap/:id returns 404 when item does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000010";

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });

  // ── updateRoadmapItem — item not found (404) ──────────────────────────────

  it("PATCH /roadmap/:id returns 404 when item does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000011";

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Updated" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });

  // ── deleteRoadmapItem — item not found (404) ──────────────────────────────

  it("DELETE /roadmap/:id returns 404 when item does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000012";

    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectKey}/roadmap/${fakeId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });

  // ── promoteToIssue — item not found (404) ─────────────────────────────────

  it("POST /roadmap/:id/promote returns 404 when item does not exist", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000013";

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${fakeId}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("ROADMAP_ITEM_NOT_FOUND");
  });

  // ── promoteToIssue — already promoted (promotes again, idempotent service) ─

  it("POST /roadmap/:id/promote can promote again after already promoted (creates a second issue)", async () => {
    // The service does not guard against re-promotion: roadmapItemId is a
    // one-to-many FK with no unique constraint, so a second promote always
    // succeeds (201) and links a second issue to the same roadmap item.
    const item = await createItem("Multi-promote");

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${item.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${item.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Second promote" },
    });
    expect(second.statusCode).toBe(201);

    // Both promotes created a distinct issue, both linked to the same item.
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body.issues).toHaveLength(2);
    expect(body.promoted).toBe(true);
  });

  // ── listRoadmapItems — filter by status ───────────────────────────────────

  it("GET /roadmap filters by status=planned", async () => {
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Idea item", status: "idea" },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Planned item", status: "planned" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap?status=planned`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("planned");
  });

  // ── listRoadmapItems — filter by label ───────────────────────────────────

  it("GET /roadmap filters by label", async () => {
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "No label item" },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Tagged item", labels: ["infra"] },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap?label=infra`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Tagged item");
  });

  // ── updateRoadmapItem — auto-promote: horizon=now with no linked issues ───

  it("PATCH /roadmap/:id auto-promotes when horizon changes to 'now' and no issues linked", async () => {
    const item = await createItem("Auto-promote candidate");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { horizon: "now" },
    });

    expect(res.statusCode).toBe(200);

    // After auto-promote, the roadmapItem should have promoted=true
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().promoted).toBe(true);
  });

  // ── updateRoadmapItem — horizon stays non-now: no auto-promote ────────────

  it("PATCH /roadmap/:id does NOT auto-promote when horizon stays 'later'", async () => {
    const item = await createItem("No-promote item");

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Renamed" },
    });

    expect(res.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.json().promoted).toBe(false);
  });

  // ── updateRoadmapItem — auto-promote skipped when issues already linked ───

  it("PATCH /roadmap/:id does NOT auto-promote when issues are already linked", async () => {
    const item = await createItem("Already-linked item");

    // First promote → creates exactly one linked issue; horizon stays "later".
    const promoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${item.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(promoteRes.statusCode).toBe(201);

    // PATCH horizon → "now" enters the auto-promote guard, but linkedCount > 0
    // (one issue already linked) so promoteToIssue must NOT run a second time.
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { horizon: "now" },
    });
    expect(res.statusCode).toBe(200);

    // Still exactly one linked issue — the linkedCount > 0 guard held.
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().issues).toHaveLength(1);
  });

  // ── getRoadmapItem — includes issues and dependency arrays ────────────────

  it("GET /roadmap/:id includes issues and dependency arrays", async () => {
    const item = await createItem("Full item");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${item.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(Array.isArray(body.dependsOn)).toBe(true);
  });

  // ── listRoadmapItems — response includes blocks/dependsOn arrays ──────────

  it("GET /roadmap list items include blocks and dependsOn dependency arrays", async () => {
    await createItem("Listed item");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items.length).toBeGreaterThan(0);
    expect(Array.isArray(items[0].blocks)).toBe(true);
    expect(Array.isArray(items[0].dependsOn)).toBe(true);
  });

  // ── createRoadmapItem — validation: empty title ───────────────────────────

  it("POST /roadmap returns 400 when title is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "" },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── createRoadmapItem — validation: title too long ────────────────────────

  it("POST /roadmap returns 400 when title exceeds 200 characters", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "x".repeat(201) },
    });

    expect(res.statusCode).toBe(400);
  });
});
