import type { MemberRole } from "@prisma/client";
import type { BridgeSyncService } from "../services/bridge-sync-service.js";

/**
 * Structured application error with HTTP status code and machine-readable code.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Authenticated user context, attached to request by auth plugin.
 * Contains only user-level identity — no workspace or role info.
 * Workspace context comes from URL params for scoped endpoints.
 */
export interface AuthUser {
  userId: string;
  email: string;
}

/**
 * Workspace member context, set by requireRole/requireMember preHandlers.
 * Provides the member's identity and role within the resolved workspace.
 */
export interface MemberContext {
  id: string;          // Member.id (UUID)
  role: MemberRole;    // from @prisma/client
  workspaceId: string;
  userId: string;
}

/**
 * JWT token payload structure.
 * Contains only user identity — no workspace or role claims.
 */
export interface TokenPayload {
  sub: string; // userId
  email: string;
}

/**
 * Fastify request augmentation for authenticated routes.
 */
declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
    member?: MemberContext;
  }
  interface FastifyInstance {
    bridgeSyncService?: BridgeSyncService;
  }
}
