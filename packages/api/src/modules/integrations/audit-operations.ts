import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { createPrismaAuditCensusRepository, type DurableAuditCensusLease } from "./audit-repository.js";
import { runRedmineAuditCensus } from "./audit.js";
import { createAuditScopeFingerprint } from "./core/audit-evidence.js";
import { decrypt as decryptCredential } from "./core/crypto.js";
import {
  claimBindingPollLease,
  releaseBindingPollLease,
  renewBindingPollLease,
  type ClaimedBinding,
} from "./inbound.js";
import { RedmineAuditSource } from "./providers/redmine/audit-source.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";

export interface AuditOperationsOptions {
  readonly maxBindings: number;
  readonly leaseMs: number;
  readonly timeoutMs: number;
  readonly pageSize: number;
  readonly maxPasses: number;
  readonly terminalFreshnessMs: number;
  readonly signal?: AbortSignal;
}

type AuditRepository = ReturnType<typeof createPrismaAuditCensusRepository>;

export interface AuditOperationsDependencies {
  readonly now?: () => Date;
  readonly decrypt?: (ciphertext: string) => string;
  readonly claim?: typeof claimBindingPollLease;
  readonly renew?: typeof renewBindingPollLease;
  readonly release?: typeof releaseBindingPollLease;
  readonly createSource?: (lease: ClaimedBinding, apiKey: string) => RedmineAuditSource;
  readonly createRepository?: (database: PrismaClient, terminalFreshnessMs: number) => AuditRepository;
  readonly runCensus?: typeof runRedmineAuditCensus;
}

export function createRedmineAuditSourceForLease(
  lease: ClaimedBinding,
  apiKey: string,
  endpointAllowlist = env.REDMINE_ENDPOINT_ALLOWLIST,
): RedmineAuditSource {
  return new RedmineAuditSource(
    new RedmineHttpClient(lease.baseUrl, apiKey, { endpointAllowlist }),
    { remoteProjectId: lease.remoteProjectId },
  );
}

function durableLease(binding: ClaimedBinding): DurableAuditCensusLease {
  const scopeFingerprint = createAuditScopeFingerprint({
    bindingId: binding.id,
    connectionId: binding.connectionId,
    normalizedBaseUrl: new URL(binding.baseUrl).toString(),
    remoteProjectId: binding.remoteProjectId,
    credentialId: binding.credentialId,
    credentialFingerprint: createHash("sha256").update(binding.encryptedKey).digest("hex"),
  });
  return {
    ...binding,
    bindingId: binding.id,
    leaseToken: binding.pollLeaseToken,
    fence: binding.pollFence,
    scopeFingerprint,
  };
}

function validateOptions(options: AuditOperationsOptions) {
  for (const [name, value] of Object.entries({
    maxBindings: options.maxBindings,
    leaseMs: options.leaseMs,
    timeoutMs: options.timeoutMs,
    pageSize: options.pageSize,
    terminalFreshnessMs: options.terminalFreshnessMs,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`);
  }
  if (!Number.isSafeInteger(options.maxPasses) || options.maxPasses < 2) {
    throw new RangeError("maxPasses must be at least two");
  }
}

/** Runs one bounded, sequential claim batch. Scheduling and gate enablement belong to PR5B-3. */
export async function runAuditOperationsCycle(
  database: PrismaClient,
  options: AuditOperationsOptions,
  dependencies: AuditOperationsDependencies = {},
): Promise<{ readonly claimed: number; readonly completed: number }> {
  validateOptions(options);
  const now = dependencies.now ?? (() => new Date());
  const claim = dependencies.claim ?? claimBindingPollLease;
  const renew = dependencies.renew ?? renewBindingPollLease;
  const release = dependencies.release ?? releaseBindingPollLease;
  const decrypt = dependencies.decrypt ?? decryptCredential;
  const createSource = dependencies.createSource ?? createRedmineAuditSourceForLease;
  const createRepository = dependencies.createRepository ?? ((db, freshness) =>
    createPrismaAuditCensusRepository(db, { terminalFreshnessMs: freshness }));
  const runCensus = dependencies.runCensus ?? runRedmineAuditCensus;
  const attempted: string[] = [];
  let completed = 0;

  for (let remaining = options.maxBindings; remaining > 0 && !options.signal?.aborted; remaining -= 1) {
    const binding = await claim(database, now(), options.leaseMs, attempted);
    if (!binding) break;
    attempted.push(binding.id);
    const lease = durableLease(binding);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) controller.abort();
    let fenceLost = false;
    let renewing: Promise<void> | undefined;
    const deadline = setTimeout(cancel, options.timeoutMs);
    const renewTimer = setInterval(() => {
      if (renewing) return;
      renewing = renew(database, binding, new Date(now().getTime() + options.leaseMs))
        .then((current) => {
          if (!current) {
            fenceLost = true;
            controller.abort();
          }
        })
        .catch(() => {
          fenceLost = true;
          controller.abort();
        })
        .finally(() => { renewing = undefined; });
    }, Math.max(1, Math.floor(options.leaseMs / 2)));

    const repository = createRepository(database, options.terminalFreshnessMs);
    try {
      const result = await runCensus(
        createSource(binding, decrypt(binding.encryptedKey)),
        repository.persistence(lease),
        lease,
        { pageSize: options.pageSize, maxPasses: options.maxPasses, signal: controller.signal },
      );
      if (result.kind === "complete-current-visible" && !controller.signal.aborted) completed += 1;
      else await repository.markFailed(lease, fenceLost ? "scope_or_fence_changed" : result.kind === "unknown" ? result.reasonCode : "timeout");
    } catch {
      controller.abort();
      await repository.markFailed(lease, "provider_failure").catch(() => false);
    } finally {
      clearTimeout(deadline);
      clearInterval(renewTimer);
      options.signal?.removeEventListener("abort", cancel);
      await renewing?.catch(() => undefined);
      await release(database, binding).catch(() => false);
    }
  }
  return { claimed: attempted.length, completed };
}
