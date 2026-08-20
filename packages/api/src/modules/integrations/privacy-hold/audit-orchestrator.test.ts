import { describe, expect, it, vi } from "vitest";
import { orchestrateCommittedAuditPrivacy } from "./audit-orchestrator.js";

const lease = { bindingId: "binding", leaseToken: "lease", fence: 2, scopeFingerprint: "scope" };

describe("orchestrateCommittedAuditPrivacy", () => {
  it("contains only candidates that an authenticated direct detail proves absent between terminal checks", async () => {
    const contain = vi.fn().mockResolvedValue({ status: "contained" });
    const result = await orchestrateCommittedAuditPrivacy({
      lease,
      source: { readIssue: vi.fn().mockResolvedValue({ kind: "not_visible_in_scope" }) },
      repository: {
        loadCommittedPrivacyCandidates: vi.fn().mockResolvedValue([{ issueId: "issue", remoteIssueId: "42", evidenceId: "evidence" }]),
        terminalPersistence: () => ({
          readTerminalTrust: vi.fn().mockResolvedValue({ trust: { state: "complete", completedAt: new Date(), validUntil: new Date(Date.now() + 60_000), scopeFingerprint: "scope" }, databaseNow: new Date() }),
        }),
      },
      contain,
    });

    expect(result).toEqual({ attempted: 1, contained: 1 });
    expect(contain).toHaveBeenCalledWith({ issueId: "issue", bindingId: "binding", evidenceId: "evidence" });
  });

  it.each([
    { kind: "visible", providerObservedAt: new Date(), issueId: "42" },
    { kind: "unknown", reasonCode: "timeout" },
  ])("does not mutate for non-terminal absence %#", async (read) => {
    const contain = vi.fn();
    await expect(orchestrateCommittedAuditPrivacy({
      lease,
      source: { readIssue: vi.fn().mockResolvedValue(read) },
      repository: {
        loadCommittedPrivacyCandidates: vi.fn().mockResolvedValue([{ issueId: "issue", remoteIssueId: "42", evidenceId: "evidence" }]),
        terminalPersistence: () => ({ readTerminalTrust: vi.fn().mockResolvedValue({ trust: null, databaseNow: new Date() }) }),
      },
      contain,
    })).resolves.toEqual({ attempted: 1, contained: 0 });
    expect(contain).not.toHaveBeenCalled();
  });
});
