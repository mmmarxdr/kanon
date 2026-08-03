import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../prisma/migrations/20260803135500_redmine_inbound_bootstrap_state/migration.sql",
);

async function fixture() {
  const workspace = await seedTestWorkspace();
  const project = await seedTestProject(workspace.id);
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://redmine.example",
      workspaceId: workspace.id,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "41",
      readMap: {},
      writeMap: {},
    },
  });
  return { workspace, binding };
}

describe("Redmine inbound bootstrap persistence", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestDb();
  });

  it("keeps existing outbound bindings inert by default", async () => {
    const { binding } = await fixture();

    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({
      inboundEnabled: false,
      bootstrapState: "not_required",
      bootstrapCutoff: null,
      bootstrapPageToken: null,
      bootstrapLeaseToken: null,
      bootstrapLeaseUntil: null,
      bootstrapFence: 0,
      auditCursorRemoteId: null,
      auditCompletedAt: null,
    });
  });

  it("retains remote principals when no member exists or a linked member is deleted", async () => {
    const { workspace, binding } = await fixture();
    const unlinked = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        remoteUserId: "remote-17",
        remoteLogin: "remote-user",
        remoteDisplayName: "Remote User",
        memberId: null,
      },
    });
    const member = await seedTestMember(workspace.id);
    const linked = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        remoteUserId: "remote-18",
        remoteDisplayName: "Former Member",
        memberId: member.id,
      },
    });

    await prisma.member.delete({ where: { id: member.id } });

    await expect(
      prisma.integrationExternalIdentity.findUniqueOrThrow({ where: { id: unlinked.id } }),
    ).resolves.toMatchObject({ memberId: null, remoteDisplayName: "Remote User" });
    await expect(
      prisma.integrationExternalIdentity.findUniqueOrThrow({ where: { id: linked.id } }),
    ).resolves.toMatchObject({ memberId: null, remoteDisplayName: "Former Member" });
  });

  it("deduplicates one source version within its parent scope", async () => {
    const { binding } = await fixture();
    const application = {
      bindingId: binding.id,
      remoteEntityType: "comment",
      remoteParentType: "issue",
      remoteParentId: "100",
      remoteId: "900",
      sourceVersion: "sha256:version-1",
      remoteUpdatedAt: new Date("2026-08-03T10:00:00.000Z"),
      applicationKey: randomUUID(),
      correlationId: randomUUID(),
    };
    await prisma.integrationInboundApplication.create({ data: application });

    await expect(
      prisma.integrationInboundApplication.create({
        data: {
          ...application,
          remoteUpdatedAt: new Date("2026-08-03T10:01:00.000Z"),
          applicationKey: randomUUID(),
          correlationId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.integrationInboundApplication.create({
        data: {
          ...application,
          remoteParentId: "101",
          applicationKey: randomUUID(),
          correlationId: randomUUID(),
        },
      }),
    ).resolves.toMatchObject({ remoteParentId: "101" });
  });

  it("fences concurrent bootstrap claims atomically", async () => {
    const { binding } = await fixture();

    await Promise.all([
      prisma.integrationProjectBinding.update({
        where: { id: binding.id },
        data: { bootstrapFence: { increment: 1 } },
      }),
      prisma.integrationProjectBinding.update({
        where: { id: binding.id },
        data: { bootstrapFence: { increment: 1 } },
      }),
    ]);

    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ bootstrapFence: 2 });
  });

  it("keeps the generated migration free of data-destructive operations", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).not.toMatch(/\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|RENAME)\b/i);
    expect(sql).toContain('DEFAULT \'not_required\'');
    expect(sql).toContain('DEFAULT false');
    expect(sql).toContain("ON DELETE SET NULL");
  });
});
