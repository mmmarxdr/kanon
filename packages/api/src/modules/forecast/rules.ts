/**
 * Forecast decision rules — KAN-113.
 *
 * Pure functions (no Prisma, no I/O). Extracted from service.ts so this
 * module is mutation-testable independently of DB integration tests.
 *
 * Stryker mutate scope: src/modules/forecast/rules.ts (see stryker.config.mjs).
 */
import { createHash } from "node:crypto";
import type { IssueForecastEntry } from "./types.js";

// ─── Hash helpers ─────────────────────────────────────────────────────────────

/** SHA-256 hex of an arbitrary string. */
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Hash of an issue's COMPUTED forecast output (used for the skip-write gate).
 *
 * We key on the OUTPUT, not on the issue's local inputs. This is essential
 * for a CPM engine: a successor's forecast changes when an upstream predecessor
 * slips, even though the successor's own inputs (estimate, dates, deps) are
 * unchanged. An input-keyed hash would skip the successor's write and leave its
 * row stale — silently dropping propagated slip. Hashing the output makes the
 * gate change exactly when the persisted forecast would.
 *
 * NOTE: `computedAt` is intentionally excluded from the payload so that the
 * hash stays stable across repeated rebuilds on identical data.
 *
 * KAN-147 (ADR-0007): an optional `calendarFingerprint` is folded into the hash
 * so that changing a project's working-day calendar (work days / holidays)
 * invalidates the per-issue dedup and forces a rebuild — even when an issue's
 * own computed output would otherwise look unchanged at the moment of hashing.
 */
export function computeForecastHash(
  entry: IssueForecastEntry,
  calendarFingerprint?: string,
): string {
  const payload = JSON.stringify({
    forecastStart: entry.forecastStart?.toISOString() ?? null,
    forecastEnd: entry.forecastEnd?.toISOString() ?? null,
    slipDays: entry.slipDays,
    critical: entry.critical,
    floatDays: entry.floatDays,
    calendar: calendarFingerprint ?? null,
  });
  return sha256(payload);
}

// ─── Escalation threshold ─────────────────────────────────────────────────────

/**
 * Returns true when a slip warrants an McpProposal escalation.
 *
 * Decision #7 (KAN-102):
 *   - Critical path: any positive slip (slipDays > 0).
 *   - Non-critical:  slip > 2 days.
 */
export function proposalExceedsThreshold(slip: {
  critical: boolean;
  slipDays: number;
}): boolean {
  return slip.critical ? slip.slipDays > 0 : slip.slipDays > 2;
}

// ─── Milestone rollup guard ───────────────────────────────────────────────────

/**
 * Returns true when a milestone's status was set manually and should be
 * left unchanged by the forecast rollup.
 *
 * The engine only writes `upcoming` ↔ `at_risk`. Once a milestone is `met`
 * or `missed` it reflects an intentional human decision that the engine
 * must never overwrite.
 */
export function milestoneIsManual(status: string): boolean {
  return status === "met" || status === "missed";
}
