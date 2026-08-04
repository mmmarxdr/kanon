import { z } from "zod";
import { issueStateSchema } from "./issue.js";

export const integrationLifecycleSchema = z.enum([
  "draft",
  "active",
  "pausing",
  "paused",
  "disabled",
]);

export const integrationCredentialStatusSchema = z.enum([
  "missing",
  "unknown",
  "valid",
  "invalid",
  "revoked",
]);

export const integrationCredentialSchema = z.object({
  connected: z.boolean(),
  status: integrationCredentialStatusSchema,
  externalUserId: z.string().nullable(),
  externalLogin: z.string().nullable(),
  lastValidatedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const integrationDiscoverySchema = z.object({
  statuses: z.array(
    z.object({ id: z.string(), name: z.string(), writable: z.boolean() }),
  ),
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
  timeEntryActivities: z.array(
    z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() }),
  ),
});

export const integrationConnectionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  provider: z.string(),
  baseUrl: z.string(),
  lifecycle: integrationLifecycleSchema,
  lifecycleEpoch: z.number().int(),
  serviceFallbackEnabled: z.boolean(),
  serviceCredentialStatus: integrationCredentialStatusSchema,
  syncHealth: z.object({
    status: z.enum(["healthy", "credential_blocked"]),
    blockedWork: z
      .object({
        total: z.number().int().nonnegative(),
        items: z
          .array(
            z.object({
              id: z.string().uuid(),
              entityType: z.string().min(1),
              entityId: z.string().uuid(),
              operation: z.enum(["create", "update", "delete", "close"]),
              state: z.enum(["dead", "ambiguous"]),
              updatedAt: z.string(),
            }),
          )
          .max(20),
      })
      .nullable(),
  }),
  discoveredStatuses: integrationDiscoverySchema.shape.statuses.nullable(),
  providerMaps: z
    .object({
      readMap: z.record(z.string(), issueStateSchema).nullable(),
      writeMap: z.record(z.string(), z.string()).nullable(),
      timeActivityId: z.string().nullable(),
    })
    .nullable(),
  bindings: z.array(
    z.object({
      id: z.string().uuid(),
      projectId: z.string().uuid(),
      remoteProjectId: z.string(),
      readMap: z.record(z.string(), issueStateSchema),
      writeMap: z.record(z.string(), z.string()),
      timeActivityId: z.string().nullable(),
      lifecycle: integrationLifecycleSchema,
      lifecycleEpoch: z.number().int(),
    }),
  ),
  callerCredential: integrationCredentialSchema,
  connectedMemberIds: z.array(z.string().uuid()),
  counts: z.object({
    workspaceMembers: z.number().int().nonnegative(),
    validCredentials: z.number().int().nonnegative(),
    externalIdentities: z.number().int().nonnegative(),
  }),
});

export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
export type IntegrationDiscovery = z.infer<typeof integrationDiscoverySchema>;
