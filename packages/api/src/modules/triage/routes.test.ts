import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  generateTestToken,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

describe("triage HTTP capabilities", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });
  beforeEach(cleanDatabase);

  it("preserves cookie scope across search, preview, and persistence", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.userId, role: "member" },
    });
    await prisma.triagePolicy.create({
      data: { workspaceId: workspace.id, version: "policy-v1" },
    });
    const target = await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Login failure",
        priority: "high",
      },
    });
    await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-2`,
        sequenceNum: 2,
        title: "Login failure duplicate",
      },
    });
    const cookie = `kanon_at=${generateTestToken({
      userId: member.userId,
      allowedProjectIds: [project.id],
    })}`;

    const search = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/issue-search.v1`,
      headers: { cookie },
      payload: { q: "login", scope: { kind: "project" }, targetIssueId: target.id },
    });
    const preview = await app.inject({
      method: "POST",
      url: `/api/issues/${target.key}/triage/preview`,
      headers: { cookie },
      payload: { phase: "prepare" },
    });
    const persisted = await app.inject({
      method: "POST",
      url: `/api/issues/${target.key}/triage-proposals`,
      headers: { cookie },
      payload: { preview: preview.json(), previewSeal: preview.json().previewSeal },
    });

    expect(search.statusCode, JSON.stringify(search.json())).toBe(200);
    expect(preview.statusCode).toBe(200);
    expect(persisted.statusCode).toBe(201);

    const unscoped = await app.inject({
      method: "POST",
      url: `/api/issues/${target.key}/triage/preview`,
      headers: { cookie: `kanon_at=${member.token}` },
      payload: { phase: "prepare" },
    });
    expect(unscoped.statusCode).toBe(200);

    const hiddenCookie = `kanon_at=${generateTestToken({
      userId: member.userId,
      allowedProjectIds: [randomUUID()],
    })}`;
    const hidden = await app.inject({
      method: "POST",
      url: `/api/issues/${target.key}/triage/preview`,
      headers: { cookie: hiddenCookie },
      payload: { phase: "prepare" },
    });
    expect(hidden.statusCode).toBe(404);

    const emptyCookie = `kanon_at=${generateTestToken({ userId: member.userId, allowedProjectIds: [] })}`;
    const emptySearch = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspace.id}/issue-search.v1`,
      headers: { cookie: emptyCookie },
      payload: { q: "login", scope: { kind: "project" }, targetIssueId: target.id },
    });
    expect(emptySearch.statusCode).toBe(200);
  });
});
