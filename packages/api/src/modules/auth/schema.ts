import { z } from "zod";

/**
 * Registration request body.
 * No workspace or username — users register globally.
 */
export const RegisterBody = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  displayName: z
    .string()
    .min(1, "Display name must be at least 1 character")
    .max(100, "Display name must be at most 100 characters")
    .optional(),
  /** Optional invite token — when present, register auto-accepts the invite and issues a session. */
  invite: z.string().min(1).optional(),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

/**
 * Login request body.
 * No workspace — auth is workspace-independent.
 */
export const LoginBody = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginBody = z.infer<typeof LoginBody>;

/**
 * Refresh token request body.
 */
export const RefreshBody = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});
export type RefreshBody = z.infer<typeof RefreshBody>;

/**
 * Registration response.
 * Without invite: { id, email, displayName } — no session issued.
 * With invite: also includes accessToken + refreshToken (mirrors login).
 * Auth cookies are also set when invite is present.
 */
export const RegisterResponse = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  // Present only when invite was accepted (auto-login path)
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
});

/**
 * Login response.
 */
export const LoginResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

/**
 * Refresh response.
 */
export const RefreshResponse = z.object({
  accessToken: z.string(),
});

// NOTE: ApiKeyResponse removed in PR1 (KAN-35) — POST /api/auth/api-key route was deleted.

/**
 * /me endpoint response — current authenticated user.
 * Returns User-level data only, no workspace fields.
 * isSuperAdmin: derived from InstanceSettings.ownerUserId === user.id
 * isInstanceAdmin: derived from User.isInstanceAdmin (KAN-49 PR1a)
 */
export const MeResponse = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  emailVerified: z.boolean(),
  isSuperAdmin: z.boolean(),
  isInstanceAdmin: z.boolean(),
});

// ── Email Verification ────────────────────────────────────────────────────────

/**
 * POST /api/auth/verify-email request body.
 */
export const VerifyEmailBody = z.object({
  token: z.string().min(1, "Verification token is required"),
});
export type VerifyEmailBody = z.infer<typeof VerifyEmailBody>;

/**
 * POST /api/auth/verify-email response.
 */
export const VerifyEmailResponse = z.object({
  message: z.string(),
});

/**
 * POST /api/auth/resend-verification response.
 */
export const ResendVerificationResponse = z.object({
  message: z.string(),
});

/**
 * Change password request body.
 */
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(8, "New password must be at least 8 characters")
    .max(128, "New password must be at most 128 characters"),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

/**
 * Forgot password request body.
 */
export const ForgotPasswordBody = z.object({
  email: z.string().email("Invalid email address"),
});
export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBody>;

/**
 * Forgot password response.
 */
export const ForgotPasswordResponse = z.object({
  message: z.string(),
});

/**
 * Reset password request body.
 */
export const ResetPasswordBody = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});
export type ResetPasswordBody = z.infer<typeof ResetPasswordBody>;

/**
 * Reset password response.
 */
export const ResetPasswordResponse = z.object({
  message: z.string(),
});

// ── Onboarding (CLI token exchange) ──────────────────────────────────────────

/**
 * POST /api/auth/onboard request body.
 * Accepts a single-use onboarding JWT issued by the server.
 */
export const OnboardBody = z.object({
  token: z.string().min(20, "Token is required"),
});
export type OnboardBody = z.infer<typeof OnboardBody>;

/**
 * POST /api/auth/onboard response — workspace-member path (scope=onboard).
 * Returns a long-lived opaque refresh token for the CLI credential store.
 */
export const OnboardResponse = z.object({
  refreshToken: z.string(),
  apiUrl: z.string(),
  workspace: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  }),
  email: z.string().email(),
  expiresAt: z.string().datetime(),
});

/**
 * POST /api/auth/onboard response — instance-admin path (scope=instance_onboard, PR1b).
 * No workspace or RefreshToken row — the user sets their password via forgot-password flow.
 */
export const InstanceOnboardResponse = z.object({
  ok: z.literal(true),
  email: z.string().email(),
});

// ── Refresh-issue (login → opaque token) ─────────────────────────────────────

/**
 * POST /api/auth/refresh-issue response.
 * Issues a DB-backed opaque refresh token for a user who authenticated via
 * the standard login() flow (which returns only stateless JWTs).
 * Requires Bearer access token from POST /api/auth/login.
 */
export const RefreshIssueResponse = z.object({
  refreshToken: z.string(),
  expiresAt: z.string().datetime(),
});

// ── Token exchange ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/exchange request body.
 * Accepts an opaque refresh token to issue a short-lived access token.
 */
export const ExchangeBody = z.object({
  refreshToken: z.string().min(40, "Refresh token is required"),
});
export type ExchangeBody = z.infer<typeof ExchangeBody>;

/**
 * POST /api/auth/exchange response.
 */
export const ExchangeResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(), // seconds — 3600
});
