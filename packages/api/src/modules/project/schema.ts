import { z } from "zod";

/**
 * Create project request body.
 */
export const CreateProjectBody = z.object({
  key: z
    .string()
    .min(1, "Key is required")
    .max(6, "Key must be at most 6 characters")
    .regex(/^[A-Z][A-Z0-9]*$/, "Key must be uppercase alphanumeric starting with a letter"),
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  description: z.string().max(500).optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

/**
 * Update project request body.
 */
export const UpdateProjectBody = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  engramNamespace: z.string().max(100).nullable().optional(),
});
export type UpdateProjectBody = z.infer<typeof UpdateProjectBody>;

/**
 * Workspace ID param (for scoped routes).
 */
export const WorkspaceIdParam = z.object({
  wid: z.string().uuid("Invalid workspace ID"),
});

/**
 * Project key param.
 */
export const ProjectKeyParam = z.object({
  key: z.string(),
});
