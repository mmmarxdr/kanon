import { z } from "zod";
import { issueStateSchema } from "./issue.js";

export const integrationLifecycleSchema = z.enum([
  "draft",
  "active",
  "pausing",
  "paused",
  "disabled",
]);

export const integrationCredentialSchema = z.object({
  connected: z.boolean(),
  status: z.enum(["missing", "unknown", "valid", "invalid", "revoked"]),
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
  discoveredStatuses: integrationDiscoverySchema.shape.statuses.nullable(),
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
  memberCoverage: z.array(
    z.object({
      id: z.string().uuid(),
      username: z.string(),
      role: z.string(),
      user: z.object({ email: z.string().email(), displayName: z.string().nullable() }),
      credential: integrationCredentialSchema,
    }),
  ),
  counts: z.object({
    workspaceMembers: z.number().int().nonnegative(),
    validCredentials: z.number().int().nonnegative(),
    externalIdentities: z.number().int().nonnegative(),
  }),
});

export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
export type IntegrationDiscovery = z.infer<typeof integrationDiscoverySchema>;
