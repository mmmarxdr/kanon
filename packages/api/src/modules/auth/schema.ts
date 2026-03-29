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
 */
export const RegisterResponse = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
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

/**
 * API key generation response.
 */
export const ApiKeyResponse = z.object({
  apiKey: z.string(),
});

/**
 * /me endpoint response — current authenticated user.
 * Returns User-level data only, no workspace fields.
 */
export const MeResponse = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
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
