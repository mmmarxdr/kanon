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
 */
export interface AuthUser {
  memberId: string;
  workspaceId: string;
  role: MemberRole;
}

/**
 * JWT token payload structure.
 */
export interface TokenPayload {
  sub: string; // memberId
  workspaceId: string;
  role: MemberRole;
}

/**
 * Fastify request augmentation for authenticated routes.
 */
declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
  interface FastifyInstance {
    bridgeSyncService?: BridgeSyncService;
  }
}
