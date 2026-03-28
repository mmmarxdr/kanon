import type { MemberRole } from "@prisma/client";
import type { preHandlerHookHandler } from "fastify";
import { AppError } from "../shared/types.js";

/**
 * Factory that returns a Fastify preHandler checking the authenticated user's role.
 * Returns 403 if the user's role is not in the allowed list.
 *
 * Usage:
 *   { preHandler: [requireRole('owner', 'admin')] }
 */
export function requireRole(...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    if (!roles.includes(user.role)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `This action requires one of the following roles: ${roles.join(", ")}`,
      );
    }
  };
}
