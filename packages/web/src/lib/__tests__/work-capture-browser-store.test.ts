import { describe, expect, it } from "vitest";
import {
  MemoryWorkCaptureStorage,
  SerialWorkCaptureLock,
  WorkCaptureBrowserStore,
  type CaptureScope,
} from "../work-capture-browser-store";

const scope: CaptureScope = {
  principalId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
};
const ownerId = "33333333-3333-4333-8333-333333333333";

function stores(now = () => 1_000) {
  const storage = new MemoryWorkCaptureStorage();
  const lock = new SerialWorkCaptureLock();
  const options = { storage, lock, randomUUID: () => ownerId, now, tabTtlMs: 100 };
  return {
    first: new WorkCaptureBrowserStore(options),
    second: new WorkCaptureBrowserStore(options),
  };
}

describe("WorkCaptureBrowserStore", () => {
  it("keeps one durable owner UUID for the browser profile", async () => {
    const { first, second } = stores();

    expect(await first.getOwnerId()).toBe(ownerId);
    expect(await second.getOwnerId()).toBe(ownerId);
  });

  it("uses transactional scope membership so only the final live tab leaves", async () => {
    const { first, second } = stores();

    await Promise.all([
      first.joinScope(scope, "tab-a"),
      second.joinScope(scope, "tab-b"),
    ]);

    await expect(first.leaveScope(scope, "tab-a")).resolves.toEqual({ isFinal: false });
    await expect(second.leaveScope(scope, "tab-b")).resolves.toEqual({ isFinal: true });
  });

  it("prunes crashed tab membership using the injected clock", async () => {
    let current = 1_000;
    const { first, second } = stores(() => current);
    await first.joinScope(scope, "crashed-tab");
    current = 1_101;
    await second.joinScope(scope, "live-tab");

    await expect(second.leaveScope(scope, "live-tab")).resolves.toEqual({ isFinal: true });
  });

  it("persists immutable command bytes and owner obligations", async () => {
    const { first } = stores();
    const body = JSON.stringify({
      commandId: "44444444-4444-4444-8444-444444444444",
      epoch: "55555555-5555-4555-8555-555555555555",
      leaseGeneration: 2,
      ownerId,
    });
    await first.putCommand({ scope, issueKey: "KAN-7", kind: "activity", body });
    await first.putObligation({
      scope,
      issueKey: "KAN-7",
      epoch: "55555555-5555-4555-8555-555555555555",
      leaseGeneration: 2,
      acceptance: "pending",
    });

    expect(await first.listCommands(scope)).toEqual([
      { scope, issueKey: "KAN-7", kind: "activity", body },
    ]);
    expect((await first.listObligations(scope))[0]).toMatchObject({
      issueKey: "KAN-7",
      acceptance: "pending",
    });
  });
});
