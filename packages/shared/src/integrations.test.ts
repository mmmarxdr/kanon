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

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  provider: "redmine",
  baseUrl: "https://redmine.example.test",
  lifecycle: "active",
  lifecycleEpoch: 1,
  serviceFallbackEnabled: false,
  serviceCredentialStatus: "invalid",
  serviceCredentialIsCaller: true,
  syncHealth: {
    status: "credential_blocked",
    blockedWork: {
      total: 1,
      items: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          entityType: "issue",
          entityId: "77777777-7777-4777-8777-777777777777",
          operation: "update",
          state: "dead",
          updatedAt: "2026-08-04T10:00:00.000Z",
        },
      ],
    },
  },
  discoveredStatuses: [{ id: "1", name: "New", writable: true }],
  providerMaps: {
    readMap: { "1": "backlog" },
    writeMap: { backlog: "1" },
    priorityReadMap: { "4": "high" },
    priorityWriteMap: { critical: "4", high: "4", medium: "3", low: "2" },
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
      releasePending: false,
    },
  ],
  callerCredential: credential,
  connectedMemberIds: ["55555555-5555-4555-8555-555555555555"],
  counts: { workspaceMembers: 1, validCredentials: 1, externalIdentities: 1 },
} as const;

describe("integrationConnectionSchema", () => {
  it("parses the workspace connection and member coverage contract", () => {
    const result = integrationConnectionSchema.parse(connection);

    expect(result.connectedMemberIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
    expect(result.bindings[0]?.readMap).toEqual({ "1": "backlog" });
    expect(result.providerMaps?.priorityReadMap).toEqual({ "4": "high" });
    expect(result.serviceCredentialStatus).toBe("invalid");
    expect(result.serviceCredentialIsCaller).toBe(true);
    expect(result.syncHealth).toMatchObject({
      status: "credential_blocked",
      blockedWork: { total: 1, items: [{ state: "dead" }] },
    });
  });

  it("rejects unknown mapped issue states", () => {
    const result = integrationConnectionSchema.safeParse({
      ...connection,
      bindings: [
        {
          ...connection.bindings[0],
          readMap: { "1": "shipped" },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects more than 20 auth-blocked work details", () => {
    const item = connection.syncHealth.blockedWork.items[0];
    const result = integrationConnectionSchema.safeParse({
      ...connection,
      syncHealth: {
        status: "credential_blocked",
        blockedWork: {
          total: 21,
          items: Array.from({ length: 21 }, (_, index) => ({
            ...item,
            id: `${String(index + 1).padStart(8, "0")}-6666-4666-8666-666666666666`,
          })),
        },
      },
    });

    expect(result.success).toBe(false);
  });
});
