import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type { DomainEvent } from "../../services/event-bus/types.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { registerIntegrationSyncListener } from "./sync-listener.js";

function stubBus() {
  let handler: ((event: DomainEvent) => void) | undefined;
  return {
    bus: {
      subscribe(next: (event: DomainEvent) => void) {
        handler = next;
        return () => {
          handler = undefined;
        };
      },
    } as IEventBus,
    fire(type: DomainEvent["type"], payload: Record<string, unknown>) {
      handler?.({
        id: 1,
        type,
        workspaceId: "workspace-1",
        actorId: "member-1",
        payload,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

const logger = { error: vi.fn() };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
afterAll(disconnectTestDb);

describe("integration sync listener", () => {
  it("filters irrelevant updates and trailing-debounces global scan bursts", async () => {
    vi.useFakeTimers();
    const { bus, fire } = stubBus();
    const wake = vi.fn().mockResolvedValue([]);
    const unsubscribe = registerIntegrationSyncListener(bus, wake, logger, 2_000);

    fire("issue.updated", { issueId: "issue-1", fields: ["labels"] });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wake).not.toHaveBeenCalled();

    fire("issue.updated", { issueId: "issue-1", fields: ["title"] });
    fire("issue.transitioned", { issueId: "issue-1" });
    fire("schedule.updated", { issueId: "issue-1" });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(wake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(wake).toHaveBeenCalledOnce();

    fire("estimate.revised", { issueId: "issue-1" });
    fire("issue.transitioned", { issueId: "issue-2" });
    fire("cycle.closed", { cycleId: "cycle-1" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wake).toHaveBeenCalledTimes(2);

    const error = new Error("scan failed");
    wake.mockRejectedValueOnce(error);
    fire("issue.transitioned", { issueId: "issue-3" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(logger.error).toHaveBeenCalledWith(
      { error, entityKey: "issue:issue-3" },
      "Integration work wake-up failed",
    );

    await unsubscribe();
    fire("issue.transitioned", { issueId: "issue-4" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wake).toHaveBeenCalledTimes(3);
  });

  it("coalesces a pending burst while a scan is still running", async () => {
    vi.useFakeTimers();
    const { bus, fire } = stubBus();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wake = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue([]);
    const unsubscribe = registerIntegrationSyncListener(bus, wake, logger, 2_000);

    fire("issue.transitioned", { issueId: "issue-1" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wake).toHaveBeenCalledOnce();

    for (let index = 0; index < 100; index += 1) {
      fire("issue.transitioned", { issueId: `issue-${index + 2}` });
    }
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wake).toHaveBeenCalledOnce();

    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(wake).toHaveBeenCalledTimes(2);
    await unsubscribe();
  });

  it("stops new triggers synchronously and drains an in-flight wake", async () => {
    vi.useFakeTimers();
    const { bus, fire } = stubBus();
    let release!: () => void;
    const wake = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const unsubscribe = registerIntegrationSyncListener(bus, wake, logger, 100);

    fire("issue.transitioned", { issueId: "issue-1" });
    await vi.advanceTimersByTimeAsync(100);
    const drain = unsubscribe();
    fire("issue.transitioned", { issueId: "issue-2" });
    await vi.advanceTimersByTimeAsync(500);

    let drained = false;
    void drain.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(wake).toHaveBeenCalledOnce();
    release();
    await drain;
    expect(drained).toBe(true);
    expect(wake).toHaveBeenCalledOnce();
  });

  it("shares one non-overlapping app run across scheduler and listener triggers", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const scan = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const app = await buildApp({ integrationScan: scan });
    await app.ready();

    await vi.advanceTimersByTimeAsync(60_000);
    eventBus.emit({
      type: "issue.updated",
      workspaceId: "workspace-1",
      actorId: "member-1",
      payload: { issueId: "issue-1", fields: ["title"] },
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(scan).toHaveBeenCalledOnce();

    const closing = app.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(closed).toBe(true);
  });

  it("registers with the app and cancels pending work on close", async () => {
    vi.useFakeTimers();
    const scan = vi.fn().mockResolvedValue([]);
    const app = await buildApp({ integrationScan: scan });
    let closed = false;
    try {
      await app.ready();
      eventBus.emit({
        type: "issue.updated",
        workspaceId: "workspace-1",
        actorId: "member-1",
        payload: { issueId: "issue-1", fields: ["description"] },
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(scan).toHaveBeenCalledOnce();

      eventBus.emit({
        type: "issue.updated",
        workspaceId: "workspace-1",
        actorId: "member-1",
        payload: { issueId: "issue-2", fields: ["title"] },
      });
      await app.close();
      closed = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(scan).toHaveBeenCalledOnce();
    } finally {
      if (!closed) await app.close();
    }
  });

  it("keeps the HTTP actor credential and skips irrelevant durable work", async () => {
    await cleanDatabase();
    const app = await buildApp({ integrationScan: vi.fn().mockResolvedValue([]) });
    try {
      await app.ready();
      const workspace = await seedTestWorkspace();
      const member = await seedTestMember(workspace.id);
      const project = await seedTestProject(workspace.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const connection = await prisma.integrationConnection.create({
        data: {
          provider: "redmine",
          baseUrl: "https://pm.example.test",
          workspaceId: workspace.id,
        },
      });
      await prisma.integrationProjectBinding.create({
        data: {
          connectionId: connection.id,
          projectId: project.id,
          remoteProjectId: "remote-project",
          readMap: { open: "backlog" },
          writeMap: { backlog: "open" },
        },
      });
      const credential = await prisma.memberIntegrationCredential.create({
        data: {
          connectionId: connection.id,
          memberId: member.id,
          encryptedKey: "encrypted-test-key",
          lastAuthStatus: "valid",
          lastValidatedAt: new Date(),
        },
      });
      const issue = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          sequenceNum: 1,
          title: "Before",
          labels: [],
          projectId: project.id,
        },
      });

      const relevant = await app.inject({
        method: "PATCH",
        url: `/api/issues/${issue.key}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { title: "After" },
      });
      expect(relevant.statusCode).toBe(200);
      await expect(
        prisma.integrationSyncWork.findFirstOrThrow({ where: { entityId: issue.id } }),
      ).resolves.toMatchObject({
        actorKey: `member:${member.id}`,
        actorKind: "user",
        authCredentialId: credential.id,
        payload: expect.objectContaining({ fields: { title: "After" } }),
      });

      await prisma.integrationSyncWork.deleteMany();
      const irrelevant = await app.inject({
        method: "PATCH",
        url: `/api/issues/${issue.key}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { labels: ["local-only"] },
      });
      expect(irrelevant.statusCode).toBe(200);
      await expect(prisma.integrationSyncWork.count()).resolves.toBe(0);

      const priority = await app.inject({
        method: "PATCH",
        url: `/api/issues/${issue.key}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { priority: "high" },
      });
      expect(priority.statusCode).toBe(200);
      await expect(
        prisma.integrationSyncWork.findFirstOrThrow({ where: { entityId: issue.id } }),
      ).resolves.toMatchObject({
        authCredentialId: credential.id,
        payload: expect.objectContaining({ fields: { priority: "high" } }),
      });
    } finally {
      await app.close();
      await cleanDatabase();
    }
  });
});
