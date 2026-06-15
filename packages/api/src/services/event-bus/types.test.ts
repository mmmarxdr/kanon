/**
 * KAN-102 Phase 3 — DomainEventType union membership tests.
 *
 * This file is both a TypeScript type-level test and a Vitest runtime test.
 * The RED/GREEN gate is `tsc --noEmit`; vitest executes the trivial assertions.
 */
import { describe, it, expect } from "vitest";
import type { DomainEventType } from "./types.js";

describe("DomainEventType union — KAN-102 type plumbing", () => {
  it("accepts worklog.created (new event — emitted from work-session/service.ts)", () => {
    const a: DomainEventType = "worklog.created";
    expect(a).toBe("worklog.created");
  });

  it("accepts ppm.forecast.updated (new event — seam for PPM P2 rollup-listener)", () => {
    const b: DomainEventType = "ppm.forecast.updated";
    expect(b).toBe("ppm.forecast.updated");
  });

  it("rejects worklog.promoted (removed in KAN-102 — was dead, never emitted)", () => {
    // @ts-expect-error worklog.promoted removed from DomainEventType in KAN-102
    const c: DomainEventType = "worklog.promoted";
    // The @ts-expect-error above is the actual gate.
    // The runtime value exists only to satisfy the variable; it is never used.
    expect(typeof c).toBe("string");
  });
});
