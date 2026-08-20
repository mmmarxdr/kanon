import { describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  member: vi.fn(), connection: vi.fn(), binding: vi.fn(), issue: vi.fn(), ref: vi.fn(), credential: vi.fn(),
  decrypt: vi.fn(), fetch: vi.fn(), authorityRecover: vi.fn(), replay: vi.fn(),
  client: vi.fn(function () { return { getWithResponse: doubles.fetch }; }),
}));

vi.mock("../../../config/prisma.js", () => ({ prisma: {
  member: { findFirst: doubles.member }, integrationConnection: { findFirst: doubles.connection },
  integrationProjectBinding: { findFirst: doubles.binding }, issue: { findFirst: doubles.issue },
  externalRef: { findFirst: doubles.ref }, memberIntegrationCredential: { findFirst: doubles.credential },
} }));
vi.mock("../core/crypto.js", () => ({ decrypt: doubles.decrypt }));
vi.mock("../providers/redmine/http-client.js", () => ({ RedmineHttpClient: doubles.client }));
vi.mock("./privacy-authority.js", () => ({ privacyAuthority: { recover: doubles.authorityRecover, replayRecovery: doubles.replay } }));

import { resolveHeldIssueRecoveryContext } from "./recovery-context.js";

const request = { principal: { userId: "user" }, member: { id: "member" }, workspaceId: "workspace", connectionId: "connection", bindingId: "binding", issueKey: "RCV-1", keyHash: "a".repeat(64) } as never;
const held = { id: "issue", privacyHeldAt: new Date(), privacyHoldGeneration: 1 };

function arrange() {
  for (const [name, value] of Object.entries(doubles)) if ("mockReset" in value) name === "client" ? value.mockClear() : value.mockReset();
  doubles.member.mockResolvedValue({ id: "member" });
  doubles.connection.mockResolvedValue({ id: "connection", baseUrl: "https://redmine.test", lifecycleEpoch: 1, serviceCredentialId: "credential" });
  doubles.binding.mockResolvedValue({ id: "binding", projectId: "project", remoteProjectId: "42", lifecycleEpoch: 1 });
  doubles.issue.mockResolvedValue(held);
  doubles.ref.mockResolvedValue({ id: "ref", externalId: "42" });
  doubles.credential.mockResolvedValue({ id: "credential", encryptedKey: "cipher" });
  doubles.decrypt.mockReturnValue("secret");
  doubles.fetch.mockResolvedValue({ value: { issue: { id: 42, project: { id: 42, name: "Recovery" }, tracker: { id: 1, name: "Task" }, status: { id: 1, name: "Open" }, priority: { id: 1, name: "Normal" }, author: { id: 1, name: "Owner" }, subject: "Remote", description: "Body", start_date: null, due_date: null, done_ratio: 0, is_private: false, created_on: "2026-08-20T00:00:00Z", updated_on: "2026-08-20T00:00:00Z", closed_on: null, journals: [] } }, httpDate: new Date().toUTCString() });
}

describe("held issue recovery context", () => {
  it("fetches an authenticated provider detail only for the first release, never its exact receipt replay", async () => {
    arrange();
    doubles.issue.mockResolvedValueOnce(held).mockResolvedValueOnce({ ...held, privacyHeldAt: null, privacyHoldGeneration: 2 });
    doubles.authorityRecover.mockResolvedValue({ status: "released", generation: 2, idempotent: false });
    doubles.replay.mockResolvedValue({ status: "released", generation: 2, idempotent: true });

    await expect((await resolveHeldIssueRecoveryContext(request)).recover()).resolves.toEqual({ status: "released", generation: 2, idempotent: false });
    await expect((await resolveHeldIssueRecoveryContext(request)).recover()).resolves.toEqual({ status: "released", generation: 2, idempotent: true });
    expect(doubles.fetch).toHaveBeenCalledTimes(1);
    expect(doubles.authorityRecover).toHaveBeenCalledTimes(1);
  });

  it("makes connection, binding, issue, and ExternalRef mismatches the same provider-free 404", async () => {
    for (const missing of [doubles.connection, doubles.binding, doubles.issue, doubles.ref]) {
      arrange();
      missing.mockResolvedValue(null);
      await expect(resolveHeldIssueRecoveryContext(request)).rejects.toMatchObject({ statusCode: 404, message: "Not found" });
      expect(doubles.fetch).not.toHaveBeenCalled();
      expect(doubles.authorityRecover).not.toHaveBeenCalled();
      expect(doubles.replay).not.toHaveBeenCalled();
    }
  });
});
