import { z } from "zod";

export const AdminUserListQuery = z.object({
  q: z.string().trim().max(320).optional(),
  verified: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuery>;

export const AdminUserIdParam = z.object({
  userId: z.string().uuid(),
});

export const AdminWorkspaceIdParam = z.object({
  workspaceId: z.string().uuid(),
});

export const AdminMembershipParam = z.object({
  userId: z.string().uuid(),
  memberId: z.string().uuid(),
});

const MemberRoleEnum = z.enum(["viewer", "member", "pm", "admin", "owner"]);
const ProjectAccessEnum = z.enum(["workspace", "assigned"]);

export const AddMembershipBody = z.object({
  workspaceId: z.string().uuid(),
  role: MemberRoleEnum.optional().default("member"),
  projectAccess: ProjectAccessEnum.optional().default("assigned"),
  /** Optional initial ProjectMember rows when projectAccess is assigned. */
  projects: z
    .array(
      z.object({
        projectId: z.string().uuid(),
        role: MemberRoleEnum.optional().default("member"),
      }),
    )
    .max(200)
    .optional(),
});
export type AddMembershipBody = z.infer<typeof AddMembershipBody>;

export const MoveMembershipBody = z.object({
  workspaceId: z.string().uuid(),
  role: MemberRoleEnum.optional(),
  projectAccess: ProjectAccessEnum.optional(),
});
export type MoveMembershipBody = z.infer<typeof MoveMembershipBody>;

export const PatchMembershipBody = z
  .object({
    role: MemberRoleEnum.optional(),
    projectAccess: ProjectAccessEnum.optional(),
  })
  .refine((b) => b.role !== undefined || b.projectAccess !== undefined, {
    message: "At least one of role or projectAccess is required",
  });
export type PatchMembershipBody = z.infer<typeof PatchMembershipBody>;

export const ReplaceProjectsBody = z.object({
  projects: z
    .array(
      z.object({
        projectId: z.string().uuid(),
        role: MemberRoleEnum.optional().default("member"),
      }),
    )
    .max(200),
});
export type ReplaceProjectsBody = z.infer<typeof ReplaceProjectsBody>;

export const BulkBody = z
  .object({
    action: z.enum(["verify_email", "remove_from_workspace"]),
    userIds: z.array(z.string().uuid()).min(1).max(100),
    workspaceId: z.string().uuid().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.action === "remove_from_workspace" && !b.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "workspaceId is required for remove_from_workspace",
        path: ["workspaceId"],
      });
    }
  });
export type BulkBody = z.infer<typeof BulkBody>;
