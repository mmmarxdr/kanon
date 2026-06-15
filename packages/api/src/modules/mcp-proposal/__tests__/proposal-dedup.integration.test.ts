import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

/**
 * KAN-116: partial unique index — at most one PENDING GENERIC McpProposal per
 * target_ref (multi-instance dedup backstop). Each test pins one clause of the
 * index predicate via POST /api/workspaces/:id/proposals, which now maps the
 * resulting P2002 to a 409.
 *
 *   A  duplicate pending generic + same targetRef  → 409   (constraint fires)
 *   B  same targetRef, different kind              → 201   (kind = 'generic')
 *   C  generic + NULL targetRef, twice             → 201   (NULLs are distinct)
 *   D  first leaves 'pending', then re-create      → 201   (status = 'pending')
 *   E  same targetRef in a DIFFERENT workspace     → 201   (key is workspace_id, target_ref)
 */
describe("KAN-116: McpProposal pending-generic dedup", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let token: string;

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
    const ws = await seedTestWorkspace(`k116${Math.random().toString(36).slice(2, 7)}`);
    workspaceId = ws.id;
    const member = await seedTestMemberWithRole(workspaceId, "member");
    token = member.token;
  });

  function postProposal(body: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
  }

  it("A: a second pending generic proposal for the same targetRef is rejected (409)", async () => {
    const first = await postProposal({ kind: "generic", title: "Slip KAN-42", targetRef: "KAN-42" });
    expect(first.statusCode).toBe(201);

    const dup = await postProposal({ kind: "generic", title: "Slip KAN-42 again", targetRef: "KAN-42" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("PROPOSAL_DUPLICATE");
  });

  it("B: a non-generic proposal with the same targetRef is allowed (index is kind-scoped)", async () => {
    const gen = await postProposal({ kind: "generic", title: "g", targetRef: "KAN-50" });
    expect(gen.statusCode).toBe(201);

    const dep = await postProposal({ kind: "add_dependency", title: "d", targetRef: "KAN-50" });
    expect(dep.statusCode).toBe(201);
  });

  it("C: multiple generic proposals with NULL targetRef coexist (NULLs are distinct)", async () => {
    const a = await postProposal({ kind: "generic", title: "no ref a" });
    const b = await postProposal({ kind: "generic", title: "no ref b" });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
  });

  it("D: once the first leaves 'pending', a fresh generic proposal for the same ref is allowed", async () => {
    const first = await postProposal({ kind: "generic", title: "g", targetRef: "KAN-60" });
    expect(first.statusCode).toBe(201);

    await prisma.mcpProposal.update({
      where: { id: first.json().id },
      data: { status: "dismissed", dismissedAt: new Date() },
    });

    const second = await postProposal({ kind: "generic", title: "g2", targetRef: "KAN-60" });
    expect(second.statusCode).toBe(201);
  });

  it("E: the same targetRef in a DIFFERENT workspace is allowed (dedup is tenant-local)", async () => {
    // Workspace A (from beforeEach) takes targetRef "KAN-99".
    const inA = await postProposal({ kind: "generic", title: "A", targetRef: "KAN-99" });
    expect(inA.statusCode).toBe(201);

    // A second workspace with the SAME targetRef must NOT collide — issue keys are
    // unique only per-workspace, so a global index would wrongly 409 here.
    const wsB = await seedTestWorkspace(`k116b${Math.random().toString(36).slice(2, 7)}`);
    const memberB = await seedTestMemberWithRole(wsB.id, "member");
    const inB = await app.inject({
      method: "POST",
      url: `/api/workspaces/${wsB.id}/proposals`,
      headers: { authorization: `Bearer ${memberB.token}` },
      payload: { kind: "generic", title: "B", targetRef: "KAN-99" },
    });
    expect(inB.statusCode).toBe(201);
  });
});
