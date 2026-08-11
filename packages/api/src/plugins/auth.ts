import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../shared/types.js";
import type { AuthUser, TokenPayload, AccessTokenPayload } from "../shared/types.js";
import { COOKIE_NAMES } from "../shared/constants.js";

/**
 * Public routes that do not require authentication.
 */
// KAN-83: dropped the dead "/api/events/sync" prefix — no such route exists, so
// it only created a hazard (any route later mounted there would be silently
// public). SSE lives at /api/events/workspace/* and is auth-gated.
const PUBLIC_PREFIXES = ["/api/auth/", "/health", "/api/instance/setup/"];

/**
 * Check if a route path is public (no auth required).
 */
function isPublicRoute(url: string, method: string): boolean {
  if (PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return true;
  }

  // /metrics handles its own bearer-token auth (METRICS_TOKEN) internally —
  // exempt from JWT authHook to avoid double-auth rejection. Match on the path
  // only (request.url includes the query string), and exact-or-subpath rather
  // than startsWith so /metricsfoo cannot bypass JWT.
  const path = url.split("?", 1)[0] ?? url;
  if (path === "/metrics" || path.startsWith("/metrics/")) {
    return true;
  }

  // GET /api/invites/:token is public (invite metadata preview).
  // POST /api/invites/:token/accept requires auth, so only GET is public.
  if (method === "GET" && url.startsWith("/api/invites/")) {
    return true;
  }

  return false;
}

/**
 * Verify a JWT access token and return the payload.
 */
function verifyAccessToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "Invalid or expired access token");
  }
}

/**
 * Try to verify a JWT access token, returning null on failure instead of throwing.
 */
function tryVerifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

function authUser(payload: TokenPayload): AuthUser {
  const scopedPayload = payload as unknown as Partial<AccessTokenPayload>;
  const allowedProjectIds = Array.isArray(scopedPayload.allowedProjectIds) && scopedPayload.allowedProjectIds.length > 0
    ? scopedPayload.allowedProjectIds
    : undefined;
  return {
    userId: payload.sub,
    email: payload.email,
    ...(allowedProjectIds !== undefined ? { allowedProjectIds } : {}),
  };
}

/**
 * Auth preHandler hook.
 * Waterfall: cookie kanon_at -> Bearer header.
 * X-API-Key is no longer accepted (removed in PR1, KAN-35).
 * Decorates request with `user: AuthUser` containing { userId, email }.
 */
async function authHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Skip auth for public routes
  if (isPublicRoute(request.url, request.method)) {
    return;
  }

  // 1. Try cookie-based auth (kanon_at)
  const cookieToken = request.cookies?.[COOKIE_NAMES.ACCESS];
  if (cookieToken) {
    const payload = tryVerifyAccessToken(cookieToken);
    if (payload) {
      request.user = authUser(payload);
      return;
    }
    // Cookie present but invalid — fall through to other methods
  }

  // 2. Try Bearer token
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);

    request.user = authUser(payload);
    return;
  }

  throw new AppError(
    401,
    "UNAUTHORIZED",
    "Authentication required. Provide a Bearer token.",
  );
}

/**
 * Auth plugin. Registers the auth preHandler on all routes.
 * Public routes are skipped inside the hook.
 */
async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate request with a default user value (required by Fastify)
  fastify.decorateRequest("user", null as unknown as AuthUser);

  // Decorate request with a default member value (set by requireRole/requireMember preHandlers)
  fastify.decorateRequest("member", undefined);

  // Add auth hook to all routes
  fastify.addHook("onRequest", authHook);
}

export default fp(authPlugin, {
  name: "auth",
  dependencies: ["error-handler", "@fastify/cookie"],
});
