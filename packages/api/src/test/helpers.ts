/**
 * Test helpers for integration tests.
 * Provides app builder, authenticated request helpers, and DB cleanup.
 */
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import type { BuildAppOptions } from "../app.js";
import { prisma } from "../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../shared/constants.js";

/**
 * Build a fresh Fastify app instance for testing.
 * Caller is responsible for calling `app.close()` in afterAll/afterEach.
 * Pass opts.emailProvider to inject a spy provider (e.g. for 5.3c-style tests).
 */
export async function createTestApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(opts);
  await app.ready();
  return app;
}

/**
 * Generate a valid JWT access token for testing.
 * Token payload: { sub: userId, email }
 */
export function generateTestToken(overrides?: {
  userId?: string;
  email?: string;
}): string {
  const payload = {
    sub: overrides?.userId ?? randomUUID(),
    email: overrides?.email ?? `test-${randomUUID().slice(0, 8)}@kanon.test`,
  };

  return jwt.sign(payload, process.env["JWT_SECRET"]!, {
    expiresIn: "15m",
  });
}

/**
 * Generate a valid JWT refresh token for testing.
 * Token payload: { sub: userId, email }
 */
export function generateTestRefreshToken(overrides?: {
  userId?: string;
  email?: string;
}): string {
  const payload = {
    sub: overrides?.userId ?? randomUUID(),
    email: overrides?.email ?? `test-${randomUUID().slice(0, 8)}@kanon.test`,
  };

  return jwt.sign(payload, process.env["JWT_REFRESH_SECRET"]!, {
    expiresIn: "7d",
  });
}

/**
 * Create an authorization header object with a Bearer token.
 */
export function authHeader(token?: string): { authorization: string } {
  const t = token ?? generateTestToken();
  return { authorization: `Bearer ${t}` };
}

/**
 * Seed a test workspace and return its ID.
 */
export async function seedTestWorkspace(
  slug?: string,
): Promise<{ id: string; name: string; slug: string }> {
  const ws = await prisma.workspace.create({
    data: {
      name: "Test Workspace",
      slug: slug ?? `test-ws-${randomUUID().slice(0, 8)}`,
    },
  });
  return ws;
}

/**
 * Seed a test user + member in a workspace and return member + auth token.
 */
export async function seedTestMember(workspaceId: string, overrides?: {
  email?: string;
  username?: string;
}): Promise<{ id: string; email: string; token: string; userId: string }> {
  // Use bcrypt-compatible hash for "password123"
  // Pre-computed to avoid slow bcrypt in tests
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("password123", 4); // low cost for speed in tests

  const email = overrides?.email ?? `test-${randomUUID().slice(0, 8)}@kanon.test`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hash,
      displayName: overrides?.username ?? `user-${randomUUID().slice(0, 8)}`,
    },
  });

  const member = await prisma.member.create({
    data: {
      username: overrides?.username ?? `user-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      workspaceId,
    },
  });

  const token = generateTestToken({
    userId: user.id,
    email,
  });

  return { id: member.id, email, token, userId: user.id };
}

/**
 * Seed a test project in a workspace.
 */
export async function seedTestProject(
  workspaceId: string,
  key?: string,
): Promise<{ id: string; key: string }> {
  const projectKey = key ?? `T${randomUUID().slice(0, 3).toUpperCase()}`;
  const project = await prisma.project.create({
    data: {
      key: projectKey,
      name: "Test Project",
      workspaceId,
    },
  });
  return { id: project.id, key: project.key };
}

/**
 * Clean all test data from the database.
 * Deletes in reverse dependency order.
 * ProjectMember must come before project and member (FK constraints).
 * Also resets instance-layer state (KAN-49): clears setup_tokens and
 * nullifies the singleton ownerUserId so claim tests are hermetic.
 */
export async function cleanDatabase(): Promise<void> {
  await prisma.projectMember.deleteMany();
  await prisma.workSession.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.issueSubscription.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.mention.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  // PPM timesheet (KAN-100 PR3): delete adjustments before originals (self-FK)
  await prisma.timeEntry.deleteMany({ where: { adjustsId: { not: null } } });
  await prisma.timeEntry.deleteMany();
  // WorkLog depends on Issue (Cascade) — delete before issues for explicit ordering
  await prisma.workLog.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.roadmapItem.deleteMany();
  await prisma.cycle.deleteMany();
  await prisma.project.deleteMany();
  await prisma.workspaceInvite.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.member.deleteMany();
  // Must delete before users due to FK on createdById (KAN-49 PR1b)
  await prisma.instanceAdminInvite.deleteMany();
  // Delete users BEFORE resetting singleton so FK SET NULL fires cleanly
  // (ownerUserId FK → users.id; deleting user sets ownerUserId=NULL automatically,
  // but we explicitly reset after to ensure consistency regardless of FK behaviour).
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
  // Reset instance-layer state — setup_tokens have no FK to users, delete any
  await prisma.setupToken.deleteMany();
  // Re-assert singleton is present and reset with null owner (migration seed).
  // Use upsert in case a test somehow deleted the singleton row.
  await prisma.instanceSettings.upsert({
    where: { id: INSTANCE_SETTINGS_ID },
    update: { ownerUserId: null, instanceName: null, signupMode: "open", allowedSignupDomains: [] },
    create: { id: INSTANCE_SETTINGS_ID, signupMode: "open", allowedSignupDomains: [] },
  });
}

/**
 * Build a cookie header string for authenticated requests via cookies.
 * Includes kanon_at (access token) and optionally kanon_csrf.
 */
export function authCookies(
  token: string,
  csrfToken?: string,
): { cookie: string } {
  const parts = [`kanon_at=${token}`];
  if (csrfToken) {
    parts.push(`kanon_csrf=${csrfToken}`);
  }
  return { cookie: parts.join("; ") };
}

/**
 * Extract Set-Cookie values from a response.
 * Returns a map of cookie name → value.
 */
export function parseCookies(
  setCookieHeaders: string | string[] | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!setCookieHeaders) return result;
  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];
  for (const header of headers) {
    const match = header.match(/^([^=]+)=([^;]*)/);
    if (match) {
      result[match[1]!] = match[2]!;
    }
  }
  return result;
}

/**
 * Build a cookie string from a parsed cookies map.
 */
export function buildCookieString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Seed a test user + member with a specific role.
 */
export async function seedTestMemberWithRole(
  workspaceId: string,
  role: "owner" | "admin" | "pm" | "member" | "viewer",
  overrides?: { email?: string; username?: string },
): Promise<{ id: string; email: string; token: string; userId: string }> {
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("password123", 4);

  const email = overrides?.email ?? `test-${randomUUID().slice(0, 8)}@kanon.test`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hash,
      displayName: overrides?.username ?? `user-${randomUUID().slice(0, 8)}`,
    },
  });

  const member = await prisma.member.create({
    data: {
      username: overrides?.username ?? `user-${randomUUID().slice(0, 8)}`,
      role,
      userId: user.id,
      workspaceId,
    },
  });

  const token = generateTestToken({
    userId: user.id,
    email,
  });

  return { id: member.id, email, token, userId: user.id };
}

/**
 * Seed a ProjectMember row for a given user + project combination.
 * Used in PR2 tests to establish per-project membership before enforcement tests.
 */
export async function seedTestProjectMember(
  userId: string,
  projectId: string,
  role: "owner" | "admin" | "pm" | "member" | "viewer",
): Promise<{ id: string; userId: string; projectId: string; role: string }> {
  const pm = await prisma.projectMember.upsert({
    where: { userId_projectId: { userId, projectId } },
    update: { role },
    create: { userId, projectId, role },
  });
  return pm;
}

/**
 * Disconnect Prisma after all tests complete.
 */
export async function disconnectTestDb(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Seed a WorkLog row for integration tests.
 * Returns the WorkLog ID.
 */
export async function seedTestWorkLog(
  memberId: string,
  issueId: string,
  overrides?: {
    durationS?: number;
    startedAt?: Date;
    endedAt?: Date;
    via?: string;
  },
): Promise<{ id: string }> {
  const startedAt = overrides?.startedAt ?? new Date("2026-06-14T09:00:00.000Z");
  const endedAt = overrides?.endedAt ?? new Date("2026-06-14T11:00:00.000Z");
  const durationS = overrides?.durationS ?? 7200; // 2 hours

  return prisma.workLog.create({
    data: {
      memberId,
      issueId,
      startedAt,
      endedAt,
      durationS,
      via: overrides?.via ?? null,
    },
    select: { id: true },
  });
}

/**
 * Seed a user with isInstanceAdmin=true and return their auth token.
 *
 * Use this helper wherever HTTP POST /api/workspaces is called in tests,
 * so tests survive the requireInstanceAdmin guard added in PR1a (KAN-49).
 *
 * The user is NOT added to any workspace — instance-admin is a global flag.
 */
export async function seedInstanceAdminUser(overrides?: {
  email?: string;
}): Promise<{ userId: string; email: string; token: string }> {
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("password123", 4);

  const email = overrides?.email ?? `instance-admin-${randomUUID().slice(0, 8)}@kanon.test`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hash,
      displayName: "Instance Admin",
      isInstanceAdmin: true,
    },
  });

  const token = generateTestToken({ userId: user.id, email });

  return { userId: user.id, email, token };
}
