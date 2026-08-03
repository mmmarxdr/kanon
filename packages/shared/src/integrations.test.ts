import { describe, expect, it } from "vitest";
import { integrationConnectionSchema } from "./integrations.js";

const credential = {
  connected: true,
  status: "valid",
  externalUserId: "remote-user",
  externalLogin: "alice",
  lastValidatedAt: "2026-08-02T18:00:00.000Z",
  revokedAt: null,
} as const;

describe("integrationConnectionSchema", () => {
  it("parses the workspace connection and member coverage contract", () => {
    const result = integrationConnectionSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      lifecycle: "active",
      lifecycleEpoch: 1,
      serviceFallbackEnabled: false,
      discoveredStatuses: [{ id: "1", name: "New", writable: true }],
      providerMaps: {
        readMap: { "1": "backlog" },
        writeMap: { backlog: "1" },
        timeActivityId: "9",
      },
      bindings: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          projectId: "44444444-4444-4444-8444-444444444444",
          remoteProjectId: "5",
          readMap: { "1": "backlog" },
          writeMap: { backlog: "1" },
          timeActivityId: "9",
          lifecycle: "active",
          lifecycleEpoch: 1,
        },
      ],
      callerCredential: credential,
      connectedMemberIds: ["55555555-5555-4555-8555-555555555555"],
      counts: { workspaceMembers: 1, validCredentials: 1, externalIdentities: 1 },
    });

    expect(result.connectedMemberIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
    expect(result.bindings[0]?.readMap).toEqual({ "1": "backlog" });
  });

  it("rejects unknown mapped issue states", () => {
    const result = integrationConnectionSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      lifecycle: "active",
      lifecycleEpoch: 1,
      serviceFallbackEnabled: false,
      discoveredStatuses: [],
      providerMaps: null,
      bindings: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          projectId: "44444444-4444-4444-8444-444444444444",
          remoteProjectId: "5",
          readMap: { "1": "shipped" },
          writeMap: {},
          timeActivityId: null,
          lifecycle: "draft",
          lifecycleEpoch: 0,
        },
      ],
      callerCredential: credential,
      connectedMemberIds: [],
      counts: { workspaceMembers: 0, validCredentials: 0, externalIdentities: 0 },
    });

    expect(result.success).toBe(false);
  });
});
