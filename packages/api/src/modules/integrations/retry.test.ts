import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defaultAdapterWiring = vi.hoisted(() => {
  const http = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
  return {
    allowlist: { "http://redmine.internal.example": ["10.20.30.40"] },
    client: vi.fn(function RedmineHttpClient() {
      return http;
    }),
    http,
  };
});

vi.mock("../../config/env.js", () => ({
  env: {
    DATABASE_URL: process.env["DATABASE_URL"],
    NODE_ENV: "test",
    REDMINE_ENDPOINT_ALLOWLIST: defaultAdapterWiring.allowlist,
  },
}));

vi.mock("./providers/redmine/http-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./providers/redmine/http-client.js")>();
  return { ...original, RedmineHttpClient: defaultAdapterWiring.client };
});

import { prisma } from "../../config/prisma.js";
import { ProviderDispatchError, type PmProviderAdapter, type PushResult } from "./core/types.js";
import { RedmineProviderAdapter } from "./providers/redmine/adapter.js";
import { RedmineHttpError } from "./providers/redmine/http-client.js";
import { connectCredential, unbindProject, type ConnectionServiceDeps } from "./service.js";
import {
  createIntegrationWorkerCycle,
  requeueDeadIntegrationWork,
  retryDelayMs,
  runIntegrationWorkerCycle,
  type IntegrationWorkerAdapterOptions,
  type IntegrationWorkerDependencies,
} from "./worker.js";

type DispatchAdapter = Pick<
  PmProviderAdapter,
  "ensureProject" | "ensureCycle" | "pushIssue" | "reconcileCreate"
> & Partial<Pick<PmProviderAdapter, "pushComment" | "pushTimeEntry">>;

const NOW = new Date("2026-07-30T12:00:00.000Z");
const FAR_FUTURE = new Date("2999-01-01T00:00:00.000Z");
const workspaceIds = new Set<string>();
const userIds = new Set<string>();
const concurrentPrisma = new PrismaClient();

async function createFixture() {
  const workspace = await prisma.workspace.create({
    data: { name: "Retry test workspace", slug: `retry-${randomUUID()}` },
  });
  workspaceIds.add(workspace.id);
  const project = await prisma.project.create({
    data: {
      key: `R${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Retry test project",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      lifecycle: "active",
      lifecycleEpoch: 3,
      workspaceId: workspace.id,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "remote-project",
      readMap: { "1": "todo" },
      writeMap: { todo: "1", in_progress: "2", done: "3", "priority:medium": "4" },
      lifecycle: "active",
      lifecycleEpoch: 3,
    },
  });
  const user = await prisma.user.create({
    data: { email: `retry-${randomUUID()}@kanon.test`, passwordHash: "unused" },
  });
  userIds.add(user.id);
  const member = await prisma.member.create({
    data: {
      username: `retry-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      workspaceId: workspace.id,
      role: "owner",
    },
  });
  const credential = await prisma.memberIntegrationCredential.create({
    data: {
      encryptedKey: "encrypted-api-key",
      externalUserId: "remote-user",
      lastAuthStatus: "valid",
      memberId: member.id,
      connectionId: connection.id,
    },
  });
  const identity = await prisma.integrationExternalIdentity.create({
    data: { bindingId: binding.id, memberId: member.id, remoteUserId: "remote-user" },
  });
  const issue = await createIssue(project.id, member.id, "Current canonical title");
  return { workspace, project, connection, binding, user, member, credential, identity, issue };
}

async function createIssue(projectId: string, assigneeId: string, title: string) {
  return prisma.issue.create({
    data: {
      key: `R-${randomUUID().slice(0, 8).toUpperCase()}`,
      sequenceNum: Number.parseInt(randomUUID().slice(0, 6), 16),
      title,
      description: "Current canonical description",
      state: "in_progress",
      projectId,
      assigneeId,
      schedule: {
        create: {
          startDate: new Date("2026-07-29T00:00:00.000Z"),
          dueDate: new Date("2026-08-05T00:00:00.000Z"),
          progress: 40,
          estimateHours: new Prisma.Decimal("2.5"),
        },
      },
    },
  });
}

async function createWork(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  overrides: Partial<Prisma.IntegrationSyncWorkUncheckedCreateInput> = {}
) {
  const entityId = overrides.entityId ?? fixture.issue.id;
  const canonical =
    overrides.payload === undefined && (overrides.entityType ?? "issue") === "issue"
      ? await prisma.issue.findUniqueOrThrow({
          where: { id: entityId },
          select: { title: true, state: true },
        })
      : { title: fixture.issue.title, state: fixture.issue.state };
  return prisma.integrationSyncWork.create({
    data: {
      bindingId: fixture.binding.id,
      entityType: "issue",
      entityId,
      direction: "outbound",
      operation: "update",
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
      actorKey: `member:${fixture.member.id}`,
      actorKind: "user",
      authCredentialId: fixture.credential.id,
      payload: {
        version: 1,
        fields: { title: canonical.title, state: canonical.state },
        issue: { title: canonical.title, state: canonical.state },
      },
      correlationId: randomUUID(),
      availableAt: NOW,
      epoch: fixture.binding.lifecycleEpoch,
      ...overrides,
    },
  });
}

function createRef(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  entityType: string,
  entityId: string,
  externalId: string,
  bindingId = fixture.binding.id
) {
  return prisma.externalRef.create({
    data: { connectionId: fixture.connection.id, bindingId, entityType, entityId, externalId },
  });
}

function adapter(overrides: Partial<DispatchAdapter> = {}): DispatchAdapter {
  return {
    ensureProject: vi.fn(),
    ensureCycle: vi.fn(),
    pushIssue: vi.fn(),
    reconcileCreate: vi.fn(),
    ...overrides,
  };
}

function dependencies(
  provider: DispatchAdapter,
  overrides: Partial<IntegrationWorkerDependencies> = {}
) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const createAdapter = vi.fn((options: IntegrationWorkerAdapterOptions) => {
    void options;
    return provider;
  });
  return {
    deps: {
      now: () => NOW,
      jitter: () => 0,
      decrypt: () => "api-key",
      createAdapter,
      logger,
      ...overrides,
    } as IntegrationWorkerDependencies,
    createAdapter,
    logger,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const success = (externalId = "remote-42"): PushResult => ({
  externalId,
  requestedStatusId: "2",
  achievedStatusId: "3",
  remoteVersion: "2026-07-30T12:00:01.000Z",
});

const replacementDeps: ConnectionServiceDeps = {
  remote: () => ({
    whoAmI: async () => ({ id: "remote-user", displayName: "Remote user", login: "remote" }),
    listStatuses: async () => [],
    listProjects: async () => [],
    listTimeEntryActivities: async () => [],
  }),
  encrypt: (value) => `encrypted:${value}`,
  decrypt: (value) => value,
};

beforeEach(() => prisma.integrationSyncWork.deleteMany());

afterEach(async () => {
  vi.useRealTimers();
  await prisma.timeEntry.deleteMany({ where: { adjustsId: { not: null } } });
  await prisma.timeEntry.deleteMany();
  for (const workspaceId of workspaceIds) {
    await prisma.workspace.delete({ where: { id: workspaceId } });
  }
  workspaceIds.clear();
  for (const userId of userIds) {
    await prisma.user.delete({ where: { id: userId } });
  }
  userIds.clear();
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), concurrentPrisma.$disconnect()]);
});

describe("integration worker retry and completion", () => {
  it("keeps ambiguous comments dark while unrelated work continues", async () => {
    const fixture = await createFixture();
    const comment = await prisma.comment.create({
      data: { body: "Ambiguous comment", issueId: fixture.issue.id, authorId: fixture.member.id },
    });
    const ambiguous = await createWork(fixture, {
      entityType: "comment",
      entityId: comment.id,
      laneKey: fixture.issue.id,
      operation: "create",
      state: "ambiguous",
      payload: { version: 1 },
    });
    const issueWork = await createWork(fixture, { laneKey: fixture.issue.id });
    const pushIssue = vi.fn().mockResolvedValue(success());
    await runIntegrationWorkerCycle(prisma, dependencies(adapter({ pushIssue }), { limit: 3 }).deps);

    expect(pushIssue).toHaveBeenCalledOnce();
    await expect(prisma.integrationConflict.count({ where: { workId: ambiguous.id } })).resolves.toBe(0);
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: ambiguous.id } })).resolves.toMatchObject({ state: "ambiguous", leaseToken: null });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: issueWork.id } })).resolves.toMatchObject({ state: "done" });
  });

  it("rejects stale capture and incomplete proof before exact reconciliation", async () => {
    const fixture = await createFixture();
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { commentDispatchEnabled: true },
    });
    const parentRef = await createRef(fixture, "issue", fixture.issue.id, "42");
    const comment = await prisma.comment.create({
      data: { body: "Delivered body", issueId: fixture.issue.id, authorId: fixture.member.id },
    });
    const marker = `<!-- kanon-comment:${comment.id} -->`;
    const bodySha256 = createHash("sha256").update(comment.body).digest("hex");
    const work = await createWork(fixture, {
      entityType: "comment",
      entityId: comment.id,
      operation: "create",
      marker,
      payload: {
        version: 1,
        body: comment.body,
        bodySha256,
        commentUpdatedAt: comment.updatedAt.toISOString(),
        issueId: fixture.issue.id,
        parentRefId: parentRef.id,
        parentRemoteIssueId: parentRef.externalId,
        bindingEpoch: fixture.binding.lifecycleEpoch,
        credentialId: fixture.credential.id,
        credentialLastValidatedAt: null,
        credentialRemoteUserId: "remote-user",
      },
    });
    const proof = { ...success("9"), remoteIssueId: "42", marker, strippedBodySha256: bodySha256, remoteActorId: "remote-user" };
    const pushComment = vi.fn().mockResolvedValue(success("9"));
    const reconcileCreate = vi.fn().mockResolvedValueOnce([{ ...proof, remoteActorId: "wrong" }]).mockResolvedValue([proof]);

    const setup = dependencies(adapter({ pushComment, reconcileCreate }), { commentDispatchEnabled: true, limit: 1 });
    const captured = work.payload as Prisma.InputJsonObject;
    for (const [payload, state] of [[{ ...captured, body: "stale" }, "superseded"], [{ ...captured, parentRemoteIssueId: "wrong" }, "dead"], [{ ...captured, credentialId: randomUUID() }, "dead"]] as const) {
      await prisma.integrationSyncWork.update({ where: { id: work.id }, data: { state: "queued", payload, leaseToken: null, leaseUntil: null } });
      await runIntegrationWorkerCycle(prisma, setup.deps);
      await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state });
    }
    expect(pushComment).not.toHaveBeenCalled();
    await prisma.integrationSyncWork.update({ where: { id: work.id }, data: { state: "queued", payload: captured, leaseToken: null, leaseUntil: null } });
    await runIntegrationWorkerCycle(prisma, setup.deps);
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "ambiguous" });
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { commentDispatchEnabled: false },
    });
    await runIntegrationWorkerCycle(prisma, setup.deps);
    expect(reconcileCreate).not.toHaveBeenCalled();
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "ambiguous", leaseToken: null });
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { commentDispatchEnabled: true },
    });
    await runIntegrationWorkerCycle(prisma, setup.deps);
    await expect(prisma.integrationConflict.count({ where: { workId: work.id } })).resolves.toBe(1);
    await prisma.integrationConflict.deleteMany({ where: { workId: work.id } });
    await runIntegrationWorkerCycle(prisma, setup.deps);
    expect(pushComment).toHaveBeenCalledWith(expect.objectContaining({ id: comment.id, body: comment.body }), "42");
    expect(reconcileCreate).toHaveBeenCalledWith(expect.objectContaining({ entityType: "comment", marker }));
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "done" });
  });

  it("supersedes accidentally queued remote-authored comments before provider I/O", async () => {
    const fixture = await createFixture();
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { commentDispatchEnabled: true },
    });
    const parentRef = await createRef(fixture, "issue", fixture.issue.id, "42");
    const remoteAuthor = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: fixture.binding.id,
        remoteUserId: "remote-comment-author",
        remoteDisplayName: "Remote comment author",
      },
    });
    const comment = await prisma.comment.create({
      data: {
        body: "Remote body",
        issueId: fixture.issue.id,
        remoteAuthorId: remoteAuthor.id,
      },
    });
    const bodySha256 = createHash("sha256").update(comment.body).digest("hex");
    const work = await createWork(fixture, {
      entityType: "comment",
      entityId: comment.id,
      operation: "create",
      marker: `<!-- kanon-comment:${comment.id} -->`,
      payload: {
        version: 1,
        body: comment.body,
        bodySha256,
        commentUpdatedAt: comment.updatedAt.toISOString(),
        issueId: fixture.issue.id,
        parentRefId: parentRef.id,
        parentRemoteIssueId: parentRef.externalId,
        bindingEpoch: fixture.binding.lifecycleEpoch,
        credentialId: fixture.credential.id,
        credentialLastValidatedAt: null,
        credentialRemoteUserId: "remote-user",
      },
    });
    const pushComment = vi.fn();

    await runIntegrationWorkerCycle(
      prisma,
      dependencies(adapter({ pushComment }), {
        commentDispatchEnabled: true,
        limit: 1,
      }).deps,
    );

    expect(pushComment).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "superseded" });
  });

  it("shares one non-overlapping cycle across concurrent wake-ups", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const claim = vi.fn(async () => {
      await pending;
      return [];
    });
    const run = createIntegrationWorkerCycle(prisma, { claim });

    const first = run();
    expect(run()).toBe(first);
    await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
    release();
    await first;
  });

  it("stops before claiming another row after an in-flight provider operation", async () => {
    const fixture = await createFixture();
    await createWork(fixture);
    const siblingIssue = await createIssue(fixture.project.id, fixture.member.id, "Stopped sibling");
    const sibling = await createWork(fixture, {
      entityId: siblingIssue.id,
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
    });
    const release = deferred();
    const pushIssue = vi
      .fn()
      .mockImplementationOnce(async () => {
        await release.promise;
        return success("remote-first");
      })
      .mockResolvedValueOnce(success("remote-second"));
    const { deps } = dependencies(adapter({ pushIssue }), { limit: 2 });
    const run = createIntegrationWorkerCycle(prisma, deps);

    const running = run();
    await vi.waitFor(() => expect(pushIssue).toHaveBeenCalledOnce());
    run.stop();
    release.resolve();
    await running;

    expect(pushIssue).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: sibling.id } }),
    ).resolves.toMatchObject({ state: "queued", leaseToken: null });
  });

  it("uses the real adapter with binding project and external identity mappings", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { operation: "create" });
    const post = vi.fn().mockResolvedValue({ issue: { id: 42 } });
    const http = {
      post,
      put: vi.fn(),
      get: vi.fn().mockResolvedValue({
        issue: { id: 42, status: { id: 2 }, updated_on: "2026-07-30T12:00:01.000Z" },
      }),
    };
    const { deps, createAdapter } = dependencies(adapter());
    createAdapter.mockImplementation(
      (options) => new RedmineProviderAdapter(http as never, options)
    );

    await runIntegrationWorkerCycle(prisma, deps);

    expect(post).toHaveBeenCalledWith(
      "/issues.json",
      expect.objectContaining({
        issue: expect.objectContaining({
          project_id: "remote-project",
          assigned_to_id: "remote-user",
        }),
      })
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "done",
    });
  });

  it("passes the env endpoint allowlist through the default worker adapter", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { operation: "create" });
    defaultAdapterWiring.client.mockClear();
    defaultAdapterWiring.http.post.mockReset().mockResolvedValue({ issue: { id: 42 } });
    defaultAdapterWiring.http.get.mockReset().mockResolvedValue({
      issue: { id: 42, status: { id: 2 }, updated_on: "2026-07-30T12:00:01.000Z" },
    });

    await runIntegrationWorkerCycle(prisma, {
      now: () => NOW,
      jitter: () => 0,
      decrypt: () => "api-key",
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(defaultAdapterWiring.client).toHaveBeenCalledWith(
      "https://pm.example.test",
      "api-key",
      { endpointAllowlist: defaultAdapterWiring.allowlist },
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "done" });
  });

  it("short-circuits known project and cycle refs before real adapter HTTP", async () => {
    const fixture = await createFixture();
    const cycle = await prisma.cycle.create({
      data: {
        name: "Known cycle",
        startDate: NOW,
        endDate: new Date(NOW.getTime() + 86_400_000),
        projectId: fixture.project.id,
      },
    });
    await createRef(fixture, "project", fixture.project.id, "remote-project");
    await createRef(fixture, "cycle", cycle.id, "remote-cycle");
    const projectWork = await createWork(fixture, {
      entityType: "project",
      entityId: fixture.project.id,
      payload: {},
    });
    const cycleWork = await createWork(fixture, {
      entityType: "cycle",
      entityId: cycle.id,
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
      payload: {},
    });
    const http = {
      get: vi.fn().mockRejectedValue(new Error("request timed out")),
      post: vi.fn().mockRejectedValue(new Error("request timed out")),
      put: vi.fn().mockRejectedValue(new Error("request timed out")),
    };
    const { deps, createAdapter } = dependencies(adapter(), { limit: 2 });
    createAdapter.mockImplementation(
      (options) => new RedmineProviderAdapter(http as never, options)
    );

    await runIntegrationWorkerCycle(prisma, deps);

    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { id: { in: [projectWork.id, cycleWork.id] } },
        orderBy: { sequence: "asc" },
        select: { state: true },
      })
    ).resolves.toEqual([{ state: "done" }, { state: "done" }]);
  });

  it("performs provider I/O after the prepare transaction releases database locks", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    const pushIssue = vi.fn(async () => {
      await concurrentPrisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT set_config('statement_timeout', '250ms', true)`;
        await transaction.integrationConnection.update({
          where: { id: fixture.connection.id },
          data: { baseUrl: "https://changed.example.test" },
        });
      });
      return success();
    });
    const { deps } = dependencies(adapter({ pushIssue }));

    await runIntegrationWorkerCycle(prisma, deps);

    expect(pushIssue).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "done",
    });
  });

  it("locks lifecycle parents before mutating the final external reference", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    const ref = await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const locked = deferred();
    const release = deferred();
    const blocker = concurrentPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "external_refs" WHERE "id" = ${ref.id}::uuid FOR UPDATE`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const pushIssue = vi.fn().mockResolvedValue(success("remote-known"));
    const { deps } = dependencies(adapter({ pushIssue }));
    const worker = runIntegrationWorkerCycle(prisma, deps);

    let lifecycleUpdateBlocked = false;
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE '%external_refs%'
          ) AS "waiting"
        `;
        expect(row?.waiting).toBe(true);
      });
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.$executeRaw`SELECT set_config('statement_timeout', '200ms', true)`;
          await transaction.integrationProjectBinding.update({
            where: { id: fixture.binding.id },
            data: { lifecycleEpoch: 4 },
          });
        });
      } catch {
        lifecycleUpdateBlocked = true;
      }
    } finally {
      release.resolve();
      await blocker;
      await worker;
    }

    expect(lifecycleUpdateBlocked).toBe(true);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({ state: "done" });
    await expect(prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } })).resolves.toMatchObject({
      externalId: "remote-known",
    });
  });

  it("moves expired leases to ambiguous before claiming new work", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, {
      state: "leased",
      leaseToken: "expired-token",
      leaseUntil: new Date(Date.now() - 1_000),
      fence: 1,
    });
    const claim = vi.fn().mockResolvedValue([]);
    const { deps, logger } = dependencies(adapter(), { claim });

    await runIntegrationWorkerCycle(prisma, deps);

    expect(claim).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ workId: work.id, state: "ambiguous" }),
      "Integration work became ambiguous"
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "ambiguous",
      leaseToken: null,
      leaseUntil: null,
    });
  });

  it("uses one total row limit across lease expiry and normal claims", async () => {
    const fixture = await createFixture();
    const expired = await createWork(fixture, {
      state: "leased",
      leaseToken: "expired-token",
      leaseUntil: new Date(0),
      fence: 1,
    });
    const siblingIssue = await createIssue(fixture.project.id, fixture.member.id, "Budgeted sibling");
    const sibling = await createWork(fixture, {
      entityId: siblingIssue.id,
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
    });
    const pushIssue = vi.fn().mockResolvedValue(success());

    await runIntegrationWorkerCycle(prisma, dependencies(adapter({ pushIssue }), { limit: 1 }).deps);

    expect(pushIssue).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: expired.id } }),
    ).resolves.toMatchObject({ state: "ambiguous", leaseToken: null });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: sibling.id } }),
    ).resolves.toMatchObject({ state: "queued", leaseToken: null });
  });

  it("claims the next row only after the slow sibling finishes", async () => {
    const fixture = await createFixture();
    await createWork(fixture);
    const siblingIssue = await createIssue(fixture.project.id, fixture.member.id, "Slow sibling");
    const sibling = await createWork(fixture, {
      entityId: siblingIssue.id,
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
    });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pushIssue = vi
      .fn()
      .mockImplementationOnce(async () => {
        await pending;
        return success("remote-first");
      })
      .mockResolvedValueOnce(success("remote-second"));
    const { deps } = dependencies(adapter({ pushIssue }), { limit: 2 });

    const cycle = runIntegrationWorkerCycle(prisma, deps);
    await vi.waitFor(() => expect(pushIssue).toHaveBeenCalledOnce());
    const stateWhileFirstIsSlow = await prisma.integrationSyncWork.findUniqueOrThrow({
      where: { id: sibling.id },
      select: { state: true },
    });
    release();
    await cycle;

    expect(stateWhileFirstIsSlow.state).toBe("queued");
    expect(pushIssue).toHaveBeenCalledTimes(2);
  });

  it("omits application time from production claim calls", async () => {
    const claim = vi.fn().mockResolvedValue([]);

    await runIntegrationWorkerCycle(prisma, { claim, limit: 1 });

    expect(claim).toHaveBeenCalledOnce();
    expect(claim.mock.calls[0]?.[0]).toBe(prisma);
    expect(claim.mock.calls[0]?.[1]).toEqual({ limit: 1, excludeComments: true });
  });

  it("uses the database clock for production prepare and finalize under app clock skew", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FAR_FUTURE);
    const fixture = await createFixture();
    const work = await createWork(fixture);
    const setup = dependencies(adapter({ pushIssue: vi.fn().mockResolvedValue(success()) }));

    await runIntegrationWorkerCycle(prisma, { ...setup.deps, now: undefined });

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({ state: "done" });
  });

  it("uses the database clock for production retry scheduling", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FAR_FUTURE);
    const fixture = await createFixture();
    const work = await createWork(fixture);
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const [before] = await prisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS "now"`;
    const error = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const setup = dependencies(adapter({ pushIssue: vi.fn().mockRejectedValue(error) }));

    await runIntegrationWorkerCycle(prisma, { ...setup.deps, now: undefined });

    const retried = await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } });
    expect(retried.state).toBe("retry");
    expect(retried.availableAt.getTime() - before!.now.getTime()).toBeGreaterThanOrEqual(30_000);
    expect(retried.availableAt.getTime() - before!.now.getTime()).toBeLessThan(35_000);
  });

  it("fences completion, re-reads canonical data, and resolves create then update refs", async () => {
    const fixture = await createFixture();
    const first = await createWork(fixture, {
      operation: "create",
      correlationId: "create-correlation",
    });
    const paths: string[] = [];
    const pushed = vi.fn();
    const { deps, createAdapter, logger } = dependencies(adapter());
    createAdapter.mockImplementation((options) =>
      adapter({
        pushIssue: pushed.mockImplementation(async (issue, patch) => {
          paths.push((await options.resolveExternalId("issue", issue.id)) ? "update" : "create");
          expect(issue).toMatchObject({
            title: "Current canonical title",
            estimateHours: null,
            progress: 40,
          });
          expect(patch).toMatchObject({
            title: { kind: "set", value: "Current canonical title" },
            status: { kind: "set", value: "in_progress" },
          });
          return success();
        }),
      })
    );

    await runIntegrationWorkerCycle(prisma, deps);
    const completed = await prisma.integrationSyncWork.findUniqueOrThrow({
      where: { id: first.id },
    });
    const reference = await prisma.externalRef.findUniqueOrThrow({
      where: { id: completed.refId! },
    });
    expect(completed).toMatchObject({ state: "done", requestedStatus: "2", actualStatus: "3" });
    expect(reference).toMatchObject({
      bindingId: fixture.binding.id,
      externalId: "remote-42",
      lastCorrelationId: "create-correlation",
      metadata: expect.objectContaining({
        remoteVersion: "2026-07-30T12:00:01.000Z",
        baseline: expect.objectContaining({
          sourceVersion: "2026-07-30T12:00:01.000Z",
          fields: expect.objectContaining({
            title: "Current canonical title",
            state: "in_progress",
          }),
        }),
      }),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ workId: first.id, state: "done" }),
      "Integration work completed"
    );
    await prisma.externalRef.update({
      where: { id: reference.id },
      data: {
        metadata: {
          ...(reference.metadata as Prisma.JsonObject),
          custom: "keep",
        },
      },
    });

    const second = await createWork(fixture, { correlationId: "update-correlation" });
    await runIntegrationWorkerCycle(prisma, deps);

    expect(paths).toEqual(["create", "update"]);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: second.id } })
    ).resolves.toMatchObject({
      state: "done",
      refId: reference.id,
    });
    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: reference.id } }),
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        custom: "keep",
        baseline: expect.objectContaining({
          fields: expect.objectContaining({ title: "Current canonical title" }),
        }),
      }),
    });
  });

  it("does not regress a newer inbound baseline during stale provider finalization", async () => {
    const fixture = await createFixture();
    const ref = await createRef(fixture, "issue", fixture.issue.id, "remote-42");
    const work = await createWork(fixture, { correlationId: "outbound-stale" });
    const inboundAt = new Date("2026-07-30T12:00:02.000Z");
    const pushIssue = vi.fn(async () => {
      await prisma.externalRef.update({
        where: { id: ref.id },
        data: {
          remoteUpdatedAt: inboundAt,
          lastCorrelationId: "inbound-newer",
          metadata: {
            remoteVersion: inboundAt.toISOString(),
            baseline: {
              version: 1,
              sourceVersion: inboundAt.toISOString(),
              changedAt: inboundAt.toISOString(),
              createdAt: null,
              completedAt: null,
              fields: { title: "Newer remote title" },
            },
          },
        },
      });
      return success();
    });

    await runIntegrationWorkerCycle(prisma, dependencies(adapter({ pushIssue })).deps);

    await expect(
      prisma.externalRef.findUniqueOrThrow({ where: { id: ref.id } }),
    ).resolves.toMatchObject({
      remoteUpdatedAt: inboundAt,
      lastCorrelationId: "inbound-newer",
      metadata: expect.objectContaining({
        baseline: expect.objectContaining({ fields: { title: "Newer remote title" } }),
      }),
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous" });
  });

  it("dispatches supported schedule fields but drops persisted estimates", async () => {
    const fixture = await createFixture();
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    await createWork(fixture, {
      payload: {
        version: 1,
        fields: {
          estimateHours: 2.5,
          startDate: "2026-07-29T00:00:00.000Z",
          dueDate: "2026-08-05T00:00:00.000Z",
          progress: 40,
        },
      },
    });
    const pushIssue = vi.fn().mockResolvedValue(success());

    await runIntegrationWorkerCycle(prisma, dependencies(adapter({ pushIssue })).deps);

    expect(pushIssue).toHaveBeenCalledWith(
      expect.objectContaining({ id: fixture.issue.id }),
      expect.objectContaining({
        estimateHours: { kind: "omit" },
        startDate: { kind: "set", value: new Date("2026-07-29T00:00:00.000Z") },
        dueDate: { kind: "set", value: new Date("2026-08-05T00:00:00.000Z") },
        progress: { kind: "set", value: 40 },
      }),
    );
  });

  it("supersedes estimate-only work without blocking later issue updates", async () => {
    const fixture = await createFixture();
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const estimateOnly = await createWork(fixture, {
      payload: { version: 1, fields: { estimateHours: 2.5 } },
    });
    const pushIssue = vi.fn().mockResolvedValue(success("remote-known"));
    const deps = dependencies(adapter({ pushIssue }), { limit: 2 }).deps;

    await runIntegrationWorkerCycle(prisma, deps);

    expect(pushIssue).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({
        where: { id: estimateOnly.id },
        select: { state: true, leaseToken: true, leaseUntil: true },
      }),
    ).resolves.toEqual({ state: "superseded", leaseToken: null, leaseUntil: null });

    const supported = await createWork(fixture, { laneKey: estimateOnly.laneKey });
    await runIntegrationWorkerCycle(prisma, deps);

    expect(pushIssue).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: supported.id } }),
    ).resolves.toMatchObject({ state: "done" });
  });

  it("does not attribute a later unconnected actor schedule change to an earlier actor", async () => {
    const fixture = await createFixture();
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const earlier = await createWork(fixture, {
      state: "retry",
      payload: {
        version: 1,
        fields: {
          estimateHours: 1,
          startDate: "2026-07-28T00:00:00.000Z",
          dueDate: "2026-08-04T00:00:00.000Z",
          progress: 10,
        },
      },
    });
    const user = await prisma.user.create({
      data: { email: `unconnected-${randomUUID()}@kanon.test`, passwordHash: "unused" },
    });
    userIds.add(user.id);
    const member = await prisma.member.create({
      data: {
        username: `unconnected-${randomUUID().slice(0, 8)}`,
        userId: user.id,
        workspaceId: fixture.workspace.id,
      },
    });
    const later = await createWork(fixture, {
      dedupeKey: randomUUID(),
      laneKey: earlier.laneKey,
      actorKey: `member:${member.id}`,
      authCredentialId: null,
      payload: {
        version: 1,
        fields: {
          estimateHours: 2.5,
          startDate: "2026-07-29T00:00:00.000Z",
          dueDate: "2026-08-05T00:00:00.000Z",
          progress: 40,
        },
      },
    });
    const pushIssue = vi.fn().mockResolvedValue(success());

    await runIntegrationWorkerCycle(prisma, {
      ...dependencies(adapter({ pushIssue })).deps,
      limit: 2,
    });

    expect(pushIssue).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findMany({
        where: { id: { in: [earlier.id, later.id] } },
        orderBy: { sequence: "asc" },
        select: { state: true, skippedReason: true },
      }),
    ).resolves.toEqual([
      { state: "superseded", skippedReason: null },
      {
        state: "skipped",
        skippedReason: "User work has no captured credential",
      },
    ]);
  });

  it("retries known-ref network failures from 30 seconds with capped backoff", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const networkError = Object.assign(new Error("socket reset"), {
      code: "ECONNRESET",
      apiKey: "must-not-be-logged",
    });
    const { deps, logger } = dependencies(
      adapter({ pushIssue: vi.fn().mockRejectedValue(networkError) }),
      { jitter: () => 1_234 }
    );

    await runIntegrationWorkerCycle(prisma, deps);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { name: "Error", code: "ECONNRESET" },
        workId: work.id,
        state: "retry",
      }),
      "Integration work scheduled for retry"
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("must-not-be-logged");
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "retry",
      attempts: 1,
      availableAt: new Date(NOW.getTime() + 31_234),
      leaseToken: null,
      correlationId: work.correlationId,
      payload: work.payload,
    });
    expect(retryDelayMs(1, () => 0)).toBe(30_000);
    expect(retryDelayMs(8, () => 1_234)).toBe(3_600_000);
  });

  it("uses provider phase evidence for definitive throttles and uncertain create responses", async () => {
    const throttled = await createFixture();
    const throttledWork = await createWork(throttled, { operation: "create" });
    const throttledHttp = {
      post: vi.fn().mockRejectedValue(new RedmineHttpError(429)),
      put: vi.fn(),
      get: vi.fn(),
    };
    const throttledSetup = dependencies(adapter());
    throttledSetup.createAdapter.mockImplementation(
      (options) => new RedmineProviderAdapter(throttledHttp as never, options)
    );

    await runIntegrationWorkerCycle(prisma, throttledSetup.deps);

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: throttledWork.id } })
    ).resolves.toMatchObject({ state: "retry", attempts: 1 });

    const unobserved = await createFixture();
    const unobservedWork = await createWork(unobserved, { operation: "create" });
    const unobservedHttp = {
      post: vi.fn().mockResolvedValue({ issue: { id: 42 } }),
      put: vi.fn(),
      get: vi.fn().mockRejectedValue(new RedmineHttpError(404)),
    };
    const unobservedSetup = dependencies(adapter());
    unobservedSetup.createAdapter.mockImplementation(
      (options) => new RedmineProviderAdapter(unobservedHttp as never, options)
    );

    await runIntegrationWorkerCycle(prisma, unobservedSetup.deps);

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: unobservedWork.id } })
    ).resolves.toMatchObject({ state: "ambiguous", attempts: 1 });

    const malformed = await createFixture();
    const malformedWork = await createWork(malformed, { operation: "create" });
    const malformedHttp = {
      post: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON after 201")),
      put: vi.fn(),
      get: vi.fn(),
    };
    const malformedSetup = dependencies(adapter());
    malformedSetup.createAdapter.mockImplementation(
      (options) => new RedmineProviderAdapter(malformedHttp as never, options)
    );

    await runIntegrationWorkerCycle(prisma, malformedSetup.deps);

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: malformedWork.id } })
    ).resolves.toMatchObject({ state: "ambiguous", attempts: 1 });
  });

  it("marks uncertain EAI_AGAIN create failures ambiguous instead of retrying", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { operation: "create" });
    const error = Object.assign(new Error("temporary DNS failure"), { code: "EAI_AGAIN" });
    const { deps, logger } = dependencies(adapter({ pushIssue: vi.fn().mockRejectedValue(error) }));

    await runIntegrationWorkerCycle(prisma, deps);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ workId: work.id, state: "ambiguous" }),
      "Integration work became ambiguous"
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "ambiguous",
      attempts: 1,
      leaseToken: null,
      leaseUntil: null,
    });
  });

  it.each([
    ["observed uncertain-create", new ProviderDispatchError("ambiguous", new RedmineHttpError(401)), 1],
    ["reconciliation", new ProviderDispatchError("ambiguous", new Error("response lost")), 2],
  ] as const)("auth-blocks a %s 401 as ambiguous without reclaiming it", async (_, error, cycles) => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { operation: "create" });
    const pushIssue = vi.fn().mockRejectedValue(error);
    const reconcileCreate = vi.fn().mockRejectedValue(new RedmineHttpError(401));
    const { deps } = dependencies(adapter({ pushIssue, reconcileCreate }));

    for (let cycle = 0; cycle < cycles; cycle += 1) await runIntegrationWorkerCycle(prisma, deps);
    const blocked = await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } });
    expect(blocked).toMatchObject({
      state: "ambiguous",
      skippedReason: "credential_invalid",
      authCredentialId: fixture.credential.id,
      attempts: cycles - 1,
    });
    expect(blocked.availableAt.getTime()).toBeGreaterThan(NOW.getTime());

    const alreadyInvalid = await createWork(fixture, { operation: "create", state: "ambiguous" });
    await runIntegrationWorkerCycle(prisma, deps);
    expect(pushIssue).toHaveBeenCalledOnce();
    expect(reconcileCreate).toHaveBeenCalledTimes(cycles - 1);
    expect(
      await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: alreadyInvalid.id } }),
    ).toMatchObject({
      state: "ambiguous",
      skippedReason: "credential_invalid",
      authCredentialId: fixture.credential.id,
    });
  });

  it("finalizes a touched ref without scanning unrelated invalid refs", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { operation: "create" });
    const unrelated = await prisma.project.create({
      data: {
        key: `U${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Mismatched ref project",
        workspaceId: fixture.workspace.id,
      },
    });
    await prisma.externalRef.create({
      data: {
        connectionId: fixture.connection.id,
        bindingId: fixture.binding.id,
        entityType: "project",
        entityId: unrelated.id,
        externalId: "mismatched-remote",
      },
    });
    const { deps, logger } = dependencies(
      adapter({ pushIssue: vi.fn().mockResolvedValue(success()) })
    );

    await runIntegrationWorkerCycle(prisma, deps);

    expect(logger.error).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "done",
      leaseToken: null,
      leaseUntil: null,
    });
  });

  it("logs stale after provider I/O when a newer fence owns the row", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    const pushIssue = vi.fn(async () => {
      await prisma.integrationSyncWork.update({
        where: { id: work.id },
        data: { leaseToken: "new-owner", fence: { increment: 1 } },
      });
      return success();
    });
    const { deps, logger } = dependencies(adapter({ pushIssue }));

    await runIntegrationWorkerCycle(prisma, deps);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ workId: work.id, state: "stale" }),
      "Integration work stale after provider I/O"
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "leased",
      leaseToken: "new-owner",
      fence: 2,
    });
  });

  it("preflights missing user identity and wrong-binding cycle refs with zero I/O", async () => {
    const missingIdentity = await createFixture();
    const missingWork = await createWork(missingIdentity);
    await prisma.integrationExternalIdentity.delete({ where: { id: missingIdentity.identity.id } });
    const first = dependencies(adapter({ pushIssue: vi.fn().mockResolvedValue(success()) }));

    await runIntegrationWorkerCycle(prisma, first.deps);

    expect(first.createAdapter).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: missingWork.id } })
    ).resolves.toMatchObject({
      state: "dead",
    });

    const wrongRef = await createFixture();
    const cycle = await prisma.cycle.create({
      data: {
        name: "Mapped elsewhere",
        startDate: NOW,
        endDate: new Date(NOW.getTime() + 86_400_000),
        projectId: wrongRef.project.id,
      },
    });
    await prisma.issue.update({ where: { id: wrongRef.issue.id }, data: { cycleId: cycle.id } });
    const otherProject = await prisma.project.create({
      data: {
        key: `W${randomUUID().slice(0, 5).toUpperCase()}`,
        name: "Wrong binding",
        workspaceId: wrongRef.workspace.id,
      },
    });
    const otherBinding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: wrongRef.connection.id,
        projectId: otherProject.id,
        remoteProjectId: "wrong-project",
        readMap: {},
        writeMap: {},
        lifecycle: "active",
        lifecycleEpoch: 3,
      },
    });
    await createRef(wrongRef, "cycle", cycle.id, "wrong-cycle", otherBinding.id);
    const wrongWork = await createWork(wrongRef, {
      payload: { version: 1, fields: { cycleId: cycle.id }, issue: {} },
    });
    const second = dependencies(adapter({ pushIssue: vi.fn().mockResolvedValue(success()) }));

    await runIntegrationWorkerCycle(prisma, second.deps);

    expect(second.createAdapter).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: wrongWork.id } })
    ).resolves.toMatchObject({
      state: "dead",
    });
  });

  it("rejects payload fields outside the producer's six names before I/O", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, {
      payload: { version: 1, fields: { status: "todo" }, issue: {} },
    });
    const { deps, createAdapter } = dependencies(adapter());

    await runIntegrationWorkerCycle(prisma, deps);

    expect(createAdapter).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "dead",
    });
  });

  it("moves the eighth known-ref failed attempt to dead without losing audit evidence", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { attempts: 7 });
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const error = Object.assign(new Error("request aborted"), { name: "AbortError" });
    const { deps, logger } = dependencies(adapter({ pushIssue: vi.fn().mockRejectedValue(error) }));

    await runIntegrationWorkerCycle(prisma, deps);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ workId: work.id, state: "dead" }),
      "Integration work marked dead"
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "dead",
      attempts: 8,
      correlationId: work.correlationId,
      payload: work.payload,
    });
  });

  it("moves terminal provider 403 failures to dead without invalidating credentials", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    const { deps } = dependencies(
      adapter({ pushIssue: vi.fn().mockRejectedValue(new RedmineHttpError(403)) })
    );

    await runIntegrationWorkerCycle(prisma, deps);

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "dead",
      attempts: 1,
      leaseToken: null,
    });
    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: fixture.credential.id } }),
    ).resolves.toMatchObject({ lastAuthStatus: "valid" });
  });

  it("invalidates the observed credential and auth-blocks a time-entry 401", async () => {
    const fixture = await createFixture();
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { writeMap: { todo: "1", in_progress: "2", done: "3", _timeEntryActivityId: "9" } },
    });
    await createRef(fixture, "issue", fixture.issue.id, "remote-issue");
    const entry = await prisma.timeEntry.create({
      data: { memberId: fixture.member.id, issueId: fixture.issue.id, hours: "1", workedOn: NOW, status: "approved" },
    });
    const work = await createWork(fixture, {
      entityType: "time_entry",
      entityId: entry.id,
      payload: { version: 1, targetHours: "1", entryIds: [entry.id] },
    });
    const pushTimeEntry = vi.fn().mockRejectedValue(new RedmineHttpError(401));

    await runIntegrationWorkerCycle(prisma, dependencies(adapter({ pushTimeEntry })).deps);

    expect(pushTimeEntry).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({
      state: "dead",
      skippedReason: "credential_invalid",
      attempts: 1,
      correlationId: work.correlationId,
      payload: work.payload,
    });
  });

  it("keeps a newer valid credential and immediately retries a stale 401 without another attempt", async () => {
    const fixture = await createFixture();
    const observedAt = new Date("2026-07-30T11:00:00.000Z");
    await prisma.memberIntegrationCredential.update({
      where: { id: fixture.credential.id },
      data: { lastValidatedAt: observedAt },
    });
    const work = await createWork(fixture, { attempts: 2 });
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const pushIssue = vi.fn(async () => {
      await prisma.memberIntegrationCredential.update({
        where: { id: fixture.credential.id },
        data: { encryptedKey: "replacement-key", lastValidatedAt: observedAt },
      });
      throw new RedmineHttpError(401);
    });

    await runIntegrationWorkerCycle(
      prisma,
      dependencies(adapter({ pushIssue }), { limit: 1 }).deps,
    );

    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: fixture.credential.id } }),
    ).resolves.toMatchObject({
      lastAuthStatus: "valid",
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({
      state: "retry",
      attempts: 2,
      availableAt: NOW,
    });
  });

  it("does not strand work when replacement lands between invalidation and auth blocking", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_delay_auth_block_transition()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.skipped_reason = 'credential_invalid' THEN
          PERFORM pg_sleep(0.5);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_delay_auth_block_transition
      BEFORE UPDATE ON "integration_sync_work"
      FOR EACH ROW EXECUTE FUNCTION test_delay_auth_block_transition()
    `);
    let running: Promise<void> | undefined;

    try {
      running = runIntegrationWorkerCycle(
        prisma,
        dependencies(adapter({ pushIssue: vi.fn().mockRejectedValue(new RedmineHttpError(401)) })).deps,
      );
      await vi.waitFor(async () => {
        const credential = await prisma.memberIntegrationCredential.findUniqueOrThrow({
          where: { id: fixture.credential.id },
        });
        expect(credential.lastAuthStatus).toBe("invalid");
      });

      await connectCredential(
        fixture.connection.id,
        "replacement-key",
        fixture.user.id,
        replacementDeps,
      );
      await running;

      await expect(
        prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: fixture.credential.id } }),
      ).resolves.toMatchObject({ lastAuthStatus: "valid", encryptedKey: "encrypted:replacement-key" });
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
      ).resolves.toMatchObject({ state: "retry", skippedReason: null, attempts: 1 });
    } finally {
      await running?.catch(() => undefined);
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS test_delay_auth_block_transition ON "integration_sync_work"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_delay_auth_block_transition()`);
    }
  });

  it("commits credential invalidation without mutating work reclaimed after a 401", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    const pushIssue = vi.fn(async () => {
      await prisma.integrationSyncWork.update({
        where: { id: work.id },
        data: { leaseToken: "new-owner", leaseUntil: FAR_FUTURE, fence: { increment: 1 } },
      });
      throw new RedmineHttpError(401);
    });

    await runIntegrationWorkerCycle(prisma, dependencies(adapter({ pushIssue })).deps);

    expect(
      await prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: fixture.credential.id } }),
    ).toMatchObject({ lastAuthStatus: "invalid" });
    expect(await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).toMatchObject({
      state: "leased",
      leaseToken: "new-owner",
      leaseUntil: FAR_FUTURE,
      fence: 2,
      attempts: 0,
      skippedReason: null,
    });
  });

  it("leaves an expired failure transition for lease expiry handling", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture);
    await createRef(fixture, "issue", fixture.issue.id, "remote-known");
    let now = NOW;
    const networkError = Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
    const pushIssue = vi.fn(async () => {
      now = new Date(NOW.getTime() + 2_000);
      throw networkError;
    });
    const { deps } = dependencies(adapter({ pushIssue }), {
      now: () => now,
      leaseMs: 1_000,
    });

    await runIntegrationWorkerCycle(prisma, deps);

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "leased",
      attempts: 0,
      leaseUntil: new Date(NOW.getTime() + 1_000),
    });

    await runIntegrationWorkerCycle(prisma, { claim: vi.fn().mockResolvedValue([]), limit: 1 });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({ state: "ambiguous", attempts: 0, leaseUntil: null });
  });

  it("durably skips user work with no captured credential and warns", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { authCredentialId: null });
    const { deps, createAdapter, logger } = dependencies(adapter());

    await runIntegrationWorkerCycle(prisma, deps);

    expect(createAdapter).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ workId: work.id, state: "skipped" }),
      "Integration work skipped"
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({
      state: "skipped",
      skippedReason: expect.stringMatching(/credential/i),
      leaseToken: null,
    });
  });

  it("uses only an enabled same-connection valid service fallback", async () => {
    const fixture = await createFixture();
    await prisma.integrationConnection.update({
      where: { id: fixture.connection.id },
      data: { serviceFallbackEnabled: true, serviceCredentialId: fixture.credential.id },
    });
    const work = await createWork(fixture, {
      actorKey: "system:scheduler",
      actorKind: "system",
      authCredentialId: null,
    });
    const decrypt = vi.fn().mockReturnValue("service-api-key");
    const setup = dependencies(adapter({ pushIssue: vi.fn().mockResolvedValue(success()) }), {
      decrypt,
    });

    await runIntegrationWorkerCycle(prisma, setup.deps);

    expect(decrypt).toHaveBeenCalledWith(fixture.credential.encryptedKey);
    expect(setup.createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "service-api-key" })
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({ state: "done" });
  });

  it("finishes an in-flight provider write before automatically releasing its binding", async () => {
    const fixture = await createFixture();
    const work = await createWork(fixture, { operation: "create" });
    let finishPush!: (result: PushResult) => void;
    const pushIssue = vi.fn(
      () => new Promise<PushResult>((resolve) => {
        finishPush = resolve;
      }),
    );
    const setup = dependencies(adapter({ pushIssue }));

    const cycle = runIntegrationWorkerCycle(prisma, setup.deps);
    await vi.waitFor(() => expect(pushIssue).toHaveBeenCalledOnce());
    await expect(
      unbindProject(
        fixture.connection.id,
        fixture.binding.id,
        fixture.user.id,
        fixture.workspace.id,
      ),
    ).resolves.toMatchObject({ status: "draining" });
    finishPush(success());
    await cycle;

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "done", leaseToken: null });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: fixture.binding.id } }),
    ).resolves.toMatchObject({ lifecycle: "disabled", releasedAt: expect.any(Date) });
  });

  it("records the selected service fallback on 401 and already-invalid blocking", async () => {
    const fixture = await createFixture();
    await prisma.integrationConnection.update({
      where: { id: fixture.connection.id },
      data: { serviceFallbackEnabled: true, serviceCredentialId: fixture.credential.id },
    });
    const serviceWork = { actorKey: "system:scheduler", actorKind: "system", authCredentialId: null } as const;
    const pushIssue = vi.fn().mockRejectedValue(new RedmineHttpError(401));
    const setup = dependencies(adapter({ pushIssue }));

    const rejected = await createWork(fixture, { ...serviceWork, operation: "create" });
    await runIntegrationWorkerCycle(prisma, setup.deps);
    const blocked = await createWork(fixture, serviceWork);
    await runIntegrationWorkerCycle(prisma, setup.deps);

    expect(pushIssue).toHaveBeenCalledOnce();
    await expect(
      prisma.integrationSyncWork.count({
        where: {
          id: { in: [rejected.id, blocked.id] },
          state: "dead",
          authCredentialId: fixture.credential.id,
          actorKey: "system:scheduler",
          actorKind: "system",
        },
      }),
    ).resolves.toBe(2);
  });

  it("makes release-pending credential ambiguity reclaimable after service rotation", async () => {
    const fixture = await createFixture();
    await prisma.integrationConnection.update({
      where: { id: fixture.connection.id },
      data: { serviceFallbackEnabled: true, serviceCredentialId: fixture.credential.id },
    });
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: { releaseRequestedAt: NOW },
    });
    const work = await createWork(fixture, {
      operation: "create",
      state: "ambiguous",
      actorKey: "system:scheduler",
      actorKind: "system",
      skippedReason: "credential_invalid",
    });

    await connectCredential(
      fixture.connection.id,
      "replacement-key",
      fixture.user.id,
      replacementDeps,
      fixture.workspace.id,
    );

    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous", skippedReason: null });
  });

  it("skips disabled, revoked, and cross-connection service fallbacks", async () => {
    for (const invalid of ["disabled", "revoked", "demoted", "cross-connection"] as const) {
      const fixture = await createFixture();
      let serviceCredentialId = fixture.credential.id;
      if (invalid === "revoked") {
        await prisma.memberIntegrationCredential.update({
          where: { id: fixture.credential.id },
          data: { revokedAt: NOW },
        });
      }
      if (invalid === "demoted") {
        await prisma.member.update({
          where: { id: fixture.member.id },
          data: { role: "member" },
        });
      }
      if (invalid === "cross-connection") {
        const other = await createFixture();
        serviceCredentialId = other.credential.id;
      }
      await prisma.integrationConnection.update({
        where: { id: fixture.connection.id },
        data: {
          serviceFallbackEnabled: invalid !== "disabled",
          serviceCredentialId,
        },
      });
      const work = await createWork(fixture, {
        actorKey: "ai:agent",
        actorKind: "ai",
        authCredentialId: null,
      });
      const setup = dependencies(adapter());

      await runIntegrationWorkerCycle(prisma, setup.deps);

      expect(setup.createAdapter, invalid).not.toHaveBeenCalled();
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
      ).resolves.toMatchObject({ state: "skipped" });
    }
  });

  it("rejects a replaced captured cycle reference before provider I/O", async () => {
    const fixture = await createFixture();
    const cycle = await prisma.cycle.create({
      data: {
        name: "Stale cycle ref",
        startDate: NOW,
        endDate: new Date(NOW.getTime() + 86_400_000),
        projectId: fixture.project.id,
      },
    });
    const ref = await createRef(fixture, "cycle", cycle.id, "remote-cycle");
    const work = await createWork(fixture, {
      entityType: "cycle",
      entityId: cycle.id,
      refId: ref.id,
      payload: {},
    });
    await prisma.externalRef.update({ where: { id: ref.id }, data: { entityId: randomUUID() } });
    const setup = dependencies(adapter());

    await runIntegrationWorkerCycle(prisma, setup.deps);

    expect(setup.createAdapter).not.toHaveBeenCalled();
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })
    ).resolves.toMatchObject({ state: "dead" });
  });

  it("retries non-terminal prepare failures without leaving the lease stranded", async () => {
    const fixture = await createFixture();
    const queued = await createWork(fixture);
    const claimed = await prisma.integrationSyncWork.update({
      where: { id: queued.id },
      data: {
        state: "leased",
        leaseToken: "prepare-token",
        leaseUntil: FAR_FUTURE,
        fence: 1,
      },
    });
    const transaction = vi.fn().mockRejectedValue(new Error("database prepare failed"));
    const database = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === "$transaction") return transaction;
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const { deps, logger } = dependencies(adapter(), {
      claim: vi.fn().mockResolvedValueOnce([claimed]),
      limit: 1,
    });

    await runIntegrationWorkerCycle(database, deps);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ workId: claimed.id, state: "retry" }),
      "Integration work scheduled for retry"
    );
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: claimed.id } })
    ).resolves.toMatchObject({
      state: "retry",
      attempts: 1,
      leaseToken: null,
      availableAt: new Date(NOW.getTime() + 30_000),
    });
  });

  it("reaches prepare and logs stale token, fence, epoch, or lifecycle with a live lease", async () => {
    for (const stale of ["token", "fence", "epoch", "lifecycleEpoch"] as const) {
      const fixture = await createFixture();
      const queued = await createWork(fixture);
      const claimed = await prisma.integrationSyncWork.update({
        where: { id: queued.id },
        data: {
          state: "leased",
          leaseToken: "old-token",
          leaseUntil: FAR_FUTURE,
          fence: 1,
        },
      });
      if (stale === "token") {
        await prisma.integrationSyncWork.update({
          where: { id: claimed.id },
          data: { leaseToken: "new-token" },
        });
      } else if (stale === "fence") {
        await prisma.integrationSyncWork.update({ where: { id: claimed.id }, data: { fence: 2 } });
      } else if (stale === "epoch") {
        await prisma.integrationSyncWork.update({ where: { id: claimed.id }, data: { epoch: 4 } });
      } else if (stale === "lifecycleEpoch") {
        await prisma.integrationProjectBinding.update({
          where: { id: fixture.binding.id },
          data: { lifecycleEpoch: 4 },
        });
      }
      const claim = vi.fn().mockResolvedValue([claimed]);
      const { deps, createAdapter, logger } = dependencies(adapter(), {
        claim,
        limit: 1,
      });

      await runIntegrationWorkerCycle(prisma, deps);

      expect(createAdapter, stale).not.toHaveBeenCalled();
      expect(claim, stale).toHaveBeenCalledOnce();
      expect(logger.warn, stale).toHaveBeenCalledWith(
        expect.objectContaining({ workId: claimed.id, state: "stale" }),
        "Integration work stale before provider I/O"
      );
      expect(logger.warn, stale).not.toHaveBeenCalledWith(
        expect.objectContaining({ workId: claimed.id, state: "ambiguous" }),
        "Integration work became ambiguous"
      );
      await expect(
        prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: claimed.id } })
      ).resolves.toMatchObject({ state: "leased", leaseUntil: FAR_FUTURE });
    }
  });

  it("continues with a known-ref sibling after one row fails", async () => {
    const fixture = await createFixture();
    const failing = await createWork(fixture);
    await createRef(fixture, "issue", fixture.issue.id, "remote-first");
    const siblingIssue = await createIssue(fixture.project.id, fixture.member.id, "Sibling issue");
    const succeeding = await createWork(fixture, {
      entityId: siblingIssue.id,
      laneKey: randomUUID(),
      dedupeKey: randomUUID(),
      correlationId: "sibling-correlation",
    });
    await createRef(fixture, "issue", siblingIssue.id, "remote-second");
    const error = Object.assign(new Error("network failed"), { code: "ETIMEDOUT" });
    const pushIssue = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(success("remote-second"));
    const { deps } = dependencies(adapter({ pushIssue }), { limit: 2 });

    await expect(runIntegrationWorkerCycle(prisma, deps)).resolves.toBeUndefined();

    expect(pushIssue).toHaveBeenCalledTimes(2);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: failing.id } })
    ).resolves.toMatchObject({
      state: "retry",
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: succeeding.id } })
    ).resolves.toMatchObject({
      state: "done",
    });
  });

  it("reconciles an uncertain time-entry create without duplicate hours using the worker credential", async () => {
    const fixture = await createFixture();
    const workerUser = await prisma.user.create({
      data: { email: `time-worker-${randomUUID()}@kanon.test`, passwordHash: "unused" },
    });
    userIds.add(workerUser.id);
    const worker = await prisma.member.create({
      data: {
        username: `time-worker-${randomUUID().slice(0, 8)}`,
        userId: workerUser.id,
        workspaceId: fixture.workspace.id,
      },
    });
    const workerCredential = await prisma.memberIntegrationCredential.create({
      data: {
        encryptedKey: "worker-encrypted-key",
        externalUserId: "remote-worker",
        lastAuthStatus: "valid",
        memberId: worker.id,
        connectionId: fixture.connection.id,
      },
    });
    await prisma.integrationProjectBinding.update({
      where: { id: fixture.binding.id },
      data: {
        writeMap: { todo: "1", in_progress: "2", done: "3", _timeEntryActivityId: "9" },
      },
    });
    await createRef(fixture, "issue", fixture.issue.id, "remote-issue-99");
    const entry = await prisma.timeEntry.create({
      data: {
        memberId: worker.id,
        issueId: fixture.issue.id,
        hours: "1.5",
        workedOn: new Date("2026-07-29T08:00:00.000Z"),
        status: "approved",
      },
    });
    const work = await createWork(fixture, {
      entityType: "time_entry",
      entityId: entry.id,
      actorKey: `member:${worker.id}`,
      authCredentialId: workerCredential.id,
      payload: { version: 1, targetHours: "1.5", entryIds: [entry.id] },
    });
    const pushTimeEntry = vi
      .fn()
      .mockRejectedValue(new ProviderDispatchError("ambiguous", new Error("response lost")));
    const reconcileCreate = vi.fn().mockResolvedValue([success("remote-time-71")]);
    const provider = adapter({ pushTimeEntry, reconcileCreate });
    const decrypt = vi.fn(() => "worker-api-key");
    const { deps, createAdapter } = dependencies(provider, { decrypt });

    await runIntegrationWorkerCycle(prisma, deps);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "ambiguous" });
    expect(pushTimeEntry).toHaveBeenCalledOnce();
    expect(pushTimeEntry).toHaveBeenCalledWith(
      expect.objectContaining({ id: entry.id, issueId: fixture.issue.id, hours: "1.5" }),
      "9",
    );
    expect(decrypt).toHaveBeenCalledWith("worker-encrypted-key");
    expect(createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "worker-api-key" }),
    );

    await runIntegrationWorkerCycle(prisma, deps);
    expect(reconcileCreate).toHaveBeenCalledWith({
      entityType: "time_entry",
      entityId: entry.id,
      remoteProjectId: "remote-project",
      remoteIssueId: "remote-issue-99",
      spentOn: "2026-07-29",
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } }),
    ).resolves.toMatchObject({ state: "done" });
    await expect(
      prisma.externalRef.findUniqueOrThrow({
        where: {
          connectionId_entityType_entityId: {
            connectionId: fixture.connection.id,
            entityType: "time_entry",
            entityId: entry.id,
          },
        },
      }),
    ).resolves.toMatchObject({ externalId: "remote-time-71" });

    await runIntegrationWorkerCycle(prisma, deps);
    expect(pushTimeEntry).toHaveBeenCalledOnce();
    expect(reconcileCreate).toHaveBeenCalledOnce();
  });

  it("transactionally requeues dead work exactly once without losing audit fields", async () => {
    const fixture = await createFixture();
    const dead = await createWork(fixture, { state: "dead", attempts: 3 });
    await expect(requeueDeadIntegrationWork(prisma, dead.id, { now: NOW })).resolves.toBe(true);
    await expect(requeueDeadIntegrationWork(prisma, dead.id, { now: NOW })).resolves.toBe(false);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: dead.id } })
    ).resolves.toMatchObject({
      state: "retry",
      attempts: 3,
      availableAt: NOW,
      correlationId: dead.correlationId,
      payload: dead.payload,
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FAR_FUTURE);
    const skewed = await createWork(fixture, {
      state: "dead",
      attempts: 2,
      dedupeKey: randomUUID(),
      laneKey: randomUUID(),
    });
    const [before] = await prisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS "now"`;
    await expect(requeueDeadIntegrationWork(prisma, skewed.id)).resolves.toBe(true);
    const requeued = await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: skewed.id } });
    expect(requeued.availableAt.getTime() - before!.now.getTime()).toBeGreaterThanOrEqual(0);
    expect(requeued.availableAt.getTime() - before!.now.getTime()).toBeLessThan(5_000);
  });
});
