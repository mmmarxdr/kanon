import { z } from "zod";

/**
 * URL param carrying a milestone UUID.
 */
export const MilestoneIdParam = z.object({
  id: z.string().uuid(),
});
export type MilestoneIdParam = z.infer<typeof MilestoneIdParam>;

/**
 * URL param carrying a project key (e.g. "KAN").
 */
export const ProjectKeyParam = z.object({
  key: z.string(),
});
export type ProjectKeyParam = z.infer<typeof ProjectKeyParam>;

/**
 * Combined param for deliverable delete: milestone id + issue id.
 */
export const MilestoneDeliverableParams = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
});
export type MilestoneDeliverableParams = z.infer<typeof MilestoneDeliverableParams>;

/**
 * Body for POST /api/projects/:key/milestones.
 * ownerId is optional — defaults to the acting member at the service layer.
 * target is a UTC ISO 8601 datetime string (stored as DateTime in DB).
 */
export const CreateMilestoneBody = z.object({
  name: z.string().min(1, "Milestone name is required"),
  /** ISO 8601 datetime string for the milestone target date. */
  target: z.string().datetime({ message: "target must be a valid ISO 8601 datetime" }),
  /** Optional owner; defaults to the creating actor's member id. */
  ownerId: z.string().uuid().optional(),
});
export type CreateMilestoneBody = z.infer<typeof CreateMilestoneBody>;

/**
 * Body for PATCH /api/milestones/:id.
 * All fields optional — partial update.
 * metOn is settable manually (v1 — no auto-stamp on status→met).
 */
export const UpdateMilestoneBody = z.object({
  name: z.string().min(1).optional(),
  target: z.string().datetime().optional(),
  status: z.enum(["upcoming", "at_risk", "met", "missed"]).optional(),
  /** Manual met date — set explicitly when the team confirms met. */
  metOn: z.string().datetime().optional().nullable(),
  ownerId: z.string().uuid().optional(),
});
export type UpdateMilestoneBody = z.infer<typeof UpdateMilestoneBody>;

/**
 * Body for POST /api/milestones/:id/deliverables.
 * issueKey is the issue's key string (e.g. "KAN-12").
 */
export const AttachDeliverableBody = z.object({
  issueKey: z.string().min(1, "issueKey is required"),
});
export type AttachDeliverableBody = z.infer<typeof AttachDeliverableBody>;
