import { z } from "zod";
import { COMMENT_SOURCES } from "../../shared/constants.js";

/**
 * Create comment request body.
 */
export const CreateCommentBody = z.object({
  body: z
    .string()
    .min(1, "Comment body is required")
    .max(10000, "Comment body must be at most 10000 characters"),
  source: z.enum(COMMENT_SOURCES).default("human"),
});
export type CreateCommentBody = z.infer<typeof CreateCommentBody>;

/**
 * Issue key param for comment routes.
 */
export const IssueKeyParam = z.object({
  key: z.string(),
});
