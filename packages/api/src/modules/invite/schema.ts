import { z } from "zod";

const InviteRoleEnum = z.enum(["member", "admin", "viewer"]);

/**
 * Create invite request body — used by POST /api/workspaces/:wid/invites.
 */
export const CreateInviteBody = z.object({
  role: InviteRoleEnum.optional().default("member"),
  maxUses: z.number().int().min(0).optional().default(0),
  expiresInHours: z.number().int().min(1).max(720).optional().default(168),
  label: z.string().max(200).optional(),
});
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

/**
 * Invite response — returned by invite CRUD endpoints.
 */
export const InviteResponse = z.object({
  id: z.string().uuid(),
  token: z.string(),
  role: z.string(),
  maxUses: z.number(),
  useCount: z.number(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  label: z.string().nullable(),
  inviteUrl: z.string(),
  createdBy: z.object({
    email: z.string(),
    displayName: z.string().nullable(),
  }),
  createdAt: z.string(),
});

/**
 * Invite list response — returned by GET /api/workspaces/:wid/invites.
 */
export const InviteListResponse = z.object({
  invites: z.array(InviteResponse),
});

/**
 * Accept invite request body — empty, auth comes from JWT cookie.
 */
export const AcceptInviteBody = z.object({});

/**
 * Invite metadata response — returned by GET /api/invites/:token (public).
 */
export const InviteMetadataResponse = z.object({
  workspaceName: z.string(),
  workspaceSlug: z.string(),
  role: z.string(),
  expiresAt: z.string(),
  isExpired: z.boolean(),
  isExhausted: z.boolean(),
  isRevoked: z.boolean(),
  isValid: z.boolean(),
});

/**
 * Invite token param — used by public invite routes.
 */
export const InviteTokenParam = z.object({
  token: z.string().min(1, "Token is required"),
});
export type InviteTokenParam = z.infer<typeof InviteTokenParam>;

/**
 * Workspace invite params — used by workspace-scoped invite routes.
 */
export const WorkspaceInviteParams = z.object({
  wid: z.string().uuid("Invalid workspace ID"),
  inviteId: z.string().uuid("Invalid invite ID"),
});
export type WorkspaceInviteParams = z.infer<typeof WorkspaceInviteParams>;

/**
 * Workspace ID param — reused from member schema pattern.
 */
export const WorkspaceIdParam = z.object({
  wid: z.string().uuid("Invalid workspace ID"),
});
export type WorkspaceIdParam = z.infer<typeof WorkspaceIdParam>;
