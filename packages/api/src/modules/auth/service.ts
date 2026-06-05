import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import { BCRYPT_COST, TOKEN_EXPIRY } from "../../shared/constants.js";
import type { TokenPayload } from "../../shared/types.js";
import type { RegisterBody, LoginBody } from "./schema.js";
import type { EmailProvider } from "../../services/email/types.js";
import { buildVerifyEmail } from "../../services/email/templates/verify.js";
import { buildResetEmail } from "../../services/email/templates/reset.js";
import { ProjectAssignmentSchema } from "../invite/schema.js";
import { createProjectMembersInTx } from "../project/project-member-service.js";
import { acceptInvite, deriveUsername } from "../invite/service.js";
import { consumeInstanceAdminInvite } from "../instance/service.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";

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
 * When ids is non-empty, embeds an allowedProjectIds claim (project-scoping, KAN-19).
 */
export function signAccessToken(
  userId: string,
  workspaceId: string,
  ids?: string[],
): string {
  return jwt.sign(
    {
      sub: userId,
      workspace: workspaceId,
      scope: "access",
      ...(ids && ids.length > 0 ? { allowedProjectIds: ids } : {}),
    },
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
 *
 * When body.invite is present (R-NUI-autologin):
 *   1. Create user (committed).
 *   2. Call acceptInvite — which validates the invite (including email-match guard)
 *      and creates the Member row in its own transaction. If acceptInvite throws,
 *      the user is left with no workspace membership (same state as plain register).
 *   3. RE-READ user.emailVerifiedAt (ADR-1): if acceptInvite was targeted, it set
 *      emailVerifiedAt inside its tx. If null (link invite), send verification email.
 *   4. Sign tokens + return session shape (accessToken + refreshToken + user).
 *
 * Without invite (self-serve): create user, then send verification email.
 *   Atomicity (ADR-3): if emailProvider.send throws → delete user (cascade removes
 *   token) → rethrow 500. No partial state.
 *
 * Note: register-with-invite is non-atomic by design. A failed acceptInvite leaves a
 * committed user with no workspace membership. Callers can retry acceptInvite
 * separately. Deviation from design's "same tx" wording — acceptInvite owns its own
 * transaction and its signature cannot be changed in this slice.
 */
/**
 * Extract the domain from an email address (lowercase).
 * Returns empty string if the email is malformed.
 */
function extractEmailDomain(email: string): string {
  const parts = email.split("@");
  return (parts[1] ?? "").toLowerCase();
}

export async function register(
  body: RegisterBody,
  emailProvider: EmailProvider,
): Promise<{
  id: string;
  email: string;
  displayName: string | null;
  accessToken?: string;
  refreshToken?: string;
}> {
  // ── Signup policy gate (PR1b, KAN-49) ─────────────────────────────────────
  // Precedence: invite token present → bypass gate entirely (invite path handles auth).
  // Otherwise: read InstanceSettings and enforce signupMode + allowedSignupDomains.
  // Default state (open + empty allowlist) = allow-all → existing tests unaffected (B5 guard).
  if (!body.invite) {
    const settings = await prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { signupMode: true, allowedSignupDomains: true },
    });

    if (settings) {
      const { signupMode, allowedSignupDomains } = settings;

      if (signupMode === "closed") {
        throw new AppError(403, "SIGNUP_CLOSED", "Registrations are closed for this instance");
      }

      if (signupMode === "invite") {
        // invite mode without a token — body.invite is falsy
        throw new AppError(403, "INVITE_REQUIRED", "An invite is required to register");
      }

      // signupMode === "open": enforce domain allowlist if non-empty
      if (signupMode === "open" && allowedSignupDomains.length > 0) {
        const domain = extractEmailDomain(body.email);
        const allowed = allowedSignupDomains.some(
          (d) => d.toLowerCase() === domain,
        );
        if (!allowed) {
          throw new AppError(
            403,
            "DOMAIN_NOT_ALLOWED",
            "Your email domain is not permitted to register on this instance",
          );
        }
      }
      // open + empty allowlist → allow-all (no-op)
    }
  }
  // ── End signup policy gate ─────────────────────────────────────────────────

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

  // Auto-login path: accept invite + issue session
  if (body.invite) {
    // acceptInvite validates the invite (expiry, email-match, already-member) and
    // creates the Member row. Correct order: accept first (may throw 403/410) →
    // only then sign tokens. This avoids issuing a session if accept fails.
    await acceptInvite(body.invite, user.id, user.email);

    // ADR-1: re-read emailVerifiedAt to determine if targeted invite auto-verified the user.
    // acceptInvite sets emailVerifiedAt inside its own tx for targeted invites.
    // We cannot branch on invite.email here — it's not returned from acceptInvite.
    const freshUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { emailVerifiedAt: true },
    });

    if (freshUser.emailVerifiedAt === null) {
      // Link invite: not auto-verified → send verification email
      await sendVerificationEmail(user.id, user.email, emailProvider);
    }

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
    };
    const tokens = signTokens(payload);

    return { ...user, ...tokens };
  }

  // Self-serve path: send verification email (ADR-3 atomicity).
  // If send fails, delete the user (cascade removes the token row) and rethrow.
  try {
    await sendVerificationEmail(user.id, user.email, emailProvider);
  } catch (err) {
    // Roll back: delete the just-created user (FK cascade removes token row)
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {
      // Best-effort cleanup — ignore secondary errors
    });
    throw err;
  }

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

  // Null-guard: passwordless users (null passwordHash) cannot log in via password.
  // Treat identically to wrong password — no user enumeration.
  if (!user.passwordHash) {
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

  // Null-guard: passwordless users have no hash to verify against.
  // Reject with the same generic error as a wrong password.
  if (!user.passwordHash) {
    throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
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
 * Email verification token expiry duration (24 hours).
 */
const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a verification token for the given user and send a verification email.
 * Deletes any prior verification tokens for the user before creating a new one.
 *
 * Callers are responsible for atomicity: on email failure, the caller must
 * roll back the user row (ADR-3).
 */
export async function sendVerificationEmail(
  userId: string,
  email: string,
  emailProvider: EmailProvider,
): Promise<void> {
  // Delete all existing verification tokens for this user
  await prisma.emailVerificationToken.deleteMany({
    where: { userId },
  });

  // Generate token and hash for storage
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await prisma.emailVerificationToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS),
    },
  });

  const verifyUrl = `${env.APP_URL}/verify-email?token=${token}`;
  const verifyEmail = buildVerifyEmail({ verifyUrl });

  await emailProvider.send({
    to: email,
    subject: verifyEmail.subject,
    html: verifyEmail.html,
    text: verifyEmail.text,
  });
}

/**
 * Verify an email address using a single-use token.
 * Throws INVALID_VERIFICATION_TOKEN (400) if the token is invalid, expired, or already used.
 * Sets emailVerifiedAt and marks the token as used atomically.
 */
export async function verifyEmail(token: string): Promise<void> {
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const verifyToken = await prisma.emailVerificationToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!verifyToken) {
    throw new AppError(
      400,
      "INVALID_VERIFICATION_TOKEN",
      "Invalid or expired verification token",
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: verifyToken.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: verifyToken.id },
      data: { usedAt: new Date() },
    }),
    // Clean up any other tokens for this user (mirrors resetPassword tx, design §6).
    // sendVerificationEmail already deleteMany's before creating, so in practice
    // there is only one token, but we match the design spec for robustness.
    prisma.emailVerificationToken.deleteMany({
      where: {
        userId: verifyToken.userId,
        id: { not: verifyToken.id },
      },
    }),
  ]);
}

/**
 * Resend a verification email for the given user.
 * If the user is already verified, this is a no-op.
 * Always resolves without throwing (callers always return 200).
 */
export async function resendVerification(
  userId: string,
  email: string,
  emailProvider: EmailProvider,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });

  if (!user || user.emailVerifiedAt !== null) {
    // Already verified or user not found — no-op
    return;
  }

  await sendVerificationEmail(userId, email, emailProvider);
}

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
  const resetEmail = buildResetEmail({ resetUrl });

  await emailProvider.send({
    to: user.email,
    subject: resetEmail.subject,
    html: resetEmail.html,
    text: resetEmail.text,
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
 * Create-on-consume (R-NUI-cli-consume): atomically upserts the User (passwordless if
 * absent, reuses existing User if present), finds-or-creates the workspace Member
 * (role from invite), applies ProjectMember rows from invite's projectAssignments,
 * sets consumedAt, and issues the refresh token — all in one transaction.
 *
 * Atomic + idempotent:
 *   - If ANY step fails, the WHOLE tx rolls back — token NOT consumed, NO partial state.
 *   - consumedAt guard blocks replay on success.
 *   - Member find-or-create is idempotent (existing Member reused, no dup, no error).
 *
 * Email is always sourced from the invite row (admin-controlled at creation time).
 *
 * Error map:
 *   - 400 INVALID_TOKEN   — bad/wrong-scope JWT
 *   - 410 TOKEN_EXPIRED   — JWT exp in the past
 *   - 410 TOKEN_CONSUMED  — invite.consumedAt already set
 *   - 400 TOKEN_REVOKED   — invite.revokedAt set
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

  // 2a. Instance-admin onboard branch (PR1b, KAN-49).
  //     Runs BEFORE the workspace-member scope check so the generic "invalid scope" error
  //     is never reached for legitimate instance_onboard tokens.
  if (payload.scope === "instance_onboard") {
    return prisma.$transaction(async (tx) => {
      // Upsert user by email from the invite row (passwordless if absent,
      // reuse unchanged if present — mirrors workspace onboard upsert).
      // Email is admin-controlled — sourced from InstanceAdminInvite.email, not caller input.
      const invite = await (tx as typeof prisma).instanceAdminInvite.findUnique({
        where: { jwtSub: payload.sub },
        select: { email: true },
      });
      if (!invite) {
        throw new AppError(400, "INVALID_TOKEN", "Instance admin invite not found");
      }

      const user = await (tx as typeof prisma).user.upsert({
        where: { email: invite.email },
        create: { email: invite.email, passwordHash: null, emailVerifiedAt: new Date() },
        update: {},
        select: { id: true, email: true },
      });

      // consumeInstanceAdminInvite: verifies JWT again internally + grants isInstanceAdmin
      await consumeInstanceAdminInvite(tx, token, user.id);

      return { ok: true as const, email: user.email };
    });
  }

  // 2b. Assert scope=onboard (workspace-member path)
  if (payload.scope !== "onboard") {
    throw new AppError(400, "INVALID_TOKEN", "Invalid token scope");
  }

  const inviteId = payload.sub;

  return prisma.$transaction(async (tx) => {
    // 3. KAN-37: SELECT ... FOR UPDATE — acquires a row-level lock on the invite row.
    //    The second concurrent transaction blocks here until the first commits or rolls back.
    //    This is the same pattern used in acceptInvite() for the same class of race.
    //    Columns fetched must include everything needed for steps 4–10 below.
    const rows = await (tx as typeof prisma).$queryRaw<Array<{
      id: string;
      kind: string;
      email: string | null;
      workspace_id: string;
      role: string;
      project_assignments: unknown;
      revoked_at: Date | null;
      consumed_at: Date | null;
      expires_at: Date;
    }>>`
      SELECT id, kind, email, workspace_id, role, project_assignments, revoked_at, consumed_at, expires_at
      FROM workspace_invites
      WHERE id = ${inviteId}::uuid
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row || row.kind !== "ONBOARDING") {
      throw new AppError(400, "INVALID_TOKEN", "Onboarding invite not found");
    }

    // 4. Check invite status — all guards after the lock so the second concurrent
    //    transaction sees the committed state (consumedAt already set by first winner).
    if (row.revoked_at) {
      throw new AppError(400, "TOKEN_REVOKED", "Onboarding token has been revoked");
    }
    if (row.consumed_at) {
      throw new AppError(410, "TOKEN_CONSUMED", "Onboarding token has already been used");
    }
    // DB-level expiry check (defense-in-depth beyond JWT exp)
    if (row.expires_at < new Date()) {
      throw new AppError(410, "TOKEN_EXPIRED", "Onboarding token has expired");
    }

    // Fetch workspace details separately (not available from $queryRaw inline join).
    const workspace = await (tx as typeof prisma).workspace.findUniqueOrThrow({
      where: { id: row.workspace_id },
      select: { id: true, name: true, slug: true },
    });

    // 4b. Mark consumed — inside the locked tx so rollback reverts this.
    await (tx as typeof prisma).workspaceInvite.update({
      where: { id: inviteId },
      data: { consumedAt: new Date() },
    });

    // Email is admin-controlled — always sourced from the invite row, never from caller input.
    const email = row.email!;

    // 5. Upsert User by email (R-NUI-cli-consume, ADR-5):
    //    - Create passwordless (passwordHash: null) if absent → escape hatch via forgot-password
    //    - Set emailVerifiedAt on create (admin-vouched, R-EV-autoverify)
    //    - Reuse existing User unchanged if present (update: {} is a no-op)
    const user = await (tx as typeof prisma).user.upsert({
      where: { email },
      create: { email, passwordHash: null, emailVerifiedAt: new Date() },
      update: {},
      select: { id: true, email: true },
    });

    // 6. Find-or-create workspace Member with role from invite (idempotent).
    //    Do NOT throw on existing member — reuse it silently (contrast with acceptInvite).
    let existingMember = await (tx as typeof prisma).member.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: row.workspace_id } },
    });

    if (!existingMember) {
      // Derive a unique username within the workspace (ADR-6)
      const username = await deriveUsername(tx, row.workspace_id, email);
      existingMember = await (tx as typeof prisma).member.create({
        data: {
          username,
          role: row.role as import("@prisma/client").MemberRole,
          userId: user.id,
          workspaceId: row.workspace_id,
        },
      });
    }

    // 7. Parse project assignments BEFORE creating the RefreshToken row so
    //    allowedProjectIds is available at create time (KAN-19, design risk #1).
    // row.project_assignments is a raw JSON value — parse safely; null → [] (existing invites safe).
    const parsedAssignments = z.array(ProjectAssignmentSchema).safeParse(row.project_assignments);
    const assignments = parsedAssignments.success ? parsedAssignments.data : [];

    // 8. Apply project assignments (idempotent — skipDuplicates:true in createProjectMembersInTx).
    //    Must be BEFORE consumedAt update so a PM failure rolls back the whole tx.
    await createProjectMembersInTx(tx, user.id, assignments, row.workspace_id);

    // 9. Generate opaque refresh token and store its hash
    const rawToken = generateOpaqueToken();
    const tokenHash = sha256Hex(rawToken);
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const refreshTokenRow = await (tx as typeof prisma).refreshToken.create({
      data: {
        tokenHash,
        source: "ONBOARDING",
        userId: user.id,
        workspaceId: row.workspace_id,
        expiresAt: refreshExpiresAt,
        metadata: {},
        allowedProjectIds: assignments.map((a) => a.projectId),
      },
    });

    // consumedAt was set in step 4b (update inside the locked tx).
    // If any step above throws, the whole transaction rolls back and consumedAt reverts.

    return {
      refreshToken: rawToken,
      apiUrl: env.BASE_URL,
      workspace,
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
      allowedProjectIds: true,  // KAN-19: must be selected or claim is always-empty (design risk #2)
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

  // 3. Issue short-lived access token (KAN-19: pass allowedProjectIds for conditional claim)
  const accessToken = signAccessToken(row.userId, row.workspaceId, row.allowedProjectIds);

  return { accessToken, expiresIn: 900 };
}
