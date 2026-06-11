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
  // KAN-81: restrict to https:// + cap length. `z.string().url()` alone accepts
  // `javascript:`/`data:`/`http:` URLs (the URL constructor validates them),
  // which the web client could render in an <img>/link — phishing / XSS vector,
  // and SSRF if any server process ever fetches it. https-only + a 2048-char
  // cap closes that; a domain allowlist can be layered on later if needed.
  avatarUrl: z
    .string()
    .url("avatarUrl must be a valid URL")
    .max(2048, "avatarUrl must be at most 2048 characters")
    .refine(
      (u) => {
        // Zod runs this refine even when .url() already failed, so it must not
        // throw on a malformed string.
        try {
          return new URL(u).protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "avatarUrl must use https://" },
    )
    .nullable()
    .optional(),
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
