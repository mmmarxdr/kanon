/**
 * ProjectMember model tests (TDD: RED → GREEN → REFACTOR)
 *
 * Self-contained — does NOT import helpers.ts (which pulls in buildApp →
 * @kanon/bridge, unbuilt in this environment). Uses prisma directly.
 *
 * Phase 1 (1.1): Schema introspection — model presence (RED before schema updated).
 * Phase 2 (2.2): Backfill correctness — member|viewer get rows, owner|admin do not.
 * Phase 2 (2.5): Backfill idempotency — running twice produces no duplicates.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/config/prisma.js";

const { datamodel } = Prisma.dmmf;

// ─── Helpers ────────────────────────────────────────────────────────────────

function findModel(name: string) {
  return datamodel.models.find((m) => m.name === name);
}

function findField(modelName: string, fieldName: string) {
  const model = findModel(modelName);
  return model?.fields.find((f) => f.name === fieldName);
}

async function seedWorkspace() {
  return prisma.workspace.create({
    data: {
      name: "Test Workspace",
      slug: `test-ws-${randomUUID().slice(0, 8)}`,
    },
  });
}

async function seedUser() {
  return prisma.user.create({
    data: {
      email: `test-${randomUUID().slice(0, 8)}@kanon.test`,
      passwordHash: "not-used-in-tests",
    },
  });
}

async function seedMember(
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "member" | "viewer",
) {
  return prisma.member.create({
    data: {
      username: `user-${randomUUID().slice(0, 8)}`,
      role,
      userId,
      workspaceId,
    },
  });
}

async function seedProject(workspaceId: string, key?: string) {
  return prisma.project.create({
    data: {
      key: key ?? `T${randomUUID().slice(0, 3).toUpperCase()}`,
      name: "Test Project",
      workspaceId,
    },
  });
}

async function cleanAll() {
  await prisma.projectMember.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.roadmapItem.deleteMany();
  await prisma.cycle.deleteMany();
  await prisma.project.deleteMany();
  await prisma.member.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
}

// The backfill INSERT — matches migration.sql exactly.
// Sourced here so the test verifies the real statement that runs in production.
const BACKFILL_SQL = `
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), m.user_id, p.id, m.role, now(), now()
FROM members m
JOIN projects p ON p.workspace_id = m.workspace_id
WHERE m.role IN ('member', 'viewer')
ON CONFLICT (user_id, project_id) DO NOTHING
`;

// ─── Phase 1: Schema introspection (task 1.1 RED / 1.4 GREEN) ──────────────

describe("ProjectMember model — schema introspection", () => {
  it("ProjectMember model exists in the Prisma datamodel", () => {
    expect(findModel("ProjectMember"), "ProjectMember model not found in dmmf").toBeDefined();
  });

  it("has id field of type String (uuid, @id)", () => {
    const field = findField("ProjectMember", "id");
    expect(field, "id field missing").toBeDefined();
    expect(field?.type).toBe("String");
    expect(field?.isId).toBe(true);
  });

  it("has userId field of type String (required)", () => {
    const field = findField("ProjectMember", "userId");
    expect(field, "userId field missing").toBeDefined();
    expect(field?.type).toBe("String");
    expect(field?.isRequired).toBe(true);
  });

  it("has projectId field of type String (required)", () => {
    const field = findField("ProjectMember", "projectId");
    expect(field, "projectId field missing").toBeDefined();
    expect(field?.type).toBe("String");
    expect(field?.isRequired).toBe(true);
  });

  it("has role field of type MemberRole (required)", () => {
    const field = findField("ProjectMember", "role");
    expect(field, "role field missing").toBeDefined();
    expect(field?.type).toBe("MemberRole");
    expect(field?.isRequired).toBe(true);
  });

  it("has createdAt field of type DateTime", () => {
    const field = findField("ProjectMember", "createdAt");
    expect(field, "createdAt field missing").toBeDefined();
    expect(field?.type).toBe("DateTime");
  });

  it("has updatedAt field of type DateTime", () => {
    const field = findField("ProjectMember", "updatedAt");
    expect(field, "updatedAt field missing").toBeDefined();
    expect(field?.type).toBe("DateTime");
  });

  it("has user relation to User model", () => {
    const field = findField("ProjectMember", "user");
    expect(field, "user relation field missing").toBeDefined();
    expect(field?.type).toBe("User");
  });

  it("has project relation to Project model", () => {
    const field = findField("ProjectMember", "project");
    expect(field, "project relation field missing").toBeDefined();
    expect(field?.type).toBe("Project");
  });

  it("User model has projectMembers back-relation", () => {
    const field = findField("User", "projectMembers");
    expect(field, "User.projectMembers back-relation missing").toBeDefined();
    expect(field?.type).toBe("ProjectMember");
    expect(field?.isList).toBe(true);
  });

  it("Project model has projectMembers back-relation", () => {
    const field = findField("Project", "projectMembers");
    expect(field, "Project.projectMembers back-relation missing").toBeDefined();
    expect(field?.type).toBe("ProjectMember");
    expect(field?.isList).toBe(true);
  });
});

// ─── Phase 1: Unique constraint (R-KAN14 §duplicate-rejected) ───────────────

describe("ProjectMember — unique constraint", () => {
  beforeEach(async () => {
    await cleanAll();
  });

  afterAll(async () => {
    await cleanAll();
  });

  it("rejects a duplicate (userId, projectId) insert", async () => {
    const ws = await seedWorkspace();
    const user = await seedUser();
    await seedMember(ws.id, user.id, "member");
    const project = await seedProject(ws.id);

    await prisma.projectMember.create({
      data: { userId: user.id, projectId: project.id, role: "member" },
    });

    await expect(
      prisma.projectMember.create({
        data: { userId: user.id, projectId: project.id, role: "viewer" },
      }),
    ).rejects.toThrow();
  });

  it("allows distinct users to have rows for the same project", async () => {
    const ws = await seedWorkspace();
    const u1 = await seedUser();
    const u2 = await seedUser();
    await seedMember(ws.id, u1.id, "member");
    await seedMember(ws.id, u2.id, "member");
    const project = await seedProject(ws.id);

    await prisma.projectMember.create({
      data: { userId: u1.id, projectId: project.id, role: "member" },
    });
    await expect(
      prisma.projectMember.create({
        data: { userId: u2.id, projectId: project.id, role: "member" },
      }),
    ).resolves.toBeDefined();
  });
});

// ─── Phase 2: Backfill correctness (R-KAN15, task 2.2) ──────────────────────

describe("ProjectMember — backfill correctness", () => {
  beforeEach(async () => {
    await cleanAll();
  });

  afterAll(async () => {
    await cleanAll();
  });

  it("creates rows for member and viewer workspace roles", async () => {
    const ws = await seedWorkspace();
    const uMember = await seedUser();
    const uViewer = await seedUser();
    await seedMember(ws.id, uMember.id, "member");
    await seedMember(ws.id, uViewer.id, "viewer");
    const project = await seedProject(ws.id);

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const memberRow = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: uMember.id, projectId: project.id } },
    });
    expect(memberRow, "member should have a ProjectMember row").not.toBeNull();
    expect(memberRow?.role).toBe("member");

    const viewerRow = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: uViewer.id, projectId: project.id } },
    });
    expect(viewerRow, "viewer should have a ProjectMember row").not.toBeNull();
    expect(viewerRow?.role).toBe("viewer");
  });

  it("creates a row for each project in the workspace", async () => {
    const ws = await seedWorkspace();
    const uMember = await seedUser();
    await seedMember(ws.id, uMember.id, "member");
    const p1 = await seedProject(ws.id, "BP1");
    const p2 = await seedProject(ws.id, "BP2");

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const count = await prisma.projectMember.count({ where: { userId: uMember.id } });
    expect(count).toBe(2);

    const p1Row = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: uMember.id, projectId: p1.id } },
    });
    expect(p1Row).not.toBeNull();

    const p2Row = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: uMember.id, projectId: p2.id } },
    });
    expect(p2Row).not.toBeNull();
  });

  it("does NOT create rows for owner or admin workspace roles", async () => {
    const ws = await seedWorkspace();
    const uOwner = await seedUser();
    const uAdmin = await seedUser();
    await seedMember(ws.id, uOwner.id, "owner");
    await seedMember(ws.id, uAdmin.id, "admin");
    const _project = await seedProject(ws.id);

    await prisma.$executeRawUnsafe(BACKFILL_SQL);

    const ownerCount = await prisma.projectMember.count({ where: { userId: uOwner.id } });
    expect(ownerCount).toBe(0);

    const adminCount = await prisma.projectMember.count({ where: { userId: uAdmin.id } });
    expect(adminCount).toBe(0);
  });
});

// ─── Phase 2: Backfill idempotency (R-KAN15 §backfill-idempotent, task 2.5) ─

describe("ProjectMember — backfill idempotency", () => {
  beforeEach(async () => {
    await cleanAll();
  });

  afterAll(async () => {
    await cleanAll();
  });

  it("running backfill twice produces no duplicate rows and no error", async () => {
    const ws = await seedWorkspace();
    const u1 = await seedUser();
    const u2 = await seedUser();
    await seedMember(ws.id, u1.id, "member");
    await seedMember(ws.id, u2.id, "viewer");
    await seedProject(ws.id);

    await expect(prisma.$executeRawUnsafe(BACKFILL_SQL)).resolves.not.toThrow();
    const countAfterFirst = await prisma.projectMember.count();
    expect(countAfterFirst).toBeGreaterThan(0);

    await expect(prisma.$executeRawUnsafe(BACKFILL_SQL)).resolves.not.toThrow();
    const countAfterSecond = await prisma.projectMember.count();

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
