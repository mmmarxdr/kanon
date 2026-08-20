import { createHash } from "node:crypto";
import { AppError, type AuthUser, type MemberContext } from "../../../shared/types.js";
import { resolveHeldIssueRecoveryContext, type HeldIssueRecoveryResult } from "./recovery-context.js";

declare const FreshRecoveryProofBrand: unique symbol;
type FreshRecoveryProof = { readonly digest: string; readonly observedAt: Date; readonly [FreshRecoveryProofBrand]: true };

const idempotencyKeyPattern = /^[\x21-\x7e]{16,128}$/;

export function validateRecoveryIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !idempotencyKeyPattern.test(value)) throw new AppError(400, "INVALID_REQUEST", "invalid_idempotency_key");
  return value;
}

export function canonicalRecoveryDigest(input: {
  readonly providerId: string;
  readonly version: string;
  readonly title: string;
  readonly description: string | null;
  readonly scopeFingerprint: string;
  readonly credentialFingerprint: string;
  readonly observedAt: Date;
}): string {
  const canonical = [input.providerId, input.version, input.title, input.description ?? "", input.scopeFingerprint, input.credentialFingerprint, input.observedAt.toISOString()].join("\0");
  return createHash("sha256").update(canonical).digest("hex");
}

function createFreshRecoveryProof(input: Parameters<typeof canonicalRecoveryDigest>[0], now: Date): FreshRecoveryProof {
  validateFreshRecoverySnapshot(input.observedAt, now);
  return { digest: canonicalRecoveryDigest(input), observedAt: input.observedAt, [FreshRecoveryProofBrand]: true };
}

/** The route never accepts a snapshot; this validates the trusted provider time at capability mint. */
export function validateFreshRecoverySnapshot(observedAt: Date, now = new Date()): Date {
  if (!Number.isFinite(observedAt.getTime()) || now.getTime() - observedAt.getTime() > 30_000 || observedAt > now) {
    throw new AppError(409, "RECOVERY_HELD", "snapshot_unavailable");
  }
  return observedAt;
}

export { createFreshRecoveryProof };

export async function recoverHeldIssue(input: {
  readonly principal: AuthUser;
  readonly member: MemberContext;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
  readonly issueKey: string;
  readonly idempotencyKey: unknown;
}): Promise<HeldIssueRecoveryResult> {
  const key = validateRecoveryIdempotencyKey(input.idempotencyKey);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const context = await resolveHeldIssueRecoveryContext({
    principal: input.principal,
    member: input.member,
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    bindingId: input.bindingId,
    issueKey: input.issueKey,
    keyHash,
  });
  return context.recover();
}
