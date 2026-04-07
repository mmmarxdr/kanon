import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { AppError } from "../shared/types.js";
import { COOKIE_NAMES } from "../shared/constants.js";

/**
 * HTTP methods that require CSRF validation.
 */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes that are exempt from CSRF validation.
 * Login/register/refresh don't have a CSRF token yet.
 */
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/events/",
  "/health",
];

function isCsrfExempt(url: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * CSRF validation hook using the double-submit cookie pattern.
 * Compares X-CSRF-Token header against kanon_csrf cookie value.
 * Skipped when:
 * - The request uses API-key authentication (X-API-Key header present)
 * - The request method is not a mutation (GET, HEAD, OPTIONS)
 * - The route is exempt (login, register, refresh)
 * - No CSRF cookie is present (non-cookie auth session)
 */
async function csrfHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Only validate mutations
  if (!MUTATION_METHODS.has(request.method)) {
    return;
  }

  // Skip exempt routes
  if (isCsrfExempt(request.url)) {
    return;
  }

  // Skip if using API key auth (programmatic clients)
  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return;
  }

  // Skip if no CSRF cookie present (non-cookie auth, e.g. Bearer token from API)
  const csrfCookie = request.cookies?.[COOKIE_NAMES.CSRF];
  if (!csrfCookie) {
    return;
  }

  // Validate: X-CSRF-Token header must match the cookie value
  const csrfHeader = request.headers["x-csrf-token"];
  if (!csrfHeader || csrfHeader !== csrfCookie) {
    throw new AppError(
      403,
      "CSRF_INVALID",
      "CSRF token missing or invalid. Include X-CSRF-Token header matching the kanon_csrf cookie.",
    );
  }
}

/**
 * CSRF plugin. Adds CSRF validation as an onRequest hook.
 */
async function csrfPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook("onRequest", csrfHook);
}

export default fp(csrfPlugin, {
  name: "csrf",
  dependencies: ["auth", "@fastify/cookie"],
});
