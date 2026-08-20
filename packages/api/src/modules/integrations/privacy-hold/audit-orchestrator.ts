import type { AuditCensusLease, AuditTerminalPersistence, AuditTerminalSource } from "../audit.js";
import { verifyTerminalAbsenceProof } from "../audit.js";

export type CommittedPrivacyCandidate = {
  readonly issueId: string;
  readonly remoteIssueId: string;
  readonly evidenceId: string;
};

type CandidateRepository = {
  loadCommittedPrivacyCandidates?(lease: AuditCensusLease): Promise<readonly CommittedPrivacyCandidate[]>;
  terminalPersistence(lease: AuditCensusLease): AuditTerminalPersistence;
};

/**
 * Converts a completed census absence into containment only after a second,
 * authenticated direct read and two valid terminal-trust checks. A census
 * omission alone is never authority to mutate local data.
 */
export async function orchestrateCommittedAuditPrivacy(input: {
  readonly lease: AuditCensusLease;
  readonly source: AuditTerminalSource;
  readonly repository: CandidateRepository;
  readonly candidates?: () => Promise<readonly CommittedPrivacyCandidate[]>;
  readonly contain: (candidate: { readonly issueId: string; readonly bindingId: string; readonly evidenceId: string }) => Promise<unknown>;
}): Promise<{ readonly attempted: number; readonly contained: number }> {
  const candidates = input.candidates
    ? await input.candidates()
    : input.repository.loadCommittedPrivacyCandidates
      ? await input.repository.loadCommittedPrivacyCandidates(input.lease)
      : [];
  let contained = 0;
  const persistence = input.repository.terminalPersistence(input.lease);
  for (const candidate of candidates) {
    const proof = await verifyTerminalAbsenceProof(input.source, persistence, input.lease, {
      kind: "issue",
      issueId: candidate.remoteIssueId,
    });
    if (!proof) continue;
    await input.contain({ issueId: candidate.issueId, bindingId: input.lease.bindingId, evidenceId: candidate.evidenceId });
    contained += 1;
  }
  return { attempted: candidates.length, contained };
}
