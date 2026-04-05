import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../shared/types.js";
import type { AuthUser, TokenPayload } from "../shared/types.js";
import { COOKIE_NAMES } from "../shared/constants.js";

/**
 * Public routes that do not require authentication.
 */
const PUBLIC_PREFIXES = ["/api/auth/", "/api/events/", "/health"];

/**
 * Check if a route path is public (no auth required).
 */
function isPublicRoute(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix));
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

/**
 * Compute SHA-256 hash of an API key for database lookup.
 */
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Auth preHandler hook.
 * Waterfall: cookie kanon_at -> Bearer header -> X-API-Key header.
 * Decorates request with `user: AuthUser` containing { userId, email }.
 */
async function authHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Skip auth for public routes
  if (isPublicRoute(request.url)) {
    return;
  }

  // 1. Try cookie-based auth (kanon_at)
  const cookieToken = request.cookies?.[COOKIE_NAMES.ACCESS];
  if (cookieToken) {
    const payload = tryVerifyAccessToken(cookieToken);
    if (payload) {
      request.user = {
        userId: payload.sub,
        email: payload.email,
      };
      return;
    }
    // Cookie present but invalid — fall through to other methods
  }

  // 2. Try Bearer token
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyAccessToken(token);

    request.user = {
      userId: payload.sub,
      email: payload.email,
    };
    return;
  }

  // 3. Try API key — looks up User table
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    const hash = hashApiKey(apiKey);
    const user = await prisma.user.findFirst({
      where: { apiKeyHash: hash },
    });

    if (!user) {
      throw new AppError(401, "INVALID_API_KEY", "Invalid API key");
    }

    request.user = {
      userId: user.id,
      email: user.email,
    };
    return;
  }

  throw new AppError(
    401,
    "UNAUTHORIZED",
    "Authentication required. Provide a Bearer token or X-API-Key header.",
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
