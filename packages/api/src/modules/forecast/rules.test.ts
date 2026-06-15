/**
 * Unit tests for forecast/rules.ts — KAN-113.
 * Pure decision functions; zero I/O, zero Prisma.
 */
import { describe, it, expect } from "vitest";
import { computeForecastHash, proposalExceedsThreshold, milestoneIsManual } from "./rules.js";
import type { IssueForecastEntry } from "./types.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<IssueForecastEntry> = {}): IssueForecastEntry {
  return {
    forecastStart: null,
    forecastEnd: null,
    critical: false,
    floatDays: null,
    slipDays: 0,
    computedAt: new Date("2026-06-15T00:00:00Z"),
    ...overrides,
  };
}

// ─── computeForecastHash ─────────────────────────────────────────────────────

describe("computeForecastHash", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = computeForecastHash(makeEntry());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for identical entries (deterministic)", () => {
    const entry = makeEntry({ slipDays: 2, critical: true, floatDays: 0 });
    expect(computeForecastHash(entry)).toBe(computeForecastHash(entry));
  });

  it("returns different hashes when slipDays differs", () => {
    const a = makeEntry({ slipDays: 0 });
    const b = makeEntry({ slipDays: 1 });
    expect(computeForecastHash(a)).not.toBe(computeForecastHash(b));
  });

  it("returns different hashes when critical differs", () => {
    const a = makeEntry({ critical: false });
    const b = makeEntry({ critical: true });
    expect(computeForecastHash(a)).not.toBe(computeForecastHash(b));
  });

  it("returns different hashes when forecastEnd differs", () => {
    const a = makeEntry({ forecastEnd: new Date("2026-06-10") });
    const b = makeEntry({ forecastEnd: new Date("2026-06-20") });
    expect(computeForecastHash(a)).not.toBe(computeForecastHash(b));
  });

  it("returns different hashes when forecastStart differs", () => {
    const a = makeEntry({ forecastStart: new Date("2026-06-01") });
    const b = makeEntry({ forecastStart: new Date("2026-06-05") });
    expect(computeForecastHash(a)).not.toBe(computeForecastHash(b));
  });

  it("returns different hashes when floatDays differs", () => {
    const a = makeEntry({ floatDays: 0 });
    const b = makeEntry({ floatDays: 5 });
    expect(computeForecastHash(a)).not.toBe(computeForecastHash(b));
  });

  it("handles null forecastStart and forecastEnd gracefully", () => {
    const hash = computeForecastHash(makeEntry({ forecastStart: null, forecastEnd: null }));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of computedAt (computedAt is NOT part of the hash payload)", () => {
    // computedAt changes every rebuild — the hash must be stable so the skip gate works
    const a = makeEntry({ computedAt: new Date("2026-06-01T00:00:00Z") });
    const b = makeEntry({ computedAt: new Date("2026-06-15T12:00:00Z") });
    expect(computeForecastHash(a)).toBe(computeForecastHash(b));
  });
});

// ─── proposalExceedsThreshold ─────────────────────────────────────────────────

describe("proposalExceedsThreshold", () => {
  // Critical path: threshold = slipDays > 0
  describe("critical = true", () => {
    it("returns false when slipDays = 0", () => {
      expect(proposalExceedsThreshold({ critical: true, slipDays: 0 })).toBe(false);
    });

    it("returns true when slipDays = 1 (any positive slip on critical path)", () => {
      expect(proposalExceedsThreshold({ critical: true, slipDays: 1 })).toBe(true);
    });

    it("returns true when slipDays = 2", () => {
      expect(proposalExceedsThreshold({ critical: true, slipDays: 2 })).toBe(true);
    });

    it("returns true when slipDays = 3", () => {
      expect(proposalExceedsThreshold({ critical: true, slipDays: 3 })).toBe(true);
    });
  });

  // Non-critical: threshold = slipDays > 2
  describe("critical = false", () => {
    it("returns false when slipDays = 0", () => {
      expect(proposalExceedsThreshold({ critical: false, slipDays: 0 })).toBe(false);
    });

    it("returns false when slipDays = 1", () => {
      expect(proposalExceedsThreshold({ critical: false, slipDays: 1 })).toBe(false);
    });

    it("returns false when slipDays = 2 (boundary — exactly 2 is NOT over threshold)", () => {
      expect(proposalExceedsThreshold({ critical: false, slipDays: 2 })).toBe(false);
    });

    it("returns true when slipDays = 3 (first value over threshold)", () => {
      expect(proposalExceedsThreshold({ critical: false, slipDays: 3 })).toBe(true);
    });

    it("returns true when slipDays = 10", () => {
      expect(proposalExceedsThreshold({ critical: false, slipDays: 10 })).toBe(true);
    });
  });
});

// ─── milestoneIsManual ────────────────────────────────────────────────────────

describe("milestoneIsManual", () => {
  it("returns true for status = 'met'", () => {
    expect(milestoneIsManual("met")).toBe(true);
  });

  it("returns true for status = 'missed'", () => {
    expect(milestoneIsManual("missed")).toBe(true);
  });

  it("returns false for status = 'upcoming'", () => {
    expect(milestoneIsManual("upcoming")).toBe(false);
  });

  it("returns false for status = 'at_risk'", () => {
    expect(milestoneIsManual("at_risk")).toBe(false);
  });

  it("returns false for an unknown status string", () => {
    expect(milestoneIsManual("unknown")).toBe(false);
  });
});
