import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkspace,
} from "../../test/helpers.js";

describe("issue deletion HTTP API", () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(cleanDatabase);
  afterAll(async () => { await app.close(); await disconnectTestDb(); });

  it("derives capability from the project role and enforces admin authorization", async () => {
    const workspace = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(workspace.id, "admin");
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id, "DEL");
    await seedTestProjectMember(admin.userId, project.id, "admin");
    await seedTestProjectMember(member.userId, project.id, "member");
    const issue = await prisma.issue.create({
      data: { key: "DEL-1", sequenceNum: 1, title: "Protected", projectId: project.id },
    });

    const memberDetail = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(memberDetail.json().deleteCapability).toEqual({ allowed: false, redmineLinked: false });

    const forbidden = await app.inject({
      method: "DELETE",
      url: `/api/issues/${issue.key}`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);

    const adminDetail = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(adminDetail.json().deleteCapability).toEqual({ allowed: true, redmineLinked: false });

    const connection = await prisma.integrationConnection.create({
      data: {
        provider: "redmine",
        baseUrl: "https://redmine.example.test",
        lifecycle: "active",
        workspaceId: workspace.id,
      },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "remote-del",
        readMap: {},
        writeMap: {},
        lifecycle: "active",
      },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "issue",
        entityId: issue.id,
        externalId: "1",
      },
    });
    const linkedDetail = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(linkedDetail.json().deleteCapability).toEqual({ allowed: true, redmineLinked: true });

    const linkedDelete = await app.inject({
      method: "DELETE",
      url: `/api/issues/${issue.key}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {},
    });
    expect(linkedDelete.statusCode).toBe(409);
    expect(linkedDelete.json().code).toBe("REMOTE_DELETE_UNAVAILABLE");
    await expect(prisma.issue.findUnique({ where: { id: issue.id } })).resolves.not.toBeNull();
  });

  it("enforces the critical issue key at the HTTP boundary and then deletes", async () => {
    const workspace = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(workspace.id, "admin");
    const project = await seedTestProject(workspace.id, "KEY");
    await seedTestProjectMember(admin.userId, project.id, "admin");
    await prisma.issue.create({
      data: { key: "KEY-7", sequenceNum: 7, title: "Critical", priority: "critical", projectId: project.id },
    });

    const mismatch = await app.inject({
      method: "DELETE",
      url: "/api/issues/KEY-7",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmationKey: "key-7" },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().code).toBe("ISSUE_CONFIRMATION_KEY_MISMATCH");

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/issues/KEY-7",
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { confirmationKey: "KEY-7" },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      deletedIssueKey: "KEY-7",
      remoteDeleteQueued: false,
      detachedTimeEntryCount: 0,
    });
  });

  it("deletes only the exact issue identity resolved by the authorization middleware", async () => {
    const workspace = await seedTestWorkspace();
    const projectAdmin = await seedTestMemberWithRole(workspace.id, "member");
    const authorizedProject = await seedTestProject(workspace.id, "AUT");
    const replacementProject = await seedTestProject(workspace.id, "REP");
    await seedTestProjectMember(projectAdmin.userId, authorizedProject.id, "admin");
    const replacement = await prisma.issue.create({
      data: {
        key: "REP-1",
        sequenceNum: 1,
        title: "Unauthorized replacement",
        projectId: replacementProject.id,
      },
    });
    const authorizedId = randomUUID();
    const gateLookup = vi.spyOn(prisma.issue, "findFirst").mockResolvedValueOnce({
      id: authorizedId,
      project: { id: authorizedProject.id, workspaceId: workspace.id },
    } as never);

    const response = await app.inject({
      method: "DELETE",
      url: `/api/issues/${replacement.key}`,
      headers: { authorization: `Bearer ${projectAdmin.token}` },
      payload: {},
    });
    gateLookup.mockRestore();

    expect(response.statusCode).toBe(404);
    await expect(prisma.issue.findUnique({ where: { id: replacement.id } })).resolves.not.toBeNull();
  });
});
