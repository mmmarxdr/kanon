import { describe, expect, it } from "vitest";
import { canonicalRecoveryDigest, validateRecoveryIdempotencyKey, validateFreshRecoverySnapshot } from "./recovery-service.js";

describe("recovery request contract", () => {
  it("accepts only printable ASCII idempotency keys of 16–128 bytes", () => {
    expect(validateRecoveryIdempotencyKey("a".repeat(16))).toBe("a".repeat(16));
    expect(() => validateRecoveryIdempotencyKey("short")).toThrow("invalid_idempotency_key");
    expect(() => validateRecoveryIdempotencyKey("a".repeat(129))).toThrow("invalid_idempotency_key");
    expect(() => validateRecoveryIdempotencyKey(`a${String.fromCharCode(10)}${"a".repeat(20)}`)).toThrow("invalid_idempotency_key");
  });

  it("digests canonical provider snapshots deterministically and rejects stale proof input", () => {
    const input = { providerId: "42", version: "8", title: "Title", description: "Body", scopeFingerprint: "scope", credentialFingerprint: "credential", observedAt: new Date("2026-08-20T12:00:00.000Z") };
    expect(canonicalRecoveryDigest(input)).toBe(canonicalRecoveryDigest({ ...input }));
    expect(canonicalRecoveryDigest(input)).not.toBe(canonicalRecoveryDigest({ ...input, title: "Changed" }));
  });

  it("accepts only snapshots fresh enough to mint a capability", () => {
    const observedAt = new Date("2026-08-20T12:00:00.000Z");
    expect(validateFreshRecoverySnapshot(observedAt, new Date("2026-08-20T12:00:30.000Z"))).toBe(observedAt);
    expect(() => validateFreshRecoverySnapshot(observedAt, new Date("2026-08-20T12:00:30.001Z"))).toThrow("snapshot_unavailable");
  });
});
