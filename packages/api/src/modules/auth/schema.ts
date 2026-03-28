import { z } from "zod";

/**
 * Registration request body.
 */
export const RegisterBody = z.object({
  email: z.string().email("Invalid email address"),
  username: z
    .string()
    .min(2, "Username must be at least 2 characters")
    .max(50, "Username must be at most 50 characters"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  workspaceId: z.string().uuid("Invalid workspace ID"),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

/**
 * Login request body.
 * workspaceId accepts either a UUID or a workspace slug (e.g. "kanon-dev").
 */
export const LoginBody = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
  workspaceId: z.string().min(1, "Workspace ID or slug is required"),
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
  username: z.string(),
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
 */
export const MeResponse = z.object({
  memberId: z.string().uuid(),
  email: z.string(),
  username: z.string(),
  workspaceId: z.string().uuid(),
  role: z.string(),
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
