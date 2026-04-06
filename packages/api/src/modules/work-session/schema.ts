import { z } from "zod";

/**
 * Issue key param for work session routes.
 */
export const IssueKeyParam = z.object({
  key: z.string(),
});

/**
 * Start work session request body.
 */
export const StartWorkSessionBody = z.object({
  source: z.string().max(50).default("mcp"),
});
export type StartWorkSessionBody = z.infer<typeof StartWorkSessionBody>;

/**
 * Active worker response shape.
 */
export const ActiveWorkerResponse = z.object({
  userId: z.string().uuid(),
  memberId: z.string().uuid(),
  username: z.string(),
  startedAt: z.string().datetime(),
  source: z.string(),
});
export type ActiveWorkerResponse = z.infer<typeof ActiveWorkerResponse>;
