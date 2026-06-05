/**
 * Auth crypto primitives — extracted to break the instance↔auth circular import.
 *
 * This module MUST NOT import from auth/service.ts or instance/service.ts.
 * It contains only pure crypto helpers used by both auth and instance layers.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { BCRYPT_COST, TOKEN_EXPIRY } from "../../shared/constants.js";
import type { TokenPayload } from "../../shared/types.js";

/**
 * Compute the SHA-256 hex digest of a string.
 * Used for hashing opaque refresh tokens before DB storage.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Generate a cryptographically secure opaque token (256 bits, base64url).
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Sign a JWT access + refresh token pair for a user.
 */
export function signTokens(payload: TokenPayload): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY.ACCESS,
  });
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: TOKEN_EXPIRY.REFRESH,
  });
  return { accessToken, refreshToken };
}
