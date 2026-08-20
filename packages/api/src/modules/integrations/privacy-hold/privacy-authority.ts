import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { env } from "../../../config/env.js";
import { decryptPrivacyQuarantine, encryptPrivacyQuarantine } from "../core/crypto.js";
import { verifyTerminalAbsenceProof, type AuditCensusLease } from "../audit.js";
import type { RedmineAuditSource } from "../providers/redmine/audit-source.js";
import type { HeldTerminalTrustRepository } from "../audit.js";

type ContainmentInput = { readonly evidenceId: string; readonly issueId: string; readonly bindingId: string };
type RecoveryInput = {
  readonly issueId: string; readonly bindingId: string; readonly memberId: string;
  readonly workspaceId: string; readonly connectionId: string; readonly keyHash: string;
  readonly credentialId: string; readonly credentialFingerprint: string;
  readonly lifecycleEpoch: number; readonly bindingLifecycleEpoch: number;
  readonly remoteIssueId: string; readonly scopeFingerprint: string;
};
type RecoverySnapshot = { readonly title: string; readonly description: string | null; readonly digest: string; readonly observedAt: Date };
type Snapshot = { readonly generation: number; readonly title: string; readonly description: string | null };
type RawTransaction = Pick<PrismaClient, "$queryRaw">;
type AuditCandidate = { readonly evidenceId: string; readonly issueId: string; readonly remoteIssueId: string };

// This client is intentionally closure-private: no runtime route can acquire a
// capability, read evidence, or query the quarantine schema through Prisma.
const operatorDatabase = new PrismaClient({ datasourceUrl: env.PRIVACY_OPERATOR_DATABASE_URL ?? env.DATABASE_URL });

function rejected(): Error { return new Error("privacy_hold_unavailable"); }
function held(reason: HeldReason, retryable: boolean): HeldRecovery { return { status: "held", reason, retryable }; }
type HeldReason = "snapshot_unavailable" | "scope_changed" | "provenance_ambiguous" | "merge_ambiguous" | "recovery_in_progress" | "idempotency_conflict";
type HeldRecovery = { readonly status: "held"; readonly reason: HeldReason; readonly retryable: boolean };
type ReleasedRecovery = { readonly status: "released"; readonly generation: number; readonly idempotent: boolean };

function failureResult(error: unknown): HeldRecovery {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("in progress")) return held("recovery_in_progress", true);
  if (message.includes("idempotency conflict")) return held("idempotency_conflict", false);
  if (message.includes("scope") || message.includes("context")) return held("scope_changed", false);
  if (message.includes("merge")) return held("merge_ambiguous", true);
  return held("snapshot_unavailable", true);
}
async function containEvidence(input: ContainmentInput): Promise<{ readonly status: "contained" }> {
  try {
    await operatorDatabase.$transaction(async (tx) => {
      const snapshot = await prepare(tx, input);
      const envelope = encryptPrivacyQuarantine(JSON.stringify(snapshot), { issueId: input.issueId, bindingId: input.bindingId, generation: snapshot.generation });
      await tx.$queryRaw(Prisma.sql`SELECT privacy_authority.contain_issue(${input.issueId}::uuid, ${input.bindingId}::uuid, ${snapshot.generation}, ${envelope})`);
    }, { isolationLevel: "Serializable" });
    return { status: "contained" };
  } catch { throw rejected(); }
}

async function loadCommittedAuditCandidates(lease: AuditCensusLease): Promise<readonly AuditCandidate[]> {
  // This query intentionally runs through the closure-private operator client;
  // runtime clients never obtain evidence IDs or authority-table SELECT access.
  return operatorDatabase.$queryRaw<AuditCandidate[]>(Prisma.sql`
    SELECT evidence.id::text AS "evidenceId", evidence.issue_id::text AS "issueId", ref.external_id AS "remoteIssueId"
    FROM privacy_authority.evidence AS evidence
    JOIN public.external_refs AS ref ON ref.entity_id = evidence.issue_id AND ref.binding_id = evidence.binding_id
    JOIN public.integration_audit_runs AS run ON run.binding_id = evidence.binding_id
    WHERE evidence.binding_id = ${lease.bindingId}::uuid
      AND evidence.used_at IS NULL AND evidence.terminal_verified = true AND evidence.expires_at > clock_timestamp()
      AND run.scope_fingerprint = ${lease.scopeFingerprint} AND run.state = 'complete' AND run.valid_until > clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public.integration_audit_observations observation WHERE observation.run_id = run.id AND observation.identity_type = 'issue' AND observation.remote_id = ref.external_id)
    ORDER BY evidence.id
  `);
}

async function prepare(tx: RawTransaction, input: ContainmentInput): Promise<Snapshot> {
  const rows = await tx.$queryRaw<Snapshot[]>(Prisma.sql`SELECT privacy_authority.prepare_containment(${input.evidenceId}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid) AS value`);
  const value = (rows[0] as { value?: Snapshot } | undefined)?.value;
  if (!value || !Number.isSafeInteger(value.generation)) throw rejected();
  return value;
}

/** Trusted typed boundary. Success and failure are deliberately content-free. */
export const privacyAuthority = {
  async containAuthenticatedPrivateTombstone(input: Omit<ContainmentInput, "evidenceId">): Promise<{ readonly status: "contained" }> {
    try {
      await operatorDatabase.$transaction(async (tx) => {
        const evidenceId = randomUUID();
        await tx.$queryRaw(Prisma.sql`SELECT privacy_authority.record_private_tombstone(${evidenceId}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid)`);
        const snapshot = await prepare(tx, { ...input, evidenceId });
        const envelope = encryptPrivacyQuarantine(JSON.stringify(snapshot), { issueId: input.issueId, bindingId: input.bindingId, generation: snapshot.generation });
        await tx.$queryRaw(Prisma.sql`SELECT privacy_authority.contain_issue(${input.issueId}::uuid, ${input.bindingId}::uuid, ${snapshot.generation}, ${envelope})`);
      }, { isolationLevel: "Serializable" });
      return { status: "contained" };
    } catch { throw rejected(); }
  },
  async contain(input: ContainmentInput): Promise<{ readonly status: "contained" }> {
    return containEvidence(input);
  },
  loadCommittedAuditCandidates,
  async replayRecovery(input: Pick<RecoveryInput, "memberId" | "bindingId" | "issueId" | "keyHash"> & { readonly generation: number }): Promise<ReleasedRecovery | null> {
    try {
      const rows = await operatorDatabase.$queryRaw<{ releasedGeneration: number }[]>(Prisma.sql`
        SELECT released_generation AS "releasedGeneration" FROM privacy_authority.recovery_receipts
        WHERE member_id=${input.memberId}::uuid AND binding_id=${input.bindingId}::uuid AND issue_id=${input.issueId}::uuid
          AND key_hash=${input.keyHash} AND released_generation=${input.generation} AND expires_at > clock_timestamp()
      `);
      return rows[0] ? { status: "released", generation: rows[0].releasedGeneration, idempotent: true } : null;
    } catch { return null; }
  },
  async recover(input: RecoveryInput, fresh: RecoverySnapshot): Promise<ReleasedRecovery | HeldRecovery> {
    try {
      return await operatorDatabase.$transaction(async (tx) => {
        const capabilityId = randomUUID();
        await tx.$queryRaw(Prisma.sql`SELECT privacy_authority.mint_recovery_capability(
          ${capabilityId}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid, ${input.memberId}::uuid,
          ${input.workspaceId}::uuid, ${input.connectionId}::uuid, ${input.keyHash}, ${input.credentialId}::uuid,
          ${input.credentialFingerprint}, ${input.lifecycleEpoch}::integer, ${input.bindingLifecycleEpoch}::integer, ${input.remoteIssueId},
          ${input.scopeFingerprint}, ${fresh.digest}, ${fresh.observedAt}::timestamptz)`);
        const rows = await tx.$queryRaw<{ value: { envelope?: string; generation?: number } }[]>(Prisma.sql`SELECT privacy_authority.load_recovery(${capabilityId}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid, ${input.memberId}::uuid, ${fresh.digest}) AS value`);
        const recoveredValue = rows[0]?.value;
        const envelope = recoveredValue?.envelope;
        if (!envelope || !Number.isSafeInteger(recoveredValue.generation)) throw rejected();
        // Decrypt while the capability, binding, and issue locks acquired by the
        // definer function remain held; no plaintext crosses this module boundary.
        const recovered = JSON.parse(decryptPrivacyQuarantine(envelope, { issueId: input.issueId, bindingId: input.bindingId, generation: recoveredValue.generation! })) as Partial<Snapshot>;
        const title = typeof recovered.title === "string" ? recovered.title : fresh.title;
        const description = typeof recovered.description === "string" || recovered.description === null ? recovered.description : fresh.description;
        const released = await tx.$queryRaw<{ value: { generation?: number } }[]>(Prisma.sql`SELECT privacy_authority.release_issue(${capabilityId}::uuid, ${input.issueId}::uuid, ${input.bindingId}::uuid, ${input.memberId}::uuid, ${input.keyHash}, ${title}, ${description}) AS value`);
        const generation = released[0]?.value?.generation;
        if (!Number.isSafeInteger(generation)) throw rejected();
        return { status: "released", generation: generation as number, idempotent: false } as const;
      }, { isolationLevel: "Serializable" });
    } catch (error) { return failureResult(error); }
  },
  async assertCatalog(): Promise<void> {
    try { await operatorDatabase.$queryRaw(Prisma.sql`SELECT privacy_authority.assert_catalog()`); }
    catch { throw rejected(); }
  },
};
