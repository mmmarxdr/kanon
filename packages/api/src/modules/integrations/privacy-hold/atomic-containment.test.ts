import { describe, expect, it, vi } from "vitest";
import { createAtomicContainment } from "./atomic-containment.js";
import { contentHash } from "./content-provenance.js";

describe("atomic privacy containment", () => {
  it("encrypts only current Kanon content and commits it serializably", async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ value: {
        status: "prepared", generation: 3, title: "Local title", description: "Remote body",
        provenance: [
          { field: "title", origin: "kanon", contentHash: contentHash("title", "Local title") },
          { field: "description", origin: "redmine", contentHash: contentHash("description", "Remote body") },
        ],
      } }])
      .mockResolvedValueOnce([{ value: { status: "contained", generation: 3 } }]);
    const transaction = vi.fn(async (callback) => callback({ $queryRaw: queryRaw }));
    const encrypt = vi.fn().mockReturnValue("pq.gcm.v1:key:2:iv:cipher:tag");
    const contain = createAtomicContainment({ $transaction: transaction } as never, encrypt);

    await expect(contain({ issueId: "issue-1", bindingId: "binding-1" })).resolves.toEqual({
      status: "contained", generation: 3,
    });

    const plaintext = encrypt.mock.calls[0]![0];
    expect(JSON.parse(plaintext)).toEqual({
      generation: 3,
      fields: { title: { origin: "kanon", value: "Local title" }, description: { origin: "redmine" } },
    });
    expect(plaintext).not.toContain("Remote body");
    expect(encrypt).toHaveBeenCalledWith(plaintext, {
      issueId: "issue-1", bindingId: "binding-1", generation: 3,
    }, undefined, 2);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("returns an exact held generation without encrypting or committing again", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ value: { status: "contained", generation: 7 } }]);
    const transaction = vi.fn(async (callback) => callback({ $queryRaw: queryRaw }));
    const encrypt = vi.fn();
    const contain = createAtomicContainment({ $transaction: transaction } as never, encrypt);

    await expect(contain({ issueId: "issue-1", bindingId: "binding-1" })).resolves.toEqual({
      status: "contained", generation: 7,
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(encrypt).not.toHaveBeenCalled();
  });

  it("omits unknown, missing, and hash-mismatched plaintext", async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{ value: {
        status: "prepared", generation: 4, title: "Changed locally", description: "Unproven body",
        provenance: [{ field: "title", origin: "kanon", contentHash: contentHash("title", "Old title") }],
      } }])
      .mockResolvedValueOnce([{ value: { status: "contained", generation: 4 } }]);
    const transaction = vi.fn(async (callback) => callback({ $queryRaw: queryRaw }));
    const encrypt = vi.fn().mockReturnValue("pq.gcm.v1:key:2:iv:cipher:tag");

    await createAtomicContainment({ $transaction: transaction } as never, encrypt)({
      issueId: "issue-1", bindingId: "binding-1",
    });

    const plaintext = encrypt.mock.calls[0]![0];
    expect(JSON.parse(plaintext).fields).toEqual({
      title: { origin: "unknown" }, description: { origin: "unknown" },
    });
    expect(plaintext).not.toMatch(/Changed locally|Unproven body/);
  });

  it("collapses containment failures to a content-free boundary", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ value: {
      status: "prepared", generation: 1, title: "Secret title", description: null, provenance: [],
    } }]);
    const transaction = vi.fn(async (callback) => callback({ $queryRaw: queryRaw }));
    const contain = createAtomicContainment(
      { $transaction: transaction } as never,
      vi.fn(() => { throw new Error("key missing for Secret title"); }),
    );

    await expect(contain({ issueId: "issue-1", bindingId: "binding-1" })).rejects.toMatchObject({
      name: "PrivacyContainmentUnavailableError", message: "privacy_hold_unavailable",
    });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it.each([
    { status: "unexpected", generation: 1, title: "Title", description: null, provenance: [] },
    { status: "prepared", generation: 0, title: "Title", description: null, provenance: [] },
  ])("rejects malformed preparation result %# without committing", async (value) => {
    const queryRaw = vi.fn().mockResolvedValue([{ value }]);
    const transaction = vi.fn(async (callback) => callback({ $queryRaw: queryRaw }));
    const contain = createAtomicContainment(
      { $transaction: transaction } as never,
      vi.fn().mockReturnValue("pq.gcm.v1:key:2:iv:cipher:tag"),
    );

    await expect(contain({ issueId: "issue-1", bindingId: "binding-1" })).rejects.toThrow(
      "privacy_hold_unavailable",
    );
    expect(queryRaw).toHaveBeenCalledOnce();
  });
});
