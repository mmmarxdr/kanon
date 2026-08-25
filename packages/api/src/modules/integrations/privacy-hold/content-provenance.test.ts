import { describe, expect, it, vi } from "vitest";
import {
  recordIssueContentProvenanceTx,
  type IssueContentProvenanceInput,
} from "./content-provenance.js";

const database = (upsert: ReturnType<typeof vi.fn>, findUnique = vi.fn().mockResolvedValue(null)) =>
  ({ integrationContentProvenance: { findUnique, upsert } }) as never;
const input = (overrides: Partial<IssueContentProvenanceInput> = {}): IssueContentProvenanceInput => ({
  bindingId: "binding-1", issueId: "issue-1", direction: "outbound", actorKind: "user",
  sourceVersion: "2026-08-24T12:00:00.000Z", fields: { title: "Local title" }, ...overrides,
});

describe("recordIssueContentProvenanceTx", () => {
  it("records changed local issue content as recoverable Kanon provenance", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);

    await recordIssueContentProvenanceTx(
      database(upsert),
      input({ fields: { title: "Local title", description: null } }),
    );

    const queries = upsert.mock.calls.map(([query]) => query);
    expect(queries.map(({ create }) => [create.field, create.contentHash])).toEqual([
      ["title", "sha256:cbe2f752b3c9166ff890eb31c1de5ca3cb926d1f6cb0d5693b06f40f2a57aa1c"],
      ["description", "sha256:ae7fb1437c48256120c471c7f7b40c9c24dee6e0191d34766fea3ed9e5f3ece1"],
    ]);
    for (const query of queries) {
      const { bindingId, entityType, entityId, field, ...evidence } = query.create;
      expect(evidence).toMatchObject({
        origin: "kanon", sourceVersion: "2026-08-24T12:00:00.000Z",
      });
      expect(query.where).toEqual({
        bindingId_entityType_entityId_field: { bindingId, entityType, entityId, field },
      });
      expect(query.update).toEqual(evidence);
    }
  });

  it.each([
    {
      name: "versioned remote", origin: "redmine", sourceVersion: "sha256:remote-version",
      fields: { title: "Remote title" }, field: "title",
    },
    {
      name: "unverifiable remote", origin: "unknown", sourceVersion: null,
      fields: { description: "Unversioned content" }, field: "description",
    },
  ] as const)("records $name content as $origin provenance", async (sample) => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    await recordIssueContentProvenanceTx(database(upsert), input({
      direction: "inbound", actorKind: "remote", sourceVersion: sample.sourceVersion,
      fields: sample.fields,
    }));
    const query = upsert.mock.calls[0]![0];
    expect(query.create).toMatchObject({
      field: sample.field, origin: sample.origin, sourceVersion: sample.sourceVersion,
    });
    expect(query.update).toMatchObject({ origin: sample.origin, sourceVersion: sample.sourceVersion });
  });

  it("preserves remote provenance when a local write resubmits identical content", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      contentHash: "sha256:d94524e2d9d224447340d5274c8b968999a8cc3fced7e571f43d21c3e9ce5e26",
    });
    const upsert = vi.fn().mockResolvedValue(undefined);

    await recordIssueContentProvenanceTx(
      database(upsert, findUnique),
      input({
        sourceVersion: "2026-08-24T12:00:01.000Z",
        fields: { title: "Remote title" },
      }),
    );

    expect(findUnique).toHaveBeenCalledOnce();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("propagates provenance storage failure so the caller transaction aborts", async () => {
    const upsert = vi.fn().mockRejectedValue(new Error("provenance unavailable"));

    await expect(
      recordIssueContentProvenanceTx(
        database(upsert),
        input({
          actorKind: "system",
          sourceVersion: "2026-08-24T12:00:01.000Z",
          fields: { title: "Must roll back" },
        }),
      ),
    ).rejects.toThrow("provenance unavailable");
    expect(upsert).toHaveBeenCalledOnce();
  });
});
