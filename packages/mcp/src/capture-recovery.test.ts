import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureJournal, captureScopeHash } from "./capture-journal.js";
import { recoverWorkCaptures } from "./capture-recovery.js";
import * as heartbeat from "./heartbeat.js";

const API_URL = "https://api.example.test";
const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const EPOCH = "33333333-3333-4333-8333-333333333333";
const directories: string[] = [];

function token(subject = PRINCIPAL_ID): string {
  return `x.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.x`;
}

function client() {
  return {
    listWorkCaptures: vi.fn(),
    heartbeat: vi.fn(),
    releaseWork: vi.fn(),
    closeWork: vi.fn(),
    stopWork: vi.fn(),
  };
}

async function journal(): Promise<CaptureJournal> {
  const directory = await mkdtemp(join(tmpdir(), "kan243-capture-recovery-"));
  directories.push(directory);
  return new CaptureJournal({ directory });
}

function page(
  intents: Array<{ issueKey: string; state: "adopted" | "capturing" | "paused" | "closing" }>,
  nextCursor: string | null = null
) {
  return {
    principalId: PRINCIPAL_ID,
    workspaceId: WORKSPACE_ID,
    intents: intents.map((intent) => ({ ...intent, epoch: EPOCH, leaseGeneration: 1 })),
    nextCursor,
  };
}

beforeEach(() => heartbeat.stopAllAutoHeartbeats());
afterEach(async () => {
  heartbeat.stopAllAutoHeartbeats();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("capture startup recovery", () => {
  it("hydrates all pages, sends close before release, and never sends startup activity", async () => {
    const api = client();
    api.listWorkCaptures
      .mockResolvedValueOnce(
        page([{ issueKey: "KAN-A", state: "capturing" }], "44444444-4444-4444-8444-444444444444")
      )
      .mockResolvedValueOnce(
        page([
          { issueKey: "KAN-R", state: "capturing" },
          { issueKey: "KAN-C", state: "closing" },
        ])
      );
    api.closeWork.mockResolvedValue({
      ok: true,
      commandId: "c",
      deliveryStatus: "acknowledged",
      captureIntent: null,
    });
    api.releaseWork.mockResolvedValue({
      ok: true,
      commandId: "r",
      deliveryStatus: "pending",
      captureIntent: { epoch: EPOCH, leaseGeneration: 1, state: "adopted" },
    });
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    const activity = await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-A",
      kind: "activity",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 },
    });
    await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-R",
      kind: "release",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 },
    });
    await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-C",
      kind: "close",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 },
    });

    const result = await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    expect(result).toMatchObject({ degraded: false, hydrated: 3, principalId: PRINCIPAL_ID });
    expect(api.listWorkCaptures.mock.calls).toEqual([
      [WORKSPACE_ID, undefined, 100],
      [WORKSPACE_ID, "44444444-4444-4444-8444-444444444444", 100],
    ]);
    expect(api.heartbeat).not.toHaveBeenCalled();
    expect(api.closeWork).toHaveBeenCalledOnce();
    expect(api.releaseWork).toHaveBeenCalledOnce();
    expect((await store.scan(scopeHash)).map((entry) => entry.path)).toEqual([activity.path]);
  });

  it("replays one journaled activity on first exact activity without creating a duplicate command", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(page([{ issueKey: "KAN-A", state: "capturing" }]));
    api.heartbeat.mockResolvedValue({
      ok: true,
      commandId: "accepted",
      deliveryStatus: "pending",
      captureIntent: { epoch: EPOCH, leaseGeneration: 1, state: "capturing" },
    });
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    const command = { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 };
    await store.append({ version: 2, scopeHash, issueKey: "KAN-A", kind: "activity", command });
    await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    await heartbeat.noteActivity(["KAN-A"]);

    expect(api.heartbeat).toHaveBeenCalledTimes(1);
    expect(api.heartbeat).toHaveBeenCalledWith("KAN-A", command);
    expect(await store.scan(scopeHash)).toEqual([]);
  });

  it("replays the exact recorded process owner after restart", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(page([{ issueKey: "KAN-A", state: "capturing" }]));
    api.heartbeat.mockResolvedValue({
      ok: true,
      commandId: "accepted",
      deliveryStatus: "pending",
      captureIntent: { epoch: EPOCH, leaseGeneration: 1, state: "capturing" },
    });
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    const command = {
      commandId: randomUUID(),
      epoch: EPOCH,
      leaseGeneration: 1,
      ownerId: randomUUID(),
    };
    await store.append({
      version: 3,
      scopeHash,
      issueKey: "KAN-A",
      kind: "activity",
      command,
    });

    await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });
    await heartbeat.noteActivity(["KAN-A"]);

    expect(api.heartbeat).toHaveBeenCalledExactlyOnceWith("KAN-A", command, expect.any(Object));
    expect(await store.scan(scopeHash)).toEqual([]);
  });

  it("prefers a persisted legacy fallback after a crash leaves its owner signal behind", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(page([{ issueKey: "KAN-A", state: "capturing" }]));
    api.heartbeat.mockResolvedValue({
      ok: true,
      commandId: "accepted",
      deliveryStatus: "pending",
      captureIntent: { epoch: EPOCH, leaseGeneration: 1, state: "capturing" },
    });
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    const command = { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 };
    await store.append({
      version: 3,
      scopeHash,
      issueKey: "KAN-A",
      kind: "activity",
      command: { ...command, ownerId: randomUUID() },
    });
    await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-A",
      kind: "activity",
      command,
    });

    await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    expect((await store.scan(scopeHash)).map((entry) => entry.record.version)).toEqual([2]);
    await heartbeat.noteActivity(["KAN-A"]);
    expect(api.heartbeat).toHaveBeenCalledExactlyOnceWith("KAN-A", command);
    expect(await store.scan(scopeHash)).toEqual([]);
  });

  it("does not release passively hydrated captures during shutdown", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(page([{ issueKey: "KAN-A", state: "capturing" }]));
    const store = await journal();
    await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    await heartbeat.shutdownAllHeartbeats();

    expect(api.releaseWork).not.toHaveBeenCalled();
  });

  it("hydrates paused and closing intents as suspended without issuing activity", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(
      page([
        { issueKey: "KAN-P", state: "paused" },
        { issueKey: "KAN-C", state: "closing" },
      ])
    );
    const store = await journal();
    await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    await heartbeat.noteActivity(["KAN-P", "KAN-C"]);

    expect(api.heartbeat).not.toHaveBeenCalled();
  });

  it("degrades visibly on an old API 404 and retains valid journal signals", async () => {
    const api = client();
    api.listWorkCaptures.mockRejectedValue({ statusCode: 404, code: "NOT_FOUND" });
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    const signal = await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-A",
      kind: "activity",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 },
    });
    const log = vi.fn();

    await expect(
      recoverWorkCaptures({
        client: api as any,
        apiUrl: API_URL,
        apiKey: token(),
        workspaceId: WORKSPACE_ID,
        journal: store,
        log,
      })
    ).resolves.toMatchObject({ degraded: true, principalId: PRINCIPAL_ID });
    expect(log).toHaveBeenCalled();
    expect((await store.scan(scopeHash)).map((entry) => entry.path)).toEqual([signal.path]);
  });

  it("preserves without replaying signals omitted by token-scoped hydration", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(page([]));
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    const activity = await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-HIDDEN",
      kind: "activity",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 },
    });
    const release = await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-HIDDEN",
      kind: "release",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 1 },
    });

    await recoverWorkCaptures({
      client: api as unknown as Parameters<typeof recoverWorkCaptures>[0]["client"],
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    expect(api.heartbeat).not.toHaveBeenCalled();
    expect(api.releaseWork).not.toHaveBeenCalled();
    expect(api.closeWork).not.toHaveBeenCalled();
    expect((await store.scan(scopeHash)).map((entry) => entry.path).sort()).toEqual(
      [activity.path, release.path].sort()
    );
  });

  it("removes signals whose fence is proven stale by authoritative hydration", async () => {
    const api = client();
    api.listWorkCaptures.mockResolvedValue(page([{ issueKey: "KAN-A", state: "capturing" }]));
    const store = await journal();
    const scopeHash = captureScopeHash(API_URL, PRINCIPAL_ID, WORKSPACE_ID);
    await store.append({
      version: 2,
      scopeHash,
      issueKey: "KAN-A",
      kind: "activity",
      command: { commandId: randomUUID(), epoch: EPOCH, leaseGeneration: 99 },
    });

    await recoverWorkCaptures({
      client: api as any,
      apiUrl: API_URL,
      apiKey: token(),
      workspaceId: WORKSPACE_ID,
      journal: store,
      log: vi.fn(),
    });

    expect(await store.scan(scopeHash)).toEqual([]);
  });
});
