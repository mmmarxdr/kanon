import { describe, expect, it } from "vitest";
import {
  CANONICALIZATION_VERSION,
  canonicalJson,
  canonicalJsonBytes,
  computeProposalIdentity,
} from "./canonical.js";

describe("triage-c14n.v1", () => {
  it("normalizes declared text, sorts normalized keys, and canonicalizes declared sets", () => {
    expect(canonicalJson({ b: "ｔｅｘｔ", a: "x" }, { textFields: ["b"] })).toBe('{"a":"x","b":"text"}');
    expect(canonicalJson({ "Ａ": 1, z: 2 })).toBe('{"A":1,"z":2}');
    expect(() => canonicalJson({ "ｅ": 1, e: 2 })).toThrow(/collision/i);
    expect(canonicalJson({ labels: ["z", "é", "z"] }, { setFields: ["labels"], textFields: ["labels"] })).toBe(
      '{"labels":["z","é"]}',
    );
    expect(canonicalJsonBytes({ version: CANONICALIZATION_VERSION })).toBeInstanceOf(Buffer);
  });

  it("keeps absence, null, set, and clear semantically distinct", () => {
    expect(canonicalJson({})).not.toBe(canonicalJson({ value: null }));
    expect(canonicalJson({ operation: "set", value: null })).not.toBe(
      canonicalJson({ operation: "clear" }),
    );
  });

  it("keeps stable identifiers and enums canonical while rejecting non-JSON numbers", () => {
    expect(canonicalJson({ id: "５５０ｅ８４００", state: "Ｉｎ Ｐｒｏｇｒｅｓｓ" })).toBe(
      '{"id":"５５０ｅ８４００","state":"Ｉｎ Ｐｒｏｇｒｅｓｓ"}',
    );
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/finite/i);
  });

  it("computes exact identity only from stable identity material", () => {
    const base = {
      contractVersion: "triage-proposal.v1",
      authorizationPolicyVersion: "authz-policy.v1",
      scope: { kind: "project" as const, workspaceId: "w1", projectId: "p1" },
      target: { issueId: "i1", sourceVersion: "isv1.a", sourceHash: "hash-a" },
      normalizedPayload: { actions: [{ concept: "priority", operation: "set", value: "urgent" }] },
      generator: { kind: "kanon_policy" as const, id: "triage-preview", version: "1" },
    };
    const first = computeProposalIdentity({
      ...base,
      previewSeal: "seal-a",
      sealIssuedAt: "2025-01-01T00:00:00.000Z",
      reason: "first wording",
      evidence: "first evidence",
      confidence: "low",
      initiator: "member-a",
      client: "client-a",
      requestTime: "2025-01-01T00:00:00.000Z",
    });
    const second = computeProposalIdentity({
      ...base,
      previewSeal: "seal-b",
      sealIssuedAt: "2026-01-01T00:00:00.000Z",
      reason: "different wording",
      evidence: "different evidence",
      confidence: "high",
      initiator: "member-b",
      client: "client-b",
      requestTime: "2026-01-01T00:00:00.000Z",
    });
    expect(first).toBe(second);
    expect(computeProposalIdentity({ ...base, normalizedPayload: { action: "changed" } })).not.toBe(first);
  });
});
