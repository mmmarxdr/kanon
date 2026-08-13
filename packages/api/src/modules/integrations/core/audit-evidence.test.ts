import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUDIT_RUN_STATES,
  buildAuditPersistencePlan,
  createAuditScopeFingerprint,
  shouldRetainAuditObservation,
  TERMINAL_AUDIT_EVIDENCE_STATES,
} from "./audit-evidence.js";

const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../prisma/migrations/20260813160000_add_integration_audit_evidence/migration.sql",
);

const scope = {
  bindingId: "binding-1",
  connectionId: "connection-1",
  normalizedBaseUrl: "https://redmine.example",
  remoteProjectId: "42",
  credentialId: "credential-1",
  credentialFingerprint: "credential-hash",
};

describe("audit evidence contracts", () => {
  it("creates deterministic scope fingerprints and explicit non-absence terminal states", () => {
    expect(createAuditScopeFingerprint(scope)).toBe(createAuditScopeFingerprint({ ...scope }));
    expect(createAuditScopeFingerprint({ ...scope, remoteProjectId: "43" })).not.toBe(
      createAuditScopeFingerprint(scope),
    );
    expect(AUDIT_RUN_STATES).toEqual(["complete", "partial", "failed", "stale"]);
    expect(TERMINAL_AUDIT_EVIDENCE_STATES).toEqual(["visible", "not_visible_in_scope", "unknown"]);
  });

  it("builds one checkpoint-and-observation replay plan without duplicate semantic observations", () => {
    const plan = buildAuditPersistencePlan({
      runId: "run-1", scopeFingerprint: createAuditScopeFingerprint(scope), fence: 3,
      checkpoint: { pass: 2, offset: 100, itemIndex: 4, expectedTotal: 150, lastIssueUpdatedAt: new Date("2026-08-13T10:00:00Z"), lastIssueId: "7" },
      observations: [
        { identityType: "issue", remoteId: "7", parentRemoteId: null, sourceUpdatedAt: new Date("2026-08-13T10:00:00Z") },
        { identityType: "issue", remoteId: "7", parentRemoteId: null, sourceUpdatedAt: new Date("2026-08-13T10:00:00Z") },
        { identityType: "comment", remoteId: "9", parentRemoteId: "7", sourceUpdatedAt: new Date("2026-08-13T10:00:00Z") },
      ],
    });
    expect(plan).toMatchObject({ runId: "run-1", fence: 3, checkpoint: { offset: 100, lastIssueId: "7" } });
    expect(plan.observations).toEqual([
      expect.objectContaining({ identityType: "issue", remoteId: "7" }),
      expect.objectContaining({ identityType: "comment", remoteId: "9", parentRemoteId: "7" }),
    ]);
  });

  it("retains only genuinely active or latest trustworthy obsolete observations", async () => {
    const now = new Date("2026-08-13");
    const obsolete = new Date("2020-01-01");

    expect(shouldRetainAuditObservation({ runState: "partial", completedAt: null, isLatestTrustworthy: false, observedAt: obsolete }, now, 30)).toBe(true);
    expect(shouldRetainAuditObservation({ runState: "complete", completedAt: new Date("2020-01-02"), isLatestTrustworthy: true, observedAt: obsolete }, now, 30)).toBe(true);
    expect(shouldRetainAuditObservation({ runState: "complete", completedAt: new Date("2020-01-02"), isLatestTrustworthy: false, observedAt: obsolete }, now, 30)).toBe(false);
    expect(shouldRetainAuditObservation({ runState: "partial", completedAt: new Date("2020-01-02"), isLatestTrustworthy: false, observedAt: obsolete }, now, 30)).toBe(false);
    expect(shouldRetainAuditObservation({ runState: "failed", completedAt: new Date("2020-01-02"), isLatestTrustworthy: false, observedAt: obsolete }, now, 30)).toBe(false);
    expect(shouldRetainAuditObservation({ runState: "stale", completedAt: new Date("2020-01-02"), isLatestTrustworthy: false, observedAt: obsolete }, now, 30)).toBe(false);

    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|RENAME)\b/i);
    expect(sql).toContain('"scope_fingerprint"');
    expect(sql).toContain('"integration_audit_observations_run_id_identity_type_parent_remote_id_remote_id_source_updated_at_key"');
    expect(sql).toContain('"integration_audit_runs_binding_id_state_completed_at_idx"');
  });
});
