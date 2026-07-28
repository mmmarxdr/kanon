import { describe, expect, it } from "vitest";
import {
  CursorSourceConflictError,
  decodeCursor,
  encodeCursor,
  validateCursorBindings,
} from "./cursor.js";

const key = "test-cursor-secret";
const payload = {
  query: "kan-1",
  scope: "project:p1",
  projection: "compact",
  authorizationDigest: "auth-1",
  targetIssueId: "target-1",
  orderVersion: "issue-search.v1",
  rankingPolicyVersion: "rank-1",
  sourceFingerprint: "source-1",
  seek: { rank: 1, issueId: "i1" },
};

describe("authenticated opaque triage cursors", () => {
  it("round-trips without exposing readable domain data and is deterministic", () => {
    const token = encodeCursor(payload, { key, context: "issue-search.v1" });
    expect(token).not.toContain("kan-1");
    expect(token).not.toContain("target-1");
    expect(token).not.toContain("i1");
    expect(token).toBe(encodeCursor(payload, { key, context: "issue-search.v1" }));
    expect(decodeCursor(token, { key, context: "issue-search.v1" })).toEqual(payload);
  });

  it("rejects tampering and wrong contexts", () => {
    const token = encodeCursor(payload, { key, context: "issue-search.v1" });
    const parts = token.split(".");
    parts[3] = `${parts[3]!.slice(0, -1)}${parts[3]!.endsWith("A") ? "B" : "A"}`;
    expect(() => decodeCursor(parts.join("."), { key, context: "issue-search.v1" })).toThrow();
    expect(() => decodeCursor(token, { key, context: "triage-proposal-list.v1" })).toThrow();
  });

  it("rejects changed source, authorization, query, projection, order, and seek bindings", () => {
    const token = encodeCursor(payload, { key, context: "issue-search.v1" });
    expect(() => validateCursorBindings(token, { ...payload, sourceFingerprint: "source-2" }, { key, context: "issue-search.v1" })).toThrow(CursorSourceConflictError);
    for (const changed of [
      { query: "other" }, { authorizationDigest: "auth-2" }, { projection: "full" },
      { orderVersion: "issue-search.v2" }, { rankingPolicyVersion: "rank-2" }, { seek: { rank: 2, issueId: "i2" } },
    ]) {
      expect(() => validateCursorBindings(token, { ...payload, ...changed }, { key, context: "issue-search.v1" })).toThrow(/bindings/);
    }
  });

  it("rejects a wrong key and preserves a separate list cursor context", () => {
    const token = encodeCursor(payload, { key, context: "issue-search.v1" });
    expect(() => decodeCursor(token, { key: "wrong-key", context: "issue-search.v1" })).toThrow();
    const listToken = encodeCursor(payload, { key, context: "triage-proposal-list.v1" });
    expect(() => decodeCursor(listToken, { key, context: "issue-search.v1" })).toThrow();
  });
});
