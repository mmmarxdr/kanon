import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import { BCRYPT_COST, TOKEN_EXPIRY } from "../../shared/constants.js";
import type { TokenPayload } from "../../shared/types.js";
import type { RegisterBody, LoginBody } from "./schema.js";
import type { EmailProvider } from "../../services/email/types.js";

// ── D6 helpers ────────────────────────────────────────────────────────────────

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
 * Sign an onboarding JWT: scope=onboard, sub=inviteId, exp=ttlHours.
 */
export function signOnboardingToken(inviteId: string, ttlHours: number): string {
  return jwt.sign(
    { sub: inviteId, scope: "onboard" },
    env.JWT_SECRET,
    { expiresIn: `${ttlHours}h` },
  );
}

/**
 * Sign a short-lived access token for the CLI/MCP path.
 * Payload: { sub: userId, workspace: workspaceId, scope: "access" }
 */
export function signAccessToken(userId: string, workspaceId: string): string {
  return jwt.sign(
    { sub: userId, workspace: workspaceId, scope: "access" },
    env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY.ACCESS },
  );
}

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
 * Password reset token expiry duration (1 hour).
 */
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;

/**
 * Request a password reset for the given email.
 * Silently returns if the email is not found (no user enumeration).
 */
export async function requestPasswordReset(
  email: string,
  emailProvider: EmailProvider,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });

  if (!user) {
    // Silent return — don't reveal whether the email exists
    return;
  }

  // Delete all existing reset tokens for this user
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id },
  });

  // Generate token and hash it for storage
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
    },
  });

  // Build reset URL and send email
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;

  await emailProvider.send({
    to: user.email,
    subject: "Reset your password",
    html: `
      <p>You requested a password reset.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
    text: `You requested a password reset. Visit this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
  });
}

/**
 * Reset a user's password using a valid reset token.
 * Throws if the token is invalid, expired, or already used.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const resetToken = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!resetToken) {
    throw new AppError(
      400,
      "INVALID_RESET_TOKEN",
      "Invalid or expired reset token",
    );
  }

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: newHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        userId: resetToken.userId,
        id: { not: resetToken.id },
      },
    }),
  ]);
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

// ── D-extension: issueRefreshFromLogin() ────────────────────────────────────

/**
 * Issue a DB-backed opaque refresh token for a user who authenticated via
 * the standard login flow (which returns only stateless JWTs incompatible
 * with the exchange() endpoint that requires a DB row).
 *
 * Called by POST /api/auth/refresh-issue (Bearer-authenticated).
 *
 * Picks the user's first workspace membership to associate the token.
 * If the user has no workspace memberships, throws 403 NO_WORKSPACE.
 */
export async function issueRefreshFromLogin(userId: string): Promise<{
  refreshToken: string;
  expiresAt: string;
}> {
  // Resolve a workspace for the refresh token — pick the first active membership
  const member = await prisma.member.findFirst({
    where: { userId },
    select: { workspaceId: true },
    orderBy: { createdAt: "asc" },
  });

  if (!member) {
    throw new AppError(
      403,
      "NO_WORKSPACE",
      "User has no workspace memberships — cannot issue refresh token",
    );
  }

  const rawToken = generateOpaqueToken();
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      source: "LOGIN",
      userId,
      workspaceId: member.workspaceId,
      expiresAt,
      metadata: {},
    },
  });

  return { refreshToken: rawToken, expiresAt: expiresAt.toISOString() };
}

// ── D7: onboard() ─────────────────────────────────────────────────────────────

/**
 * Consume a single-use onboarding JWT and issue a long-lived opaque refresh token.
 *
 * CRITICAL (option 1): validates that the user EXISTS and is already a workspace
 * member. Does NOT create users, does NOT touch passwordHash.
 *
 * Error map:
 *   - 400 INVALID_TOKEN   — bad/wrong-scope JWT
 *   - 410 TOKEN_EXPIRED   — JWT exp in the past
 *   - 410 TOKEN_CONSUMED  — invite.consumedAt already set
 *   - 400 TOKEN_REVOKED   — invite.revokedAt set
 *   - 404 USER_NOT_FOUND  — no User row matching invite.email
 *   - 403 NOT_A_MEMBER    — user not a member of invite.workspaceId
 */
export async function onboard(token: string) {
  // 1. Verify JWT — check signature and expiry
  let payload: { sub: string; scope: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as { sub: string; scope: string };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TokenExpiredError") {
      throw new AppError(410, "TOKEN_EXPIRED", "Onboarding token has expired");
    }
    throw new AppError(400, "INVALID_TOKEN", "Invalid onboarding token");
  }

  // 2. Assert scope=onboard
  if (payload.scope !== "onboard") {
    throw new AppError(400, "INVALID_TOKEN", "Invalid token scope");
  }

  const inviteId = payload.sub;

  return prisma.$transaction(async (tx) => {
    // 3. Lock and fetch invite
    const invite = await (tx as typeof prisma).workspaceInvite.findFirst({
      where: { id: inviteId, kind: "ONBOARDING" },
    });

    if (!invite) {
      throw new AppError(400, "INVALID_TOKEN", "Onboarding invite not found");
    }

    // 4. Check invite status
    if (invite.revokedAt) {
      throw new AppError(400, "TOKEN_REVOKED", "Onboarding token has been revoked");
    }
    if (invite.consumedAt) {
      throw new AppError(410, "TOKEN_CONSUMED", "Onboarding token has already been used");
    }
    // DB-level expiry check (defense-in-depth beyond JWT exp)
    if (invite.expiresAt < new Date()) {
      throw new AppError(410, "TOKEN_EXPIRED", "Onboarding token has expired");
    }

    // 5. Resolve user by email stored on invite (MUST exist — option 1)
    const user = await (tx as typeof prisma).user.findUnique({
      where: { email: invite.email! },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    // 6. Assert workspace membership
    const member = await (tx as typeof prisma).member.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
      select: {
        id: true,
        workspace: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!member) {
      throw new AppError(403, "NOT_A_MEMBER", "User is not a member of this workspace");
    }

    // 7. Generate opaque refresh token and store its hash
    const rawToken = generateOpaqueToken();
    const tokenHash = sha256Hex(rawToken);
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const refreshTokenRow = await (tx as typeof prisma).refreshToken.create({
      data: {
        tokenHash,
        source: "ONBOARDING",
        userId: user.id,
        workspaceId: invite.workspaceId,
        expiresAt: refreshExpiresAt,
        metadata: {},
      },
    });

    // 8. Mark invite as consumed (atomic — same tx)
    await (tx as typeof prisma).workspaceInvite.update({
      where: { id: inviteId },
      data: { consumedAt: new Date() },
    });

    return {
      refreshToken: rawToken,
      apiUrl: env.BASE_URL,
      workspace: member.workspace,
      email: user.email,
      expiresAt: refreshTokenRow.expiresAt.toISOString(),
    };
  });
}

// ── D8: exchange() ────────────────────────────────────────────────────────────

/**
 * Exchange a valid opaque refresh token for a short-lived access token.
 *
 * Error map:
 *   - 401 INVALID_REFRESH_TOKEN — token not in DB
 *   - 401 TOKEN_REVOKED         — revokedAt set
 *   - 401 TOKEN_EXPIRED         — expiresAt in the past
 */
export async function exchange(refreshToken: string) {
  // 1. SHA-256 the raw token to look up the DB row
  const tokenHash = sha256Hex(refreshToken);

  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });

  if (!row) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token not found");
  }

  if (row.revokedAt) {
    throw new AppError(401, "TOKEN_REVOKED", "Refresh token has been revoked");
  }

  if (row.expiresAt < new Date()) {
    throw new AppError(401, "TOKEN_EXPIRED", "Refresh token has expired");
  }

  // 2. Update lastUsedAt (best-effort — do not abort on failure)
  await prisma.refreshToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {
    // Best-effort: never let this block the response
  });

  // 3. Issue short-lived access token
  const accessToken = signAccessToken(row.userId, row.workspaceId);

  return { accessToken, expiresIn: 900 };
}
