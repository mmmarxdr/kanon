import type { MemberRole } from "@prisma/client";
import type { BridgeSyncService } from "../services/bridge-sync-service.js";
import type { IEventBus } from "../services/event-bus/index.js";

/**
 * Structured application error with HTTP status code and machine-readable code.
 * Optional `details` carries extra context (e.g. `{ issueKeys: string[] }`)
 * that the error handler forwards to the client.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
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
    /** Per-project role resolved by the effective-role gate (KAN-16).
     *  Set when a project-scoped preHandler runs. Undefined on workspace-only routes.
     *  INVARIANT: member.id is always the workspace Member.id, never ProjectMember.id. */
    projectRole?: MemberRole;
    /** Gate-resolved project UUID (KAN-16 security fix).
     *  Set by requireProjectRole/requireProjectMember so downstream handlers and
     *  services use the SAME project the gate authorized, preventing gate↔handler
     *  divergence on key-collision across workspaces. */
    projectId?: string;
  }
  interface FastifyInstance {
    bridgeSyncService?: BridgeSyncService;
    eventBus: IEventBus;
  }
}
