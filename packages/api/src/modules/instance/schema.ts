import { z } from "zod";

/**
 * Body schema for POST /api/instance/setup/claim (KAN-49).
 */
export const ClaimBody = z.object({
  token: z.string().min(20, "Token must be at least 20 characters"),
  email: z.string().email("Must be a valid email address"),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters")
    .regex(/[0-9!@#$%^&*]/, "Password must contain a number or symbol"),
});
export type ClaimBodyType = z.infer<typeof ClaimBody>;

/**
 * Body schema for PATCH /api/instance/settings.
 * All fields are optional. signupMode and allowedSignupDomains are stored
 * only — NOT enforced in this layer (layer 2 deferred).
 */
export const PatchSettingsBody = z.object({
  instanceName: z.string().max(120).optional(),
  signupMode: z.enum(["open", "invite", "closed"]).optional(),
  allowedSignupDomains: z.array(z.string()).optional(),
});
export type PatchSettingsBodyType = z.infer<typeof PatchSettingsBody>;

/**
 * Response schema for GET /api/instance/settings.
 */
export const SettingsResponse = z.object({
  id: z.string(),
  instanceName: z.string().nullable(),
  signupMode: z.string(),
  allowedSignupDomains: z.array(z.string()),
  ownerUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Response schema for GET /api/instance/setup/status.
 */
export const StatusResponse = z.object({
  claimed: z.boolean(),
});

/**
 * Response schema for POST /api/instance/setup/claim.
 */
export const ClaimResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

/**
 * Body schema for POST /api/instance/admins/invites (PR1b, KAN-49).
 * Super-admin mints an instance-level admin onboarding invite.
 */
export const MintInstanceAdminInviteBody = z.object({
  email: z.string().email("Must be a valid email address"),
  ttlHours: z.number().int().min(1).max(720).optional(),
});
export type MintInstanceAdminInviteBodyType = z.infer<typeof MintInstanceAdminInviteBody>;

/**
 * Response schema for POST /api/instance/admins/invites (PR1b, KAN-49).
 * Mirrors OnboardingInviteResponse from invite/schema.ts.
 */
export const MintInstanceAdminInviteResponse = z.object({
  inviteId: z.string().uuid(),
  url: z.string(),       // kanon://<host>/onboard?token=<jwt>
  token: z.string(),     // raw JWT — for the admin UI
  expiresAt: z.string().datetime(),
});
