/**
 * Test helpers for integration tests.
 * Provides app builder, authenticated request helpers, and DB cleanup.
 */
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { prisma } from "../config/prisma.js";

/**
 * Build a fresh Fastify app instance for testing.
 * Caller is responsible for calling `app.close()` in afterAll/afterEach.
 */
export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
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
 */
export async function cleanDatabase(): Promise<void> {
  await prisma.workSession.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.roadmapItem.deleteMany();
  await prisma.sprint.deleteMany();
  await prisma.project.deleteMany();
  await prisma.workspaceInvite.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.member.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
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
  role: "owner" | "admin" | "member" | "viewer",
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
 * Disconnect Prisma after all tests complete.
 */
export async function disconnectTestDb(): Promise<void> {
  await prisma.$disconnect();
}
