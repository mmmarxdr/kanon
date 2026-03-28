import { z } from "zod";

/**
 * Profile response — returned by GET /api/members/me.
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
