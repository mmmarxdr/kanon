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
  MeResponse,
  ChangePasswordBody,
  ForgotPasswordBody,
  ForgotPasswordResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
  OnboardBody,
  OnboardResponse,
  InstanceOnboardResponse,
  ExchangeBody,
  ExchangeResponse,
  RefreshIssueResponse,
  VerifyEmailBody,
  VerifyEmailResponse,
  ResendVerificationResponse,
  MagicLinkBody,
  MagicLinkResponse,
  VerifyMagicLinkBody,
  VerifyMagicLinkResponse,
} from "./schema.js";
import { z } from "zod";
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
      const result = await authService.register(request.body, emailProvider);
      // When invite was accepted, result contains accessToken + refreshToken.
      // Set auth cookies (mirrors login) so browser clients are immediately authenticated.
      if (result.accessToken && result.refreshToken) {
        setAuthCookies(reply, result.accessToken, result.refreshToken);
      }
      return reply.status(201).send(result);
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
      // KAN-77: token-rotation path — generous limit so active sessions are
      // never throttled, while still bounding abuse (the refresh token is a
      // high-entropy secret, not brute-forceable).
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
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

      // Single-query /me (MEDIUM-1, KAN-49): isSuperAdmin and isInstanceAdmin are
      // now columns on the User row — no InstanceSettings JOIN needed.
      const user = await prisma.user.findUnique({
        where: { id: authUser.userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
          emailVerifiedAt: true,
          isInstanceAdmin: true,
          isSuperAdmin: true,
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
        emailVerified: user.emailVerifiedAt !== null,
        isSuperAdmin: user.isSuperAdmin,
        isInstanceAdmin: user.isInstanceAdmin,
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
      // KAN-77: single-use token redemption — tight limit against token grinding.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
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
   * POST /api/auth/onboard
   * Consume a single-use onboarding JWT.
   *
   * - scope=onboard         → workspace-member path (existing): returns OnboardResponse
   * - scope=instance_onboard → instance-admin path (PR1b): returns InstanceOnboardResponse
   *
   * Public — all /api/auth/* routes are already in PUBLIC_PREFIXES.
   */
  app.post(
    "/onboard",
    {
      // KAN-77: single-use onboarding-token redemption — tight limit.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: OnboardBody,
        response: { 200: z.union([OnboardResponse, InstanceOnboardResponse]) },
      },
    },
    async (request, _reply) => {
      return authService.onboard((request.body as OnboardBody).token);
    },
  );

  /**
   * POST /api/auth/exchange
   * Exchange an opaque refresh token for a short-lived access token.
   * Public — all /api/auth/* routes are already in PUBLIC_PREFIXES.
   */
  app.post(
    "/exchange",
    {
      // KAN-77: MCP/CLI access-token rotation path (hit ~hourly per client on
      // 401). Generous limit so working agents/devs are never throttled; the
      // opaque refresh token is high-entropy and not brute-forceable.
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: ExchangeBody,
        response: { 200: ExchangeResponse },
      },
    },
    async (request, _reply) => {
      return authService.exchange((request.body as ExchangeBody).refreshToken);
    },
  );

  /**
   * POST /api/auth/refresh-issue
   * Exchange a short-lived access token (from /login) for a DB-backed opaque
   * refresh token compatible with the /exchange endpoint.
   * Requires Bearer access token in Authorization header.
   */
  app.post(
    "/refresh-issue",
    {
      // KAN-77: requires a valid access token (manualAuth) — low brute-force
      // risk; generous limit aligned with the other rotation endpoints.
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      schema: {
        response: { 200: RefreshIssueResponse },
      },
    },
    async (request, _reply) => {
      const authUser = manualAuth(request);
      return authService.issueRefreshFromLogin(authUser.userId);
    },
  );

  /**
   * POST /api/auth/verify-email
   * Public route (all /api/auth/* are public-skipped by auth plugin).
   * Consumes a single-use verification token and marks the user's email as verified.
   */
  app.post(
    "/verify-email",
    {
      // KAN-77: single-use verification-token redemption — tight limit.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: VerifyEmailBody,
        response: { 200: VerifyEmailResponse },
      },
    },
    async (request, _reply) => {
      const body = request.body as VerifyEmailBody;
      await authService.verifyEmail(body.token);
      return { message: "Email verified successfully" };
    },
  );

  /**
   * POST /api/auth/resend-verification
   * Requires manual authentication (public /api/auth/* prefix bypasses auth hook).
   * Always returns 200 (no-enumeration). Rate-limited: 3/min.
   */
  app.post(
    "/resend-verification",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
        },
      },
      schema: {
        response: { 200: ResendVerificationResponse },
      },
    },
    async (request, _reply) => {
      const authUser = manualAuth(request);
      await authService.resendVerification(authUser.userId, authUser.email, emailProvider);
      return { message: "If your email is unverified, a new verification email has been sent" };
    },
  );

  /**
   * POST /api/auth/magic-link
   * Sends a magic-link sign-in email if the account exists.
   * Always returns 200 to prevent email enumeration (KAN-9).
   * Rate limited: 3 attempts per minute per IP.
   */
  app.post(
    "/magic-link",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: MagicLinkBody,
        response: { 200: MagicLinkResponse },
      },
    },
    async (request, _reply) => {
      await authService.requestMagicLink(
        (request.body as MagicLinkBody).email,
        emailProvider,
      );
      return {
        message:
          "If that email is registered, you will receive a sign-in link",
      };
    },
  );

  /**
   * POST /api/auth/verify-magic-link
   * Validates a magic-link token and issues auth cookies + tokens (KAN-9).
   * Rate limited: 10 attempts per minute per IP.
   */
  app.post(
    "/verify-magic-link",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: VerifyMagicLinkBody,
        response: { 200: VerifyMagicLinkResponse },
      },
    },
    async (request, reply) => {
      const { token } = request.body as VerifyMagicLinkBody;
      const tokens = await authService.verifyMagicLink(token);

      // Set the same auth cookies as /login
      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);

      return tokens;
    },
  );
}
