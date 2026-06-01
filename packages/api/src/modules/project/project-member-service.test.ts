import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Prisma mock ───────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {},
}));

import { createProjectMembersInTx } from "./project-member-service.js";

// ── Shared test data ──────────────────────────────────────────────────────────
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";
const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STALE_PROJECT = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeTx(liveProjectIds: string[] = []) {
  return {
    project: {
      findMany: vi.fn().mockResolvedValue(liveProjectIds.map((id) => ({ id }))),
    },
    projectMember: {
      createMany: vi.fn().mockResolvedValue({ count: liveProjectIds.length }),
    },
  };
}

// ── createProjectMembersInTx() ────────────────────────────────────────────────

describe("createProjectMembersInTx()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 4.1-T1: empty assignments → no-op (no DB calls)
  it("empty assignments → no-op, no DB calls", async () => {
    const tx = makeTx();

    await createProjectMembersInTx(tx as any, USER_ID, [], WORKSPACE_ID);

    expect(tx.project.findMany).not.toHaveBeenCalled();
    expect(tx.projectMember.createMany).not.toHaveBeenCalled();
  });

  // 4.1-T2: stale projectId (not in workspace) → skipped, no createMany call
  it("stale projectId → skipped silently, createMany not called", async () => {
    const tx = makeTx([]); // no live projects returned

    await createProjectMembersInTx(
      tx as any,
      USER_ID,
      [{ projectId: STALE_PROJECT, role: "member" }],
      WORKSPACE_ID,
    );

    expect(tx.project.findMany).toHaveBeenCalledWith({
      where: { id: { in: [STALE_PROJECT] }, workspaceId: WORKSPACE_ID },
      select: { id: true },
    });
    // All filtered out → nothing to create
    expect(tx.projectMember.createMany).not.toHaveBeenCalled();
  });

  // 4.1-T3: valid assignments → createMany called with userId (not Member.id)
  it("valid assignments → createMany called with correct userId and data", async () => {
    const tx = makeTx([PROJECT_A, PROJECT_B]);

    await createProjectMembersInTx(
      tx as any,
      USER_ID,
      [
        { projectId: PROJECT_A, role: "member" },
        { projectId: PROJECT_B, role: "viewer" },
      ],
      WORKSPACE_ID,
    );

    expect(tx.projectMember.createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER_ID, projectId: PROJECT_A, role: "member" },
        { userId: USER_ID, projectId: PROJECT_B, role: "viewer" },
      ],
      skipDuplicates: true,
    });
  });

  // 4.1-T4: mixed valid + stale → only valid rows passed to createMany
  it("mixed valid+stale → only live rows in createMany", async () => {
    const tx = makeTx([PROJECT_A]); // PROJECT_B stale

    await createProjectMembersInTx(
      tx as any,
      USER_ID,
      [
        { projectId: PROJECT_A, role: "admin" },
        { projectId: STALE_PROJECT, role: "member" },
      ],
      WORKSPACE_ID,
    );

    expect(tx.projectMember.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID, projectId: PROJECT_A, role: "admin" }],
      skipDuplicates: true,
    });
  });

  // 4.1-T5: idempotency — skipDuplicates prevents error on re-apply
  it("skipDuplicates: true ensures duplicate rows cause no error", async () => {
    const tx = makeTx([PROJECT_A]);
    // createMany with skipDuplicates won't throw even if row already exists
    tx.projectMember.createMany.mockResolvedValue({ count: 0 }); // 0 = row already existed

    await expect(
      createProjectMembersInTx(
        tx as any,
        USER_ID,
        [{ projectId: PROJECT_A, role: "member" }],
        WORKSPACE_ID,
      ),
    ).resolves.toBeUndefined();

    expect(tx.projectMember.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  // 4.1-T6: R-INV-inv userId discipline — userId param used, not any other id
  it("R-INV-inv: uses the userId param (not any Member.id)", async () => {
    const tx = makeTx([PROJECT_A]);
    const MEMBER_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff"; // different from USER_ID

    await createProjectMembersInTx(
      tx as any,
      USER_ID, // this is what must end up in the rows
      [{ projectId: PROJECT_A, role: "member" }],
      WORKSPACE_ID,
    );

    const call = tx.projectMember.createMany.mock.calls[0][0];
    expect(call.data[0].userId).toBe(USER_ID);
    expect(call.data[0].userId).not.toBe(MEMBER_ID);
  });
});
