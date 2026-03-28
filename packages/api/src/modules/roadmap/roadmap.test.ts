import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";

describe("Roadmap API", () => {
  let app: FastifyInstance;
  let projectKey: string;
  let token: string;
  let memberId: string;

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
    const project = await seedTestProject(ws.id);

    projectKey = project.key;
    token = member.token;
    memberId = member.id;
  });

  // ── Create ──────────────────────────────────────────────────────────────

  it("POST /api/projects/:key/roadmap creates a roadmap item with all fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Add dark mode",
        description: "Full dark mode support",
        horizon: "next",
        effort: 3,
        impact: 4,
        labels: ["ui", "theme"],
        sortOrder: 1,
        targetDate: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Add dark mode");
    expect(body.description).toBe("Full dark mode support");
    expect(body.horizon).toBe("next");
    expect(body.effort).toBe(3);
    expect(body.impact).toBe(4);
    expect(body.labels).toEqual(["ui", "theme"]);
    expect(body.sortOrder).toBe(1);
    expect(body.targetDate).toBeDefined();
    expect(new Date(body.targetDate).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(body.promoted).toBe(false);
    expect(body.id).toBeDefined();
  });

  it("POST /api/projects/:key/roadmap defaults horizon to later", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Default horizon item" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().horizon).toBe("later");
  });

  // ── List ────────────────────────────────────────────────────────────────

  it("GET /api/projects/:key/roadmap lists items", async () => {
    // Create two items
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Item A", horizon: "now" },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Item B", horizon: "later" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items).toHaveLength(2);
  });

  it("GET /api/projects/:key/roadmap filters by horizon", async () => {
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Now item", horizon: "now" },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Later item", horizon: "later" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap?horizon=now`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const items = res.json();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Now item");
  });

  // ── Get ─────────────────────────────────────────────────────────────────

  it("GET /api/projects/:key/roadmap/:id returns a single item", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Get me", horizon: "next" },
    });
    const created = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(created.id);
    expect(body.title).toBe("Get me");
    expect(body.issues).toBeDefined(); // includes linked issues
  });

  // ── Update ──────────────────────────────────────────────────────────────

  it("PATCH /api/projects/:key/roadmap/:id updates fields including targetDate", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Original", horizon: "someday", effort: 1, impact: 1 },
    });
    const created = createRes.json();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Updated",
        horizon: "now",
        effort: 5,
        impact: 5,
        targetDate: "2026-12-31T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("Updated");
    expect(body.horizon).toBe("now");
    expect(body.effort).toBe(5);
    expect(body.impact).toBe(5);
    expect(new Date(body.targetDate).toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("PATCH /api/projects/:key/roadmap/:id can clear targetDate with null", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "Has date", targetDate: "2026-06-01T00:00:00.000Z" },
    });
    const created = createRes.json();

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectKey}/roadmap/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { targetDate: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targetDate).toBeNull();
  });

  // ── Delete ──────────────────────────────────────────────────────────────

  it("DELETE /api/projects/:key/roadmap/:id deletes the item and nullifies issue FK", async () => {
    // Create roadmap item
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "To delete" },
    });
    const roadmapItem = createRes.json();

    // Promote to issue to create an FK link
    const promoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(promoteRes.statusCode).toBe(201);
    const issue = promoteRes.json();

    // Delete the roadmap item
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify GET returns 404
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(404);

    // Verify the issue still exists but roadmapItemId is nullified
    const issueRes = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(issueRes.statusCode).toBe(200);
    expect(issueRes.json().roadmapItemId).toBeNull();
  });

  // ── Promote ─────────────────────────────────────────────────────────────

  it("POST /api/projects/:key/roadmap/:id/promote creates an issue and marks promoted", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Promotable item",
        description: "Will become an issue",
        labels: ["roadmap"],
      },
    });
    const roadmapItem = createRes.json();

    const promoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}/promote`,
      headers: { authorization: `Bearer ${token}` },
      payload: { type: "feature", priority: "high" },
    });

    expect(promoteRes.statusCode).toBe(201);
    const issue = promoteRes.json();
    expect(issue.title).toBe("Promotable item");
    expect(issue.key).toMatch(new RegExp(`^${projectKey}-\\d+$`));
    expect(issue.roadmapItemId).toBe(roadmapItem.id);

    // Verify roadmap item is now marked as promoted
    const itemRes = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/roadmap/${roadmapItem.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(itemRes.json().promoted).toBe(true);
  });
});
