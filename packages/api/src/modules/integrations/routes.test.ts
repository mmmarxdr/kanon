import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  generateTestToken,
  seedTestMemberWithRole,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { retryRedmineIssueImport } from "./inbound.js";

vi.mock("./inbound.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inbound.js")>()),
  retryRedmineIssueImport: vi.fn(),
}));

const retry = vi.mocked(retryRedmineIssueImport);

describe("integration retry route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    retry.mockReset();
    await cleanDatabase();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("requires authentication and validates the application identifier", async () => {
    const connectionId = randomUUID();
    const bindingId = randomUUID();
    const applicationId = randomUUID();
    const path = `/api/integrations/connections/${connectionId}/bindings/${bindingId}/inbound/applications/${applicationId}/retry`;

    const unauthenticated = await app.inject({ method: "POST", url: path });
    expect(unauthenticated.statusCode).toBe(401);
    expect(retry).not.toHaveBeenCalled();

    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const invalid = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${connectionId}/bindings/${bindingId}/inbound/applications/not-a-uuid/retry`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(invalid.statusCode).toBe(400);
    expect(retry).not.toHaveBeenCalled();
  });

  it("wires identifiers, user scope, and the successful response", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const connectionId = randomUUID();
    const bindingId = randomUUID();
    const applicationId = randomUUID();
    const allowedProjectId = randomUUID();
    const token = generateTestToken({
      userId: owner.userId,
      allowedProjectIds: [allowedProjectId],
    });
    const result = { applicationId, state: "applied" as const, issueKey: "KAN-1" };
    retry.mockResolvedValue(result);

    const response = await app.inject({
      method: "POST",
      url: `/api/integrations/connections/${connectionId}/bindings/${bindingId}/inbound/applications/${applicationId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(retry).toHaveBeenCalledWith(connectionId, bindingId, applicationId, owner.userId, {
      allowedProjectIds: [allowedProjectId],
    });
  });
});
