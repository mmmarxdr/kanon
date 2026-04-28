/**
 * Shared Zod schemas for Kanon API request/response shapes.
 *
 * These schemas are used by:
 *   - packages/setup/src/onboard.ts  — to validate POST /api/auth/onboard response
 *   - packages/setup/src/login.ts    — to validate POST /api/auth/exchange response
 *   - packages/mcp/src/wrapper.ts    — imported via @kanon-pm/setup/api-types
 *
 * The API package (packages/api/src/modules/auth/schema.ts) defines its own
 * Zod schemas that mirror these shapes. Keeping them separate avoids a
 * cross-package runtime dependency from setup → api.
 */

import { z } from "zod";

// ── POST /api/auth/onboard ────────────────────────────────────────────────────

export const OnboardBodySchema = z.object({
  token: z.string().min(20),
});

export type OnboardBody = z.infer<typeof OnboardBodySchema>;

export const OnboardResponseSchema = z.object({
  refreshToken: z.string(),
  apiUrl: z.string().url(),
  workspace: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  email: z.string().email(),
  expiresAt: z.string().datetime(),
});

export type OnboardResponse = z.infer<typeof OnboardResponseSchema>;

// ── POST /api/auth/exchange ───────────────────────────────────────────────────

export const ExchangeBodySchema = z.object({
  refreshToken: z.string().min(40),
});

export type ExchangeBody = z.infer<typeof ExchangeBodySchema>;

export const ExchangeResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
});

export type ExchangeResponse = z.infer<typeof ExchangeResponseSchema>;

// ── POST /api/workspaces/:wid/invites/onboarding ──────────────────────────────

export const OnboardingInviteBodySchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(["MEMBER", "ADMIN"]).optional().default("MEMBER"),
  ttlHours: z.number().int().min(1).max(72).optional().default(72),
});

export type OnboardingInviteBody = z.infer<typeof OnboardingInviteBodySchema>;

export const OnboardingInviteResponseSchema = z.object({
  inviteId: z.string().uuid(),
  url: z.string(),
  token: z.string(),
  expiresAt: z.string().datetime(),
});

export type OnboardingInviteResponse = z.infer<
  typeof OnboardingInviteResponseSchema
>;
