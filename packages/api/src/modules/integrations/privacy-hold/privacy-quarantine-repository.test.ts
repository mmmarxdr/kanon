import { describe, expect, it, vi } from "vitest";
import { createPrivacyQuarantineRepository } from "./privacy-quarantine-repository.js";
const snapshot = { issueId: "issue-1", bindingId: "binding-1", generation: 2, payload: "encrypted" };
describe("privacy quarantine repository", () => {
  it("writes only through the isolated raw-SQL table", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const repository = createPrivacyQuarantineRepository({ $executeRaw: executeRaw } as never);
    await repository.store(snapshot);
    expect(executeRaw).toHaveBeenCalledOnce();
    expect((executeRaw.mock.calls[0]?.[0] as { strings: readonly string[] }).strings.join("")).toContain("privacy_quarantine");
  });
  it("treats duplicate snapshots as unavailable rather than exposing data", async () => {
    const executeRaw = vi.fn().mockRejectedValue({ code: "23505" });
    const repository = createPrivacyQuarantineRepository({ $executeRaw: executeRaw } as never);
    await expect(repository.store(snapshot)).rejects.toThrow("quarantine_unavailable");
  });
});
