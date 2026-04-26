import type { IssueState } from "@prisma/client";

/**
 * Ordered issue states for the Kanon workflow.
 * Index determines forward/backward direction for regression detection.
 */
export const ORDERED_STATES: readonly IssueState[] = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

/**
 * Default token expiry durations.
 */
export const TOKEN_EXPIRY = {
  ACCESS: "15m",
  REFRESH: "7d",
} as const;

/**
 * Bcrypt cost factor for password hashing.
 */
export const BCRYPT_COST = 12;

/**
 * Issue types, priorities, and states as plain arrays for Zod enum usage.
 */
export const ISSUE_TYPES = ["feature", "bug", "task", "spike"] as const;
export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const ISSUE_STATES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;
export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export const ACTIVITY_ACTIONS = [
  "created",
  "state_changed",
  "assigned",
  "commented",
  "cycle_changed",
  "edited",
  "engram_synced",
] as const;
export const COMMENT_SOURCES = ["human", "mcp", "engram_sync", "system"] as const;
export const HORIZONS = ["now", "next", "later", "someday"] as const;
export const ROADMAP_STATUSES = ["idea", "planned", "in_progress", "done"] as const;
export const DEPENDENCY_TYPES = ["blocks"] as const;

/**
 * Cookie names for auth tokens.
 */
export const COOKIE_NAMES = {
  ACCESS: "kanon_at",
  REFRESH: "kanon_rt",
  CSRF: "kanon_csrf",
} as const;

/**
 * Cookie configuration with flags.
 * `secure` is determined at runtime based on NODE_ENV.
 */
export function getCookieConfig(isDev: boolean) {
  return {
    access: {
      httpOnly: true,
      secure: !isDev,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 900, // 15 minutes in seconds
    },
    refresh: {
      httpOnly: true,
      secure: !isDev,
      sameSite: "lax" as const,
      path: "/api/auth/refresh",
      maxAge: 604800, // 7 days in seconds
    },
    csrf: {
      httpOnly: false,
      secure: !isDev,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 604800, // 7 days in seconds
    },
  };
}
