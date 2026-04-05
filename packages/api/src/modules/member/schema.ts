import { z } from "zod";

/**
 * Profile response — returned by GET /api/members/me.
 * Combines User-level identity with workspace-scoped Member fields.
 */
export const ProfileResponse = z.object({
  id: z.string().uuid(),
  email: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string(),
  workspaceId: z.string().uuid(),
});

/**
 * Update profile request body — used by PATCH /api/members/me.
 */
export const UpdateProfileBody = z.object({
  displayName: z.string().max(100).nullable().optional(),
  avatarUrl: z.string().url("avatarUrl must be a valid URL").nullable().optional(),
});
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;

// ── Workspace Member Management Schemas ──────────────────────────────────────

const MemberRoleEnum = z.enum(["owner", "admin", "member", "viewer"]);

/**
 * Add member request body — used by POST /api/workspaces/:wid/members.
 */
export const AddMemberBody = z.object({
  email: z.string().email("Must be a valid email"),
  role: MemberRoleEnum,
});
export type AddMemberBody = z.infer<typeof AddMemberBody>;

/**
 * Change member role request body — used by PATCH /api/workspaces/:wid/members/:mid.
 */
export const ChangeMemberRoleBody = z.object({
  role: MemberRoleEnum,
});
export type ChangeMemberRoleBody = z.infer<typeof ChangeMemberRoleBody>;

/**
 * Workspace member params — used by member CRUD routes.
 */
export const WorkspaceMemberParams = z.object({
  wid: z.string().uuid("Invalid workspace ID"),
  mid: z.string().uuid("Invalid member ID"),
});
export type WorkspaceMemberParams = z.infer<typeof WorkspaceMemberParams>;

/**
 * Workspace ID param — used by workspace-scoped member routes.
 */
export const WorkspaceIdParam = z.object({
  wid: z.string().uuid("Invalid workspace ID"),
});
export type WorkspaceIdParam = z.infer<typeof WorkspaceIdParam>;
