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

describe("Bounded Issue Search API", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberId: string;
  let memberToken: string;
  let projectKey: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace("Search Workspace");
    workspaceId = ws.id;

    const user = await seedTestMemberWithRole(workspaceId, "admin", "search-admin@example.com");
    memberId = user.id;
    memberToken = user.token;

    const project = await seedTestProject(workspaceId, "SRC");
    projectKey = project.key;
    await seedTestProjectMember(user.userId, project.id, "admin");
  });

  it("should return 400 for NFKC query normalization exceeding 12 tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/issue-search.v1`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        q: "one two three four five six seven eight nine ten eleven twelve thirteen",
        scope: { kind: "workspace", workspaceId },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
