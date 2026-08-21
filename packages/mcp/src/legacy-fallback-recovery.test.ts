import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureJournal } from "./capture-journal.js";
import {
  configureCaptureJournal,
  hydrateTrackedCapture,
  noteActivity,
  stopAllAutoHeartbeats,
} from "./heartbeat.js";
import { KanonClient } from "./kanon-client.js";

const scopeHash = "a".repeat(64);
const captureIntent = {
  epoch: "11111111-1111-4111-8111-111111111111",
  leaseGeneration: 7,
  state: "capturing" as const,
};
const directories: string[] = [];

function response(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

afterEach(async () => {
  stopAllAutoHeartbeats();
  configureCaptureJournal(null);
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("legacy work-capture fallback recovery", () => {
  it("persists the accepted legacy command before a lost fallback response and replays it after upgrade", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kan243-legacy-fallback-"));
    directories.push(directory);
    const journal = new CaptureJournal({ directory });
    const client = new KanonClient({ baseUrl: "https://kanon.example.test", apiKey: "token" });
    const oldApiBodies: Array<Record<string, unknown>> = [];
    let journalAtLegacyIo: unknown = null;
    const oldApiFetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      oldApiBodies.push(body);
      if (oldApiBodies.length === 1) {
        return response({ code: "VALIDATION_ERROR", message: "Unknown ownerId" }, 400);
      }
      journalAtLegacyIo = (await journal.scan(scopeHash))[0]?.record ?? null;
      throw new TypeError("legacy response lost after acceptance");
    });
    vi.stubGlobal("fetch", oldApiFetch);
    configureCaptureJournal({ journal, scopeHash });
    hydrateTrackedCapture({ issueKey: "KAN-243", client, captureIntent });

    await noteActivity(["KAN-243"]);
    stopAllAutoHeartbeats();

    const [persisted] = await journal.scan(scopeHash);
    expect(persisted).toBeDefined();
    const upgradedBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        upgradedBodies.push(body);
        if ("ownerId" in body) {
          return response(
            {
              code: "CAPTURE_EFFECT_COMMAND_CONFLICT",
              message: "Command was already accepted without an owner",
            },
            409
          );
        }
        return response(
          {
            ok: true,
            commandId: body["commandId"],
            deliveryStatus: "pending",
            captureIntent,
          },
          202
        );
      })
    );
    configureCaptureJournal({ journal, scopeHash });
    hydrateTrackedCapture({
      issueKey: "KAN-243",
      client,
      captureIntent,
      signal: persisted,
    });

    await noteActivity(["KAN-243"]);
    stopAllAutoHeartbeats();

    const legacyCommand = oldApiBodies[1];
    expect.soft(oldApiBodies).toHaveLength(2);
    expect.soft(oldApiBodies[0]).toMatchObject({ ownerId: expect.any(String) });
    expect.soft(legacyCommand).not.toHaveProperty("ownerId");
    expect.soft(journalAtLegacyIo).toMatchObject({ version: 2, command: legacyCommand });
    expect.soft(persisted?.record).toMatchObject({ version: 2, command: legacyCommand });
    expect.soft(upgradedBodies).toEqual([legacyCommand]);
    expect(await journal.scan(scopeHash)).toEqual([]);
  });
});
