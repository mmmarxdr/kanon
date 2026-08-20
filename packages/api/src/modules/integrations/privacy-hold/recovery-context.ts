import { createHash } from "node:crypto";
import { prisma } from "../../../config/prisma.js";
import { AppError, type AuthUser, type MemberContext } from "../../../shared/types.js";
import { decrypt as decryptCredential } from "../core/crypto.js";
import { RedmineAuditSource } from "../providers/redmine/audit-source.js";
import { RedmineHttpClient } from "../providers/redmine/http-client.js";
import { privacyAuthority } from "./privacy-authority.js";
import { canonicalRecoveryDigest, validateFreshRecoverySnapshot } from "./recovery-service.js";

export type HeldIssueRecoveryResult =
  | { readonly status: "released"; readonly generation: number; readonly idempotent: boolean }
  | { readonly status: "held"; readonly reason: "snapshot_unavailable" | "scope_changed" | "provenance_ambiguous" | "merge_ambiguous" | "recovery_in_progress" | "idempotency_conflict"; readonly retryable: boolean };

type RecoveryContext = { recover(): Promise<HeldIssueRecoveryResult> };

/**
 * Resolve every recovery identity server-side.  This closure is deliberately
 * the only value that crosses the route/service boundary: provider identifiers,
 * decrypted credentials, and future recovery proof material stay private here.
 */
export async function resolveHeldIssueRecoveryContext(input: {
  readonly principal: AuthUser;
  readonly member: MemberContext;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly issueKey: string;
  readonly keyHash: string;
}): Promise<RecoveryContext> {
  const member = await prisma.member.findFirst({
    where: { id: input.member.id, userId: input.principal.userId, workspaceId: input.workspaceId, role: "owner" },
    select: { id: true },
  });
  if (!member) throw new AppError(403, "FORBIDDEN", "Workspace owner access required");
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: input.connectionId, workspaceId: input.workspaceId, serviceCredentialId: { not: null } },
    select: { id: true, baseUrl: true, lifecycleEpoch: true, serviceCredentialId: true },
  });
  if (!connection) throw new AppError(404, "NOT_FOUND", "Not found");
  const binding = await prisma.integrationProjectBinding.findFirst({
    where: { id: input.bindingId, connectionId: connection.id, lifecycle: "active" },
    select: { id: true, projectId: true, remoteProjectId: true, lifecycleEpoch: true },
  });
  const issue = binding && await prisma.issue.findFirst({
    where: { key: input.issueKey, projectId: binding.projectId },
    select: { id: true, privacyHeldAt: true, privacyHoldGeneration: true },
  });
  const ref = issue && await prisma.externalRef.findFirst({
    where: { connectionId: connection.id, bindingId: binding!.id, entityType: "issue", entityId: issue.id },
    select: { id: true, externalId: true },
  });
  const credential = connection.serviceCredentialId && await prisma.memberIntegrationCredential.findFirst({
    where: { id: connection.serviceCredentialId, connectionId: connection.id, lastAuthStatus: "valid", revokedAt: null },
    select: { id: true, encryptedKey: true },
  });
  // Context/ref mismatches are indistinguishable from never-held resources.
  if (!binding || !issue || !ref || !credential) throw new AppError(404, "NOT_FOUND", "Not found");
  const credentialFingerprint = createHash("sha256").update(credential.encryptedKey).digest("hex");
  return {
    async recover(): Promise<HeldIssueRecoveryResult> {
      if (!issue.privacyHeldAt) {
        const replay = await privacyAuthority.replayRecovery({ memberId: member.id, bindingId: binding.id, issueId: issue.id, keyHash: input.keyHash, generation: issue.privacyHoldGeneration });
        if (replay) return replay;
        throw new AppError(404, "NOT_FOUND", "Not found");
      }
      try {
        // The only recovery proof originates from this authenticated direct detail fetch.
        const source = new RedmineAuditSource(
          new RedmineHttpClient(connection.baseUrl, decryptCredential(credential.encryptedKey)),
          { remoteProjectId: binding.remoteProjectId },
        );
        const detail = await source.readIssueDetail(ref.externalId);
        if (detail.kind !== "accepted" || detail.value.issue.operation !== "upsert") {
          return { status: "held", reason: "snapshot_unavailable", retryable: true };
        }
        const fields = detail.value.issue.fields;
        if (!("title" in fields) || !("description" in fields)) return { status: "held", reason: "snapshot_unavailable", retryable: true };
        const observedAt = validateFreshRecoverySnapshot(detail.providerObservedAt);
        const digest = canonicalRecoveryDigest({
          providerId: ref.externalId,
          version: detail.value.issue.sourceVersion,
          title: fields.title,
          description: fields.description,
          scopeFingerprint: binding.remoteProjectId,
          credentialFingerprint,
          observedAt,
        });
        return await privacyAuthority.recover({
          issueId: issue.id, bindingId: binding.id, memberId: member.id, workspaceId: input.workspaceId,
          connectionId: connection.id, keyHash: input.keyHash, credentialId: credential.id,
          credentialFingerprint, lifecycleEpoch: connection.lifecycleEpoch, bindingLifecycleEpoch: binding.lifecycleEpoch,
          remoteIssueId: ref.externalId, scopeFingerprint: binding.remoteProjectId,
        }, { title: fields.title, description: fields.description, digest, observedAt });
      } catch {
        // Timeouts, 404s, malformed data, races, and decryption failures remain held.
        return { status: "held", reason: "snapshot_unavailable", retryable: true };
      }
    },
  };
}
