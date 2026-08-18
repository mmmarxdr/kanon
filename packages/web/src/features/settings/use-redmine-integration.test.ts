import { describe, expect, it } from "vitest";
import { auditHealthRefetchInterval } from "./use-redmine-integration";

describe("auditHealthRefetchInterval", () => {
  it("never polls expired cached evidence", () => {
    expect(auditHealthRefetchInterval("2026-08-14T12:05:00.000Z", Date.parse("2026-08-14T12:05:00.000Z"))).toBe(false);
    expect(auditHealthRefetchInterval("2026-08-14T12:05:00.000Z", Date.parse("2026-08-14T12:06:00.000Z"))).toBe(false);
  });

  it("uses a bounded interval before expiry", () => {
    expect(auditHealthRefetchInterval("2026-08-14T12:05:00.001Z", Date.parse("2026-08-14T12:05:00.000Z"))).toBe(1_000);
  });
});
