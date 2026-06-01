import { z } from "zod";
import type { MemberRole } from "@prisma/client";

/**
 * Allowed project member roles.
 * Mirrors workspace MemberRole values.
 */
export const PROJECT_MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const satisfies readonly MemberRole[];

/**
 * Body for POST /api/projects/:key/members — add a workspace member to a project.
 */
export const AddProjectMemberBody = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["owner", "admin", "member", "viewer"]),
});
export type AddProjectMemberBody = z.infer<typeof AddProjectMemberBody>;

/**
 * Body for PATCH /api/projects/:key/members/:pmId — change a project member's role.
 */
export const ChangeProjectMemberRoleBody = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});
export type ChangeProjectMemberRoleBody = z.infer<typeof ChangeProjectMemberRoleBody>;

/**
 * URL params for routes that address a specific PM row.
 */
export const ProjectMemberParams = z.object({
  key: z.string(),
  pmId: z.string().uuid("Invalid project member ID"),
});
export type ProjectMemberParams = z.infer<typeof ProjectMemberParams>;

/**
 * URL params for project-key-only routes (GET, POST).
 */
export const ProjectKeyParam = z.object({
  key: z.string(),
});
export type ProjectKeyParam = z.infer<typeof ProjectKeyParam>;
