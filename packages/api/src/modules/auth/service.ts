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
 * Sign a JWT access + refresh token pair for a member.
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
 * Register a new member in a workspace.
 */
export async function register(body: RegisterBody) {
  // Check for duplicate email within workspace
  const existingEmail = await prisma.member.findUnique({
    where: {
      workspaceId_email: {
        workspaceId: body.workspaceId,
        email: body.email,
      },
    },
  });
  if (existingEmail) {
    throw new AppError(409, "DUPLICATE_EMAIL", "Email already registered in this workspace");
  }

  // Check for duplicate username within workspace
  const existingUsername = await prisma.member.findUnique({
    where: {
      workspaceId_username: {
        workspaceId: body.workspaceId,
        username: body.username,
      },
    },
  });
  if (existingUsername) {
    throw new AppError(
      409,
      "DUPLICATE_USERNAME",
      "Username already taken in this workspace",
    );
  }

  const passwordHash = await hashPassword(body.password);

  const member = await prisma.member.create({
    data: {
      email: body.email,
      username: body.username,
      passwordHash,
      workspaceId: body.workspaceId,
    },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });

  return member;
}

/**
 * UUID v4 regex for detecting whether workspaceId is a UUID or a slug.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a workspace identifier (UUID or slug) to a workspace UUID.
 */
async function resolveWorkspaceId(idOrSlug: string): Promise<string> {
  if (UUID_RE.test(idOrSlug)) {
    return idOrSlug;
  }
  // Treat as slug
  const workspace = await prisma.workspace.findUnique({
    where: { slug: idOrSlug },
    select: { id: true },
  });
  if (!workspace) {
    throw new AppError(
      404,
      "WORKSPACE_NOT_FOUND",
      `Workspace "${idOrSlug}" not found`,
    );
  }
  return workspace.id;
}

/**
 * Authenticate a member and return JWT tokens.
 */
export async function login(body: LoginBody) {
  const workspaceId = await resolveWorkspaceId(body.workspaceId);

  const member = await prisma.member.findUnique({
    where: {
      workspaceId_email: {
        workspaceId,
        email: body.email,
      },
    },
  });

  if (!member) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const valid = await verifyPassword(body.password, member.passwordHash);
  if (!valid) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const payload: TokenPayload = {
    sub: member.id,
    workspaceId: member.workspaceId,
    role: member.role,
  };

  return signTokens(payload);
}

/**
 * Refresh an access token using a valid refresh token.
 */
export function refresh(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);

  // Sign a new access token only
  const accessToken = jwt.sign(
    { sub: payload.sub, workspaceId: payload.workspaceId, role: payload.role },
    env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY.ACCESS },
  );

  return { accessToken };
}

/**
 * Change a member's password.
 * Verifies the current password before updating.
 */
export async function changePassword(
  memberId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { passwordHash: true },
  });

  if (!member) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const valid = await verifyPassword(currentPassword, member.passwordHash);
  if (!valid) {
    throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
  }

  const newHash = await hashPassword(newPassword);
  await prisma.member.update({
    where: { id: memberId },
    data: { passwordHash: newHash },
  });
}

/**
 * Generate and store an API key for a member.
 * Returns the plain-text key (shown once).
 */
export async function generateApiKey(memberId: string) {
  const rawKey = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(rawKey).digest("hex");

  await prisma.member.update({
    where: { id: memberId },
    data: { apiKeyHash: hash },
  });

  return { apiKey: rawKey };
}
