import { describe, expect, it } from "vitest";
import {
  captureChangedIssueFields,
  canonicalizeIssueMutationDraft,
  type IssueCaptureFields,
  type IssueMutationDraft,
  type IssueMutationRow,
} from "./issue-mutation-contract.js";
const baseIssue = {
  ...JSON.parse(
    [
      '{"id":"issue-1","key":"KAN-1","sequenceNum":1,"title":"Initial title","description":"Initial description","type":"task","priority":"medium","state":"todo",',
      '"labels":["one"],"completedAt":null,"timeConfirmedAt":null,"groupKey":null,"engramContext":{"nested":["value"]},"specArtifacts":[{"path":"spec.md"}],',
      '"projectId":"project-1","assigneeId":"member-1","estimate":3,"cycleId":"cycle-1","parentId":null,"roadmapItemId":null}',
    ].join("")
  ),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  privacyHeldAt: null,
  privacyHoldGeneration: 0,
} as IssueMutationRow;
const changedFields = (): IssueCaptureFields => ({
  title: "Changed title",
  description: "Changed description",
  state: "in_progress",
  assigneeId: null,
  cycleId: "cycle-2",
  estimate: 8,
});
const issue = (overrides: Partial<IssueMutationRow> = {}): IssueMutationRow => ({
  ...structuredClone(baseIssue),
  ...overrides,
});
const captureDefaults = {
  bindingId: "binding-1",
  direction: "outbound" as const,
  actorKey: "member-1",
  actorKind: "user" as const,
  correlationId: "correlation-1",
};
function draft(
  result = issue(),
  fields: IssueCaptureFields = changedFields(),
  operation: IssueMutationDraft["capture"]["operation"] = "update"
): IssueMutationDraft {
  return {
    result,
    capture: { ...captureDefaults, operation, fields },
  };
}
const rejected = (action: () => unknown): void => expect(action).toThrow(TypeError);
describe("captureChangedIssueFields", () => {
  it("omits unchanged legacy content and keeps genuine changes", () => {
    const before = { title: "Same title", description: "Old description" };
    expect(
      captureChangedIssueFields(
        { title: "Same title", description: "New description", priority: "high" },
        before
      )
    ).toEqual({ description: "New description", priority: "high" });
    expect(captureChangedIssueFields({ title: "New title", description: "Old description" }, before))
      .toEqual({ title: "New title" });
  });
});
describe("canonicalizeIssueMutationDraft", () => {
  it("returns a detached settled row and exact frozen six-field payload", () => {
    const input = draft();
    const result: ReturnType<typeof canonicalizeIssueMutationDraft> =
      canonicalizeIssueMutationDraft(input);

    expect(result.result).not.toBe(input.result);
    expect(result.payload.version).toBe(1);
    expect(result.payload.fields).toBe(result.capture.fields);
    expect(result.payload.fields).toEqual(changedFields());
    expect(result.payload.issue).toMatchObject({
      estimate: 3,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const heldAt = new Date("2026-08-20T13:00:00.000Z");
    expect(
      canonicalizeIssueMutationDraft(
        draft(issue({ privacyHeldAt: heldAt, privacyHoldGeneration: 7 }))
      )
    ).toMatchObject({ result: { privacyHeldAt: heldAt, privacyHoldGeneration: 7 } });
    expect(
      [result.payload, result.payload.fields, result.payload.issue].every(Object.isFrozen)
    ).toBe(true);
    expect(result.result.id).toBe(input.result.id);
    input.result.labels.push("caller mutation");
    (input.result.engramContext as { nested: string[] }).nested[0] = "mutated";
    input.result.updatedAt.setUTCFullYear(2030);
    (input.capture.fields as { title: string }).title = "caller mutation";

    expect(result.result.labels).toEqual(["one"]);
    expect(result.result.engramContext).toEqual({ nested: ["value"] });
    expect(result.payload.issue.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(result.payload.fields.title).toBe("Changed title");
    expect(
      () => ((result.payload.fields as Record<string, unknown>)["title"] = "blocked")
    ).toThrow();
    const dated = draft(
      issue({
        description: null,
        estimate: null,
        completedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
      { description: null, estimate: null },
      "create"
    );
    const availableAt = new Date("2026-01-04T00:00:00.000Z");
    const datedResult = canonicalizeIssueMutationDraft({
      ...dated,
      capture: { ...dated.capture, availableAt },
    });
    expect(datedResult.capture.availableAt).toEqual(availableAt);
    expect(datedResult.capture.availableAt).not.toBe(availableAt);
    expect(datedResult.payload.issue.completedAt).toBe("2026-01-03T00:00:00.000Z");
  });
  it("accepts only a non-empty remote source version", () => {
    const input = draft();
    const accepted = canonicalizeIssueMutationDraft({
      ...input,
      capture: {
        ...input.capture,
        direction: "inbound",
        actorKind: "remote",
        sourceVersion: "sha256:remote-version",
      },
    });
    expect(accepted.capture.sourceVersion).toBe("sha256:remote-version");

    for (const sourceVersion of ["", 42]) {
      rejected(() =>
        canonicalizeIssueMutationDraft({
          ...input,
          capture: { ...input.capture, sourceVersion },
        }),
      );
    }
  });

  it("rejects invalid values, descriptors, prototypes, thenables, and JSON graphs", () => {
    for (const fields of [{ title: null }, { state: null }, { estimate: 1.5 }]) {
      rejected(() => canonicalizeIssueMutationDraft(draft(issue(), fields as never)));
    }

    for (const kind of ["accessor", "prototype"] as const) {
      const value = draft();
      if (kind === "accessor") {
        Object.defineProperty(value.capture.fields, "title", {
          enumerable: true,
          get: () => "hidden",
        });
      } else Object.setPrototypeOf(value.result, { inherited: true });
      rejected(() => canonicalizeIssueMutationDraft(value));
    }

    let invoked = false;
    const base = draft();
    const thenable = {
      ...base,
      result: Object.assign({ then: () => (invoked = true) }, base.result) as IssueMutationRow,
    };
    rejected(() => canonicalizeIssueMutationDraft(thenable));
    expect(invoked).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    rejected(() =>
      canonicalizeIssueMutationDraft(draft(issue({ engramContext: cyclic as never })))
    );

    let deeplyNested: Record<string, unknown> = {};
    for (let depth = 0; depth < 101; depth += 1) deeplyNested = { nested: deeplyNested };
    rejected(() =>
      canonicalizeIssueMutationDraft(draft(issue({ specArtifacts: deeplyNested as never })))
    );
  });
});
