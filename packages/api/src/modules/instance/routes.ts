/**
 * Instance Layer routes (KAN-49).
 *
 * Registers:
 *  POST   /setup/claim    — PUBLIC: one-time super-admin claim
 *  GET    /setup/status   — PUBLIC: is the instance claimed?
 *  GET    /settings       — super-admin only: read settings
 *  PATCH  /settings       — super-admin only: update settings
 *
 * Prefix is "/api/instance" (registered in app.ts).
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { randomBytes } from "node:crypto";
import { COOKIE_NAMES, getCookieConfig } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { requireSuperAdmin } from "../../middleware/require-role.js";
import { prisma } from "../../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  ClaimBody,
  ClaimResponse,
  MintInstanceAdminInviteBody,
  MintInstanceAdminInviteResponse,
  PatchSettingsBody,
  SettingsResponse,
  StatusResponse,
} from "./schema.js";
import * as instanceService from "./service.js";

export default async function instanceRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // ─── POST /setup/claim (PUBLIC) ──────────────────────────────────────────

  /**
   * One-time claim endpoint.
   * Validates the setup token, creates a fresh super-admin user, sets
   * ownerUserId on the singleton, and issues a web session via cookies.
   */
  app.post(
    "/setup/claim",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
      schema: {
        body: ClaimBody,
        response: { 200: ClaimResponse },
      },
    },
    async (request, reply) => {
      const tokens = await instanceService.claimInstance(request.body);

      // Set auth cookies exactly like the login route
      const isDev = env.NODE_ENV === "development" || env.NODE_ENV === "test";
      const config = getCookieConfig(isDev);
      const csrfToken = randomBytes(32).toString("hex");

      reply.setCookie(COOKIE_NAMES.ACCESS, tokens.accessToken, config.access);
      reply.setCookie(COOKIE_NAMES.REFRESH, tokens.refreshToken, config.refresh);
      reply.setCookie(COOKIE_NAMES.CSRF, csrfToken, config.csrf);

      return reply.status(200).send(tokens);
    },
  );

  // ─── GET /setup/status (PUBLIC) ──────────────────────────────────────────

  /**
   * Returns { claimed: boolean }.
   * Used by the unauthenticated /setup page to redirect away if already claimed.
   *
   * INTENTIONALLY PUBLIC: no auth required — the setup page must read this
   * before any session exists. It discloses only whether the instance is claimed.
   * Internet-facing deployments should restrict this endpoint at the network/proxy
   * layer once setup is complete to avoid leaking unclaimed-instance state.
   */
  app.get(
    "/setup/status",
    {
      schema: {
        response: { 200: StatusResponse },
      },
    },
    async (_request, reply) => {
      const settings = await prisma.instanceSettings.findUnique({
        where: { id: INSTANCE_SETTINGS_ID },
        select: { ownerUserId: true },
      });
      return reply.status(200).send({ claimed: settings?.ownerUserId != null });
    },
  );

  // ─── GET /settings (requireSuperAdmin) ───────────────────────────────────

  app.get(
    "/settings",
    {
      preHandler: [requireSuperAdmin()],
      schema: {
        response: { 200: SettingsResponse },
      },
    },
    async (_request, reply) => {
      const settings = await instanceService.getSettings();
      return reply.status(200).send({
        ...settings,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      });
    },
  );

  // ─── PATCH /settings (requireSuperAdmin) ─────────────────────────────────

  app.patch(
    "/settings",
    {
      preHandler: [requireSuperAdmin()],
      schema: {
        body: PatchSettingsBody,
        response: { 200: SettingsResponse },
      },
    },
    async (request, reply) => {
      const settings = await instanceService.patchSettings(request.body);
      return reply.status(200).send({
        ...settings,
        createdAt: settings.createdAt.toISOString(),
        updatedAt: settings.updatedAt.toISOString(),
      });
    },
  );

  // ─── POST /admins/invites (requireSuperAdmin) — PR1b ─────────────────────

  /**
   * Mint an instance-level admin invite (kanon:// URL + JWT).
   * Guarded by requireSuperAdmin() — only the instance super-admin may mint.
   */
  app.post(
    "/admins/invites",
    {
      preHandler: [requireSuperAdmin()],
      schema: {
        body: MintInstanceAdminInviteBody,
        response: { 201: MintInstanceAdminInviteResponse },
      },
    },
    async (request, reply) => {
      const result = await prisma.$transaction((tx) =>
        instanceService.mintInstanceAdminInvite(tx, {
          email: request.body.email,
          ttlHours: request.body.ttlHours,
          createdById: request.user.userId,
        }),
      );
      return reply.status(201).send(result);
    },
  );
}
