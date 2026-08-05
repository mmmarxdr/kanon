/**
 * Reference profile `triage-proposal-list-v1` (KAN-193).
 *
 * Same runtime as preview profile; measures list (20/50) and dismiss paths,
 * deep keyset pages, auth/source conflicts. Full load requires TRIAGE_PERF=1.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CANARY_GATES,
  REFERENCE_RUNTIME,
  summarizeLatencies,
  type LatencySample,
  isFullPerfEnabled,
} from "./profile.js";
import { TRIAGE_SQL_BOUNDARIES } from "../observability.js";

export const PROFILE_ID = "triage-proposal-list-v1" as const;

export const LIST_PROFILE = {
  id: PROFILE_ID,
  runtime: REFERENCE_RUNTIME,
  corpus: {
    proposalsInProject: 25_000,
    targets: 5_000,
    defaultLimit: 20,
    maxLimit: 50,
  },
  paths: ["list_default_20", "list_max_50", "list_deep_pages", "dismiss", "source_conflict"],
  budgets: {
    listP95TargetMs: CANARY_GATES.listP95TargetMs,
    dismissP95TargetMs: CANARY_GATES.dismissP95TargetMs,
    listMaxBytes: CANARY_GATES.listMaxBytes,
    getMaxBytes: CANARY_GATES.getMaxBytes,
    dismissMaxBytes: CANARY_GATES.dismissMaxBytes,
    mcpListTimeoutMs: 2900,
    mcpDismissTimeoutMs: 2000,
  },
  sql: {
    fetchLimitMax: TRIAGE_SQL_BOUNDARIES.listFetchLimitMax,
    visibilityBeforePredicates: TRIAGE_SQL_BOUNDARIES.listVisibilityBeforePredicates,
    noContentTableFetch: TRIAGE_SQL_BOUNDARIES.listNoContentTableFetch,
  },
} as const;

/** Assert list source authorizes project before findMany and uses take: limit+1 without content join. */
export function assertListSqlPlanBoundaries(listSource: string): void {
  const projectAuth =
    listSource.indexOf("prisma.project.findFirst") !== -1 ||
    listSource.indexOf("project.findFirst") !== -1;
  const memberAuth = listSource.includes("projectMember") || listSource.includes("member.findUnique");
  const findMany = listSource.indexOf("triageProposal.findMany");
  if (!projectAuth || !memberAuth) {
    throw new Error("list must authorize project/membership before proposal query");
  }
  if (findMany === -1) {
    throw new Error("list must use triageProposal.findMany");
  }
  // Authorization block must appear before findMany in source order.
  const authMarker = listSource.indexOf("Project not found");
  if (authMarker === -1 || authMarker > findMany) {
    throw new Error("visibility/authorization must precede proposal predicates/findMany");
  }
  if (!listSource.includes("take: limit + 1") && !listSource.includes("take: limit+1")) {
    throw new Error("list must fetch limit+1 (LIMIT 51 at max)");
  }
  if (/include:\s*\{[^}]*content/i.test(listSource) || listSource.includes("triageProposalContent")) {
    throw new Error("list must not fetch content table");
  }
}

export function loadListSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "../proposal-list.ts"), "utf8");
}

export function runListProfileFixture(samples: {
  list: LatencySample[];
  dismiss: LatencySample[];
}) {
  const min = isFullPerfEnabled() ? REFERENCE_RUNTIME.measuredCallsMin : 20;
  if (samples.list.length < min || samples.dismiss.length < min) {
    throw new Error(`triage-proposal-list-v1 fixture requires ≥${min} samples per path`);
  }
  const listSummary = summarizeLatencies(samples.list);
  const dismissSummary = summarizeLatencies(samples.dismiss);
  return {
    profile: PROFILE_ID,
    listSummary,
    dismissSummary,
    gates: {
      listP95Ok: listSummary.p95Ms < LIST_PROFILE.budgets.listP95TargetMs,
      dismissP95Ok: dismissSummary.p95Ms < LIST_PROFILE.budgets.dismissP95TargetMs,
      listBytesOk: listSummary.maxOutputBytes <= LIST_PROFILE.budgets.listMaxBytes,
      dismissBytesOk: dismissSummary.maxOutputBytes <= LIST_PROFILE.budgets.dismissMaxBytes,
    },
  };
}

export function syntheticListSamples(count = 40): LatencySample[] {
  return Array.from({ length: count }, (_, i) => ({
    durationMs: 60 + (i % 13) * 10,
    outputBytes: 4_000 + (i % 7) * 200,
    outcome: "success" as const,
  }));
}

export function syntheticDismissSamples(count = 40): LatencySample[] {
  return Array.from({ length: count }, (_, i) => ({
    durationMs: 40 + (i % 11) * 8,
    outputBytes: 400 + (i % 5) * 20,
    outcome: "success" as const,
  }));
}
