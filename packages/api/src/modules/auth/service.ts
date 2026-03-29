import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import { BCRYPT_COST, TOKEN_EXPIRY } from "../../shared/constants.js";
import type { TokenPayload } from "../../shared/types.js";
import type { RegisterBody, LoginBody } from "./schema.js";

/**
 * Hash a password with bcrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verify a password against a bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
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

/**
 * Verify a refresh token and return the payload.
 */
export function verifyRefreshToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_REFRESH_SECRET) as TokenPayload;
  } catch {
    throw new AppError(
      401,
      "INVALID_REFRESH_TOKEN",
      "Invalid or expired refresh token",
    );
  }
}

/**
 * Register a new user (globally — no workspace).
 */
export async function register(body: RegisterBody) {
  // Check for duplicate email globally
  const existingUser = await prisma.user.findUnique({
    where: { email: body.email },
  });
  if (existingUser) {
    throw new AppError(409, "DUPLICATE_EMAIL", "Email already registered");
  }

  const passwordHash = await hashPassword(body.password);

  const user = await prisma.user.create({
    data: {
      email: body.email,
      passwordHash,
      displayName: body.displayName ?? null,
    },
    select: {
      id: true,
      email: true,
      displayName: true,
    },
  });

  return user;
}

/**
 * Authenticate a user by email and password (no workspace).
 */
export async function login(body: LoginBody) {
  const user = await prisma.user.findUnique({
    where: { email: body.email },
  });

  if (!user) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
  };

  return signTokens(payload);
}

/**
 * Refresh an access token using a valid refresh token.
 */
export function refresh(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);

  // Sign a new access token only (with same user-level claims)
  const accessToken = jwt.sign(
    { sub: payload.sub, email: payload.email },
    env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY.ACCESS },
  );

  return { accessToken };
}

/**
 * Change a user's password.
 * Verifies the current password before updating.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
  }

  const newHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });
}

/**
 * Generate and store an API key for a user.
 * Returns the plain-text key (shown once).
 */
export async function generateApiKey(userId: string) {
  const rawKey = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(rawKey).digest("hex");

  await prisma.user.update({
    where: { id: userId },
    data: { apiKeyHash: hash },
  });

  return { apiKey: rawKey };
}
