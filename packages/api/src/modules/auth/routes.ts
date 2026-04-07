import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../../shared/types.js";
import { COOKIE_NAMES, getCookieConfig } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import {
  RegisterBody,
  RegisterResponse,
  LoginBody,
  LoginResponse,
  RefreshBody,
  RefreshResponse,
  ApiKeyResponse,
  MeResponse,
  ChangePasswordBody,
  ForgotPasswordBody,
  ForgotPasswordResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
} from "./schema.js";
import * as authService from "./service.js";
import { createEmailProvider } from "../../services/email/index.js";

/**
 * Helper: set auth cookies on a reply.
 */
function setAuthCookies(
  reply: any,
  accessToken: string,
  refreshToken: string,
) {
  const isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const config = getCookieConfig(isDev);
  const csrfToken = randomBytes(32).toString("hex");

  reply.setCookie(COOKIE_NAMES.ACCESS, accessToken, config.access);
  reply.setCookie(COOKIE_NAMES.REFRESH, refreshToken, config.refresh);
  reply.setCookie(COOKIE_NAMES.CSRF, csrfToken, config.csrf);
}

/**
 * Helper: clear auth cookies on a reply.
 */
function clearAuthCookies(reply: any) {
  const isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  const config = getCookieConfig(isDev);

  reply.clearCookie(COOKIE_NAMES.ACCESS, { path: config.access.path });
  reply.clearCookie(COOKIE_NAMES.REFRESH, { path: config.refresh.path });
  reply.clearCookie(COOKIE_NAMES.CSRF, { path: config.csrf.path });
}

/**
 * Helper: manually authenticate a request under /api/auth/* (public prefix).
 * Checks cookie first, then Bearer header.
 * Returns the authenticated user identity { userId, email }.
 */
function manualAuth(request: any): {
  userId: string;
  email: string;
} {
  // Try cookie
  const cookieToken = request.cookies?.[COOKIE_NAMES.ACCESS];
  if (cookieToken) {
    try {
      const payload = jwt.verify(cookieToken, env.JWT_SECRET) as any;
      return {
        userId: payload.sub,
        email: payload.email,
      };
    } catch {
      // fall through
    }
  }

  // Try Bearer header
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(authHeader.slice(7), env.JWT_SECRET) as any;
      return {
        userId: payload.sub,
        email: payload.email,
      };
    } catch {
      // fall through
    }
  }

  throw new AppError(401, "UNAUTHORIZED", "Authentication required");
}

/**
 * Auth routes plugin.
 * All routes under /api/auth are public (skipped by auth plugin).
 */
export default async function authRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const emailProvider = createEmailProvider();

  /**
   * POST /api/auth/register
   * Rate limited: 5 attempts per minute per IP.
   */
  app.post(
    "/register",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: RegisterBody,
        response: { 201: RegisterResponse },
      },
    },
    async (request, reply) => {
      const user = await authService.register(request.body);
      return reply.status(201).send(user);
    },
  );

  /**
   * POST /api/auth/login
   * Sets auth cookies AND returns tokens in body (backward compat).
   * Rate limited: 10 attempts per minute per IP.
   */
  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: LoginBody,
        response: { 200: LoginResponse },
      },
    },
    async (request, reply) => {
      const tokens = await authService.login(request.body);

      // Set cookies for browser clients
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);

      // Return tokens in body for backward compatibility (API-key users, MCP)
      return tokens;
    },
  );

  /**
   * POST /api/auth/refresh
   * Accepts refresh token from cookie OR body (backward compat).
   */
  app.post(
    "/refresh",
    {
      schema: {
        body: RefreshBody.optional().nullable(),
        response: { 200: RefreshResponse },
      },
    },
    async (request, reply) => {
      // Try cookie first, then body
      const refreshToken =
        request.cookies?.[COOKIE_NAMES.REFRESH] ||
        (request.body as any)?.refreshToken;

      if (!refreshToken) {
        throw new AppError(
          400,
          "MISSING_REFRESH_TOKEN",
          "Refresh token required (via cookie or body)",
        );
      }

      const result = authService.refresh(refreshToken);

      // Set new access token cookie
      const isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
      const config = getCookieConfig(isDev);
      reply.setCookie(COOKIE_NAMES.ACCESS, result.accessToken, config.access);

      return result;
    },
  );

  /**
   * GET /api/auth/me
   * Returns the current authenticated user from cookie/token.
   * Manually authenticated since it's under the public /api/auth/ prefix.
   */
  app.get(
    "/me",
    {
      schema: {
        response: { 200: MeResponse },
      },
    },
    async (request, _reply) => {
      const authUser = manualAuth(request);

      const user = await prisma.user.findUnique({
        where: { id: authUser.userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      });

      if (!user) {
        throw new AppError(401, "USER_NOT_FOUND", "User no longer exists");
      }

      return {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      };
    },
  );

  /**
   * POST /api/auth/logout
   * Clears all auth cookies.
   */
  app.post("/logout", async (request, reply) => {
    clearAuthCookies(reply);
    return reply.status(200).send({ success: true });
  });

  /**
   * POST /api/auth/change-password
   * Requires authentication (manual check).
   */
  app.post(
    "/change-password",
    {
      schema: {
        body: ChangePasswordBody,
      },
    },
    async (request, reply) => {
      const authUser = manualAuth(request);
      await authService.changePassword(
        authUser.userId,
        (request.body as any).currentPassword,
        (request.body as any).newPassword,
      );
      return reply.status(200).send({ success: true });
    },
  );

  /**
   * POST /api/auth/forgot-password
   * Sends a password reset email if the account exists.
   * Always returns 200 to prevent email enumeration.
   * Rate limited: 3 attempts per minute per IP.
   */
  app.post(
    "/forgot-password",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: ForgotPasswordBody,
        response: { 200: ForgotPasswordResponse },
      },
    },
    async (request, _reply) => {
      await authService.requestPasswordReset(
        (request.body as ForgotPasswordBody).email,
        emailProvider,
      );
      return {
        message:
          "If that email is registered, you will receive a reset link",
      };
    },
  );

  /**
   * POST /api/auth/reset-password
   * Resets the user's password using a valid reset token.
   */
  app.post(
    "/reset-password",
    {
      schema: {
        body: ResetPasswordBody,
        response: { 200: ResetPasswordResponse },
      },
    },
    async (request, _reply) => {
      const body = request.body as ResetPasswordBody;
      await authService.resetPassword(body.token, body.newPassword);
      return { message: "Password has been reset successfully" };
    },
  );

  /**
   * POST /api/auth/api-key
   * This route is under /api/auth/* which the auth plugin skips.
   * We manually verify the JWT in the handler since this endpoint requires auth.
   * Rate limited: 5 attempts per minute per IP.
   */
  app.post(
    "/api-key",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
      schema: {
        response: { 201: ApiKeyResponse },
      },
    },
    async (request, reply) => {
      // Manually authenticate since auth plugin skips /api/auth/* routes
      const authUser = manualAuth(request);
      request.user = authUser;

      const result = await authService.generateApiKey(authUser.userId);
      return reply.status(201).send(result);
    },
  );
}
