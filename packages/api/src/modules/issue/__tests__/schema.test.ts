import { describe, it, expect } from "vitest";
import { ReconcileTimeBody } from "../schema.js";

/**
 * KAN-188 — ReconcileTimeBody confirmed-total override.
 *
 * LOCKED RULE: addHours and confirmedTotalHours are MUTUALLY EXCLUSIVE.
 * A body containing both MUST be rejected with a schema-level 400 before
 * any reconcile side effect runs — no "override wins" precedence.
 */
describe("ReconcileTimeBody — confirmedTotalHours override", () => {
  it("accepts a valid non-negative decimal string override alone", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "4" });
    expect(result.success).toBe(true);
  });

  it("accepts a decimal override with fractional hours", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "4.5" });
    expect(result.success).toBe(true);
  });

  it("rejects an override exceeding 744 hours", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "745" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative override value", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-decimal override value", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "abc" });
    expect(result.success).toBe(false);
  });

  // Review fix (WARNING): hours is Decimal(8,2) — Postgres truncates values
  // with more than 2 decimal places, so the stored total would silently
  // diverge from the confirmed value. Reject at schema validation instead.
  it("rejects an override with more than 2 decimal places", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "4.999" });
    expect(result.success).toBe(false);
  });

  it("accepts an override with exactly 2 decimal places", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "4.99" });
    expect(result.success).toBe(true);
  });

  it("accepts an override with 1 decimal place", () => {
    const result = ReconcileTimeBody.safeParse({ confirmedTotalHours: "4.9" });
    expect(result.success).toBe(true);
  });

  it("rejects a request providing BOTH addHours and confirmedTotalHours", () => {
    const result = ReconcileTimeBody.safeParse({
      addHours: "1",
      confirmedTotalHours: "4",
    });
    expect(result.success).toBe(false);
  });

  it("still accepts addHours alone (existing additive path unaffected)", () => {
    const result = ReconcileTimeBody.safeParse({ addHours: "2.5" });
    expect(result.success).toBe(true);
  });

  it("accepts an empty body (both fields optional)", () => {
    const result = ReconcileTimeBody.safeParse({});
    expect(result.success).toBe(true);
  });
});
