import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { seedTestIssue } from "../../test/helpers.js";
import { removeMember } from "../member/service.js";
import { proveExternalRefBindings } from "./backfill.js";
import { ProviderDispatchError } from "./core/types.js";
import {
  connectCredential,
  unbindProject,
  type ConnectionServiceDeps,
} from "./service.js";
import { runIntegrationWorkerCycle } from "./worker.js";

const workspaceIds = new Set<string>();
const userIds = new Set<string>();

async function fixture() {
  const workspace = await prisma.workspace.create({ data: { name: "Delete worker", slug: `dw-${randomUUID()}` } });
  workspaceIds.add(workspace.id);
  const project = await prisma.project.create({ data: { key: `W${randomUUID().slice(0, 4).toUpperCase()}`, name: "Worker", workspaceId: workspace.id } });
  const connection = await prisma.integrationConnection.create({ data: { provider: "redmine", baseUrl: "https://redmine.example.test", lifecycle: "active", workspaceId: workspace.id } });
  const binding = await prisma.integrationProjectBinding.create({ data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "rp", readMap: {}, writeMap: {}, lifecycle: "active" } });
  const user = await prisma.user.create({ data: { email: `dw-${randomUUID()}@kanon.test`, passwordHash: "unused" } });
  userIds.add(user.id);
  const member = await prisma.member.create({ data: { username: `dw-${randomUUID().slice(0, 6)}`, role: "owner", userId: user.id, workspaceId: workspace.id } });
  const actorUser = await prisma.user.create({ data: { email: `dw-owner-${randomUUID()}@kanon.test`, passwordHash: "unused" } });
  userIds.add(actorUser.id);
  const actorMember = await prisma.member.create({ data: { username: `dw-owner-${randomUUID().slice(0, 6)}`, role: "owner", userId: actorUser.id, workspaceId: workspace.id } });
  const credential = await prisma.memberIntegrationCredential.create({ data: { encryptedKey: "encrypted", lastAuthStatus: "valid", connectionId: connection.id, memberId: member.id } });
  const issue = await seedTestIssue(project.id);
  const issueId = issue.id;
  const ref = await prisma.externalRef.create({ data: { connectionId: connection.id, bindingId: binding.id, entityType: "issue", entityId: issueId, externalId: "42" } });
  const work = await prisma.integrationSyncWork.create({
    data: {
      bindingId: binding.id,
      entityType: "issue",
      entityId: issueId,
      direction: "outbound",
      operation: "delete",
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
      actorKey: `member:${member.id}`,
      actorKind: "user",
      payload: { version: 1, refId: ref.id, externalId: ref.externalId, issueKey: `${project.key}-1` },
      correlationId: randomUUID(),
      authCredentialId: credential.id,
      refId: ref.id,
      epoch: binding.lifecycleEpoch,
      availableAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  });
  await prisma.issue.delete({ where: { id: issue.id } });
  return { workspace, project, connection, binding, user, member, actorUser, actorMember, credential, ref, work };
}

beforeEach(() => prisma.integrationSyncWork.deleteMany());
afterEach(async () => {
  for (const workspaceId of workspaceIds) await prisma.workspace.delete({ where: { id: workspaceId } });
  workspaceIds.clear();
  for (const userId of userIds) await prisma.user.delete({ where: { id: userId } });
  userIds.clear();
});
afterAll(() => prisma.$disconnect());

describe("issue remote-delete worker", () => {
  it("deletes with the local Issue absent and cleans the retained reference", async () => {
    const value = await fixture();
    const deleteIssue = vi.fn().mockResolvedValue({ externalId: "42", requestedStatusId: null, achievedStatusId: null, remoteVersion: null, deleted: true });

    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();

    await runIntegrationWorkerCycle(prisma, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      decrypt: () => "api-key",
      createAdapter: () => ({ ensureProject: vi.fn(), ensureCycle: vi.fn(), pushIssue: vi.fn(), reconcileCreate: vi.fn(), deleteIssue }),
      limit: 1,
    });

    expect(deleteIssue).toHaveBeenCalledWith("42");
    await expect(prisma.integrationSyncWork.findUnique({ where: { id: value.work.id } })).resolves.toMatchObject({ state: "done", refId: null });
    await expect(prisma.externalRef.findUnique({ where: { id: value.ref.id } })).resolves.toBeNull();
    await expect(proveExternalRefBindings(prisma)).resolves.toBeUndefined();
  });

  it("retains the reference across retry and finalizes on a later idempotent success", async () => {
    const value = await fixture();
    const deleteIssue = vi.fn()
      .mockRejectedValueOnce(new ProviderDispatchError("retry", new Error("network")))
      .mockResolvedValueOnce({ externalId: "42", requestedStatusId: null, achievedStatusId: null, remoteVersion: null, deleted: true });
    const base = {
      decrypt: () => "api-key",
      createAdapter: () => ({ ensureProject: vi.fn(), ensureCycle: vi.fn(), pushIssue: vi.fn(), reconcileCreate: vi.fn(), deleteIssue }),
      jitter: () => 0,
      limit: 1,
    };

    await runIntegrationWorkerCycle(prisma, { ...base, now: () => new Date("2026-08-10T12:00:00.000Z") });
    await expect(prisma.integrationSyncWork.findUnique({ where: { id: value.work.id } })).resolves.toMatchObject({ state: "retry", attempts: 1, refId: value.ref.id });
    await expect(prisma.externalRef.findUnique({ where: { id: value.ref.id } })).resolves.not.toBeNull();

    await runIntegrationWorkerCycle(prisma, { ...base, now: () => new Date("2026-08-10T12:01:00.000Z") });
    expect(deleteIssue).toHaveBeenCalledTimes(2);
    await expect(prisma.integrationSyncWork.findUnique({ where: { id: value.work.id } })).resolves.toMatchObject({ state: "done", refId: null });
  });

  it("keeps retrying with capped backoff after generic exhaustion", async () => {
    const value = await fixture();
    await prisma.integrationSyncWork.update({
      where: { id: value.work.id },
      data: { attempts: 7 },
    });
    const deleteIssue = vi.fn().mockRejectedValue(
      new ProviderDispatchError("retry", new Error("provider unavailable")),
    );

    await runIntegrationWorkerCycle(prisma, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      decrypt: () => "api-key",
      jitter: () => 0,
      createAdapter: () => ({ ensureProject: vi.fn(), ensureCycle: vi.fn(), pushIssue: vi.fn(), reconcileCreate: vi.fn(), deleteIssue }),
      limit: 1,
    });

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: value.work.id } }),
    ).resolves.toMatchObject({ state: "retry", attempts: 8, refId: value.ref.id });
    await expect(prisma.externalRef.findUnique({ where: { id: value.ref.id } })).resolves.not.toBeNull();
  });

  it("keeps non-retryable provider rejections operationally recoverable", async () => {
    const value = await fixture();
    const deleteIssue = vi.fn().mockRejectedValue({
      name: "RedmineHttpError",
      statusCode: 422,
    });

    await runIntegrationWorkerCycle(prisma, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      decrypt: () => "api-key",
      jitter: () => 0,
      createAdapter: () => ({ ensureProject: vi.fn(), ensureCycle: vi.fn(), pushIssue: vi.fn(), reconcileCreate: vi.fn(), deleteIssue }),
      limit: 1,
    });

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: value.work.id } }),
    ).resolves.toMatchObject({ state: "retry", attempts: 1, refId: value.ref.id });
    await expect(prisma.externalRef.findUnique({ where: { id: value.ref.id } })).resolves.not.toBeNull();
  });

  it("preserves revoked-credential deletion work and reconnect redrives it", async () => {
    const value = await fixture();
    await expect(
      removeMember(
        value.workspace.id,
        value.member.id,
        value.actorUser.id,
        value.actorMember.role,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "REMOTE_DELETE_IN_PROGRESS" });
    await expect(prisma.member.findUnique({ where: { id: value.member.id } }))
      .resolves.not.toBeNull();
    await expect(prisma.memberIntegrationCredential.findUnique({ where: { id: value.credential.id } }))
      .resolves.not.toBeNull();
    await prisma.memberIntegrationCredential.update({
      where: { id: value.credential.id },
      data: { revokedAt: new Date("2026-08-10T10:00:00.000Z"), lastAuthStatus: "revoked" },
    });

    await runIntegrationWorkerCycle(prisma, {
      now: () => new Date("2026-08-10T12:00:00.000Z"),
      decrypt: () => "api-key",
      createAdapter: () => ({ ensureProject: vi.fn(), ensureCycle: vi.fn(), pushIssue: vi.fn(), reconcileCreate: vi.fn(), deleteIssue: vi.fn() }),
      limit: 1,
    });

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: value.work.id } }),
    ).resolves.toMatchObject({
      state: "dead",
      skippedReason: "credential_invalid",
      authCredentialId: value.credential.id,
      refId: value.ref.id,
    });
    await expect(
      unbindProject(
        value.connection.id,
        value.binding.id,
        value.user.id,
        value.workspace.id,
      ),
    ).resolves.toMatchObject({ status: "draining" });

    const credentialDeps: ConnectionServiceDeps = {
      remote: () => ({
        whoAmI: async () => ({ id: "remote-user", displayName: "Remote user", login: "remote" }),
        listStatuses: vi.fn(),
        listPriorities: vi.fn(),
        listProjects: vi.fn(),
        listTimeEntryActivities: vi.fn(),
      }),
      encrypt: (secret) => `encrypted:${secret}`,
      decrypt: (secret) => secret,
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2035-01-15T09:30:00.000Z"));
    try {
      await connectCredential(
        value.connection.id,
        "replacement-key",
        value.user.id,
        credentialDeps,
        value.workspace.id,
      );
    } finally {
      vi.useRealTimers();
    }
    const redriven = await prisma.integrationSyncWork.findUniqueOrThrow({
      where: { id: value.work.id },
    });
    expect(redriven).toMatchObject({
      state: "retry",
      skippedReason: null,
      authCredentialId: value.credential.id,
      refId: value.ref.id,
    });
    expect(redriven.availableAt.getUTCFullYear()).toBeGreaterThanOrEqual(2035);

    const deleteIssue = vi.fn().mockResolvedValue({ externalId: "42", requestedStatusId: null, achievedStatusId: null, remoteVersion: null, deleted: true });
    await runIntegrationWorkerCycle(prisma, {
      now: () => new Date(redriven.availableAt.getTime() + 60_000),
      decrypt: () => "replacement-key",
      createAdapter: () => ({ ensureProject: vi.fn(), ensureCycle: vi.fn(), pushIssue: vi.fn(), reconcileCreate: vi.fn(), deleteIssue }),
      limit: 1,
    });
    expect(deleteIssue).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: value.work.id } }),
    ).resolves.toMatchObject({ state: "done", refId: null });
    await expect(prisma.externalRef.findUnique({ where: { id: value.ref.id } })).resolves.toBeNull();
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: value.binding.id } }),
    ).resolves.toMatchObject({ lifecycle: "disabled", releasedAt: expect.any(Date) });
    await expect(
      removeMember(
        value.workspace.id,
        value.member.id,
        value.actorUser.id,
        value.actorMember.role,
      ),
    ).resolves.toBeUndefined();
    await expect(prisma.member.findUnique({ where: { id: value.member.id } })).resolves.toBeNull();
  });
});
