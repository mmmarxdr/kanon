import { z } from "zod";

/**
 * Create workspace request body.
 */
export const CreateWorkspaceBody = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(50, "Slug must be at most 50 characters")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens",
    ),
});
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

/**
 * Update workspace request body.
 */
export const UpdateWorkspaceBody = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters")
    .optional(),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(50, "Slug must be at most 50 characters")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must be lowercase alphanumeric with hyphens",
    )
    .optional(),
});
export type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBody>;

/**
 * Workspace ID param.
 */
export const WorkspaceIdParam = z.object({
  id: z.string().uuid("Invalid workspace ID"),
});
