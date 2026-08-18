/**
 * Reference profile `triage-preview-v1` (KAN-193).
 *
 * Contract: PG16/Node20, 4 vCPU/8 GiB, warm DB, concurrency 16, 100 warmups,
 * ≥1000 measured calls, prepare/validate/timeout paths, compact ≤16 KiB,
 * with budgets owned by this versioned profile.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  REFERENCE_RUNTIME,
  summarizeLatencies,
  type LatencySample,
} from "./profile.js";
import { TRIAGE_SQL_BOUNDARIES } from "../observability.js";

export const PROFILE_ID = "triage-preview-v1" as const;

export const PREVIEW_PROFILE = {
  id: PROFILE_ID,
  runtime: REFERENCE_RUNTIME,
  corpus: {
    workspaces: 1,
    projects: 20,
    issuesPerProject: 5000,
    authorizedProjects: 10,
    candidateMax: 10,
  },
  paths: ["prepare_deterministic", "validate_host_completed", "host_timeout", "candidate_timeout"],
  budgets: {
    p95MaxMs: 3000,
    compactMaxBytes: 16 * 1024,
    fullMaxBytes: 48 * 1024,
    mcpTimeoutMs: 2900,
    apiTimeoutMs: 2500,
  },
  sql: {
    fetchLimitMax: TRIAGE_SQL_BOUNDARIES.searchFetchLimitMax,
    visibilityBeforePredicates: TRIAGE_SQL_BOUNDARIES.searchVisibilityBeforePredicates,
    noMcpFullList: TRIAGE_SQL_BOUNDARIES.searchNoMcpFullList,
  },
} as const;

/** Assert search source encodes LIMIT (limit+1) and authorized_projects join before match. */
export function assertPreviewSqlPlanBoundaries(searchSource: string): void {
  expectContains(searchSource, "authorized_projects");
  expectContains(searchSource, "LIMIT ${limit + 1}");
  // Visibility CTE / join precedes WHERE title/key match predicates.
  const authIdx = searchSource.indexOf("authorized_projects");
  const whereIdx = searchSource.indexOf("WHERE ${tokenMatchPredicate}");
  if (authIdx === -1 || whereIdx === -1 || authIdx > whereIdx) {
    throw new Error("search plan must join authorized_projects before match predicates");
  }
  if (/listIssues\s*\(/.test(searchSource) || /list_issues/.test(searchSource)) {
    throw new Error("preview/search must not call MCP/full listIssues path");
  }
}

function expectContains(source: string, needle: string): void {
  if (!source.includes(needle)) {
    throw new Error(`Expected search source to contain: ${needle}`);
  }
}

export function loadSearchSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "../search.ts"), "utf8");
}

/**
 * Synthetic fixture run for CI — proves percentile/budget math without DB load.
 */
export function runPreviewProfileFixture(samples: LatencySample[]) {
  if (samples.length < 20) throw new Error("fixture requires ≥20 samples");
  const summary = summarizeLatencies(samples);
  return {
    profile: PROFILE_ID,
    summary,
    gates: {
      p95Ok: summary.p95Ms < PREVIEW_PROFILE.budgets.p95MaxMs,
      compactOk: summary.maxOutputBytes <= PREVIEW_PROFILE.budgets.compactMaxBytes,
    },
  };
}

/** Generate synthetic success samples under budget (unit/CI). */
export function syntheticPreviewSamples(count = 40): LatencySample[] {
  return Array.from({ length: count }, (_, i) => ({
    durationMs: 80 + (i % 17) * 12,
    outputBytes: 2_000 + (i % 9) * 100,
    outcome: "success" as const,
  }));
}
