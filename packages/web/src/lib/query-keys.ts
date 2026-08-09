/**
 * Centralized query key factory for TanStack Query cache management.
 *
 * Convention: each entity has a `.all` base key, a `.lists()` key for
 * collection queries, and a `.detail(id)` key for single-entity queries.
 * Using a factory ensures consistent keys across hooks and mutations
 * (for invalidation, optimistic updates, etc.).
 */

export const issueKeys = {
  all: ["issues"] as const,
  lists: () => [...issueKeys.all, "list"] as const,
  list: (projectKey: string) => [...issueKeys.lists(), projectKey] as const,
  backlogs: () => [...issueKeys.all, "backlog"] as const,
  backlog: (projectKey: string) =>
    [...issueKeys.backlogs(), projectKey] as const,
  details: () => [...issueKeys.all, "detail"] as const,
  detail: (key: string) => [...issueKeys.details(), key] as const,
  groups: (projectKey: string) =>
    [...issueKeys.all, "groups", projectKey] as const,
  groupIssues: (projectKey: string, groupKey: string) =>
    [...issueKeys.all, "group-issues", projectKey, groupKey] as const,
  context: (key: string) => [...issueKeys.all, "context", key] as const,
  /**
   * Nested under `.all` (not `.detail`) so SSE `issue.updated` events that
   * invalidate `issueKeys.all` automatically refresh the documents tab.
   * Shape: ["issues", "documents", issueKey]
   */
  documents: (issueKey: string) =>
    [...issueKeys.all, "documents", issueKey] as const,
  /**
   * KAN-111: Palette server search key — nested under `.all` so SSE
   * `issue.updated` invalidations automatically refresh search results.
   * Distinct from `.list` so palette search never collides with board full-list.
   * Shape: ["issues", "search", projectKey, q, filters]
   */
  search: (projectKey: string, q: string, filters: object) =>
    [...issueKeys.all, "search", projectKey, q, filters] as const,
};

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (workspaceId: string) =>
    [...projectKeys.lists(), workspaceId] as const,
  details: () => [...projectKeys.all, "detail"] as const,
  detail: (key: string) => [...projectKeys.details(), key] as const,
};

export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  list: () => [...workspaceKeys.lists()] as const,
};

export const commentKeys = {
  all: ["comments"] as const,
  lists: () => [...commentKeys.all, "list"] as const,
  list: (issueKey: string) => [...commentKeys.lists(), issueKey] as const,
};

export const memberKeys = {
  all: ["members"] as const,
  lists: () => [...memberKeys.all, "list"] as const,
  list: (workspaceId: string) =>
    [...memberKeys.lists(), workspaceId] as const,
};

export const inviteKeys = {
  all: ["invites"] as const,
  lists: () => [...inviteKeys.all, "list"] as const,
  list: (workspaceId: string) =>
    [...inviteKeys.lists(), workspaceId] as const,
};

export const activityKeys = {
  all: ["activity"] as const,
  lists: () => [...activityKeys.all, "list"] as const,
  list: (issueKey: string) => [...activityKeys.lists(), issueKey] as const,
};

export const roadmapKeys = {
  all: ["roadmap"] as const,
  lists: () => [...roadmapKeys.all, "list"] as const,
  list: (projectKey: string) => [...roadmapKeys.lists(), projectKey] as const,
  details: () => [...roadmapKeys.all, "detail"] as const,
  detail: (id: string) => [...roadmapKeys.details(), id] as const,
  dependencies: (itemId: string) =>
    [...roadmapKeys.all, "dependencies", itemId] as const,
};

export const cycleKeys = {
  all: ["cycles"] as const,
  lists: () => [...cycleKeys.all, "list"] as const,
  list: (projectKey: string) => [...cycleKeys.lists(), projectKey] as const,
  details: () => [...cycleKeys.all, "detail"] as const,
  detail: (cycleId: string) => [...cycleKeys.details(), cycleId] as const,
};

export const proposalKeys = {
  all: ["proposals"] as const,
  lists: () => [...proposalKeys.all, "list"] as const,
  list: (workspaceId: string | null) =>
    [...proposalKeys.lists(), workspaceId] as const,
  pending: (workspaceId: string | null) =>
    [...proposalKeys.all, "pending", workspaceId] as const,
};

export const projectMemberKeys = {
  all: ["project-members"] as const,
  lists: () => [...projectMemberKeys.all, "list"] as const,
  list: (projectKey: string) =>
    [...projectMemberKeys.lists(), projectKey] as const,
};

export const dashboardKeys = {
  all: ["dashboard"] as const,
  details: () => [...dashboardKeys.all, "detail"] as const,
  detail: (workspaceId: string | null) =>
    [...dashboardKeys.details(), workspaceId] as const,
};

export const notificationKeys = {
  all: ["notifications"] as const,
  lists: () => [...notificationKeys.all, "list"] as const,
  list: (workspaceId: string) =>
    [...notificationKeys.lists(), workspaceId] as const,
};

export const notificationPreferenceKeys = {
  all: ["notification-preferences"] as const,
  details: () => [...notificationPreferenceKeys.all, "detail"] as const,
  detail: (workspaceId: string) =>
    [...notificationPreferenceKeys.details(), workspaceId] as const,
};

export const integrationKeys = {
  all: ["integrations"] as const,
  connection: (workspaceId: string) =>
    [...integrationKeys.all, "connection", workspaceId] as const,
  discovery: (workspaceId: string, connectionId: string) =>
    [...integrationKeys.all, "discovery", workspaceId, connectionId] as const,
};

export const scheduleKeys = {
  all: ["schedules"] as const,
  details: () => [...scheduleKeys.all, "detail"] as const,
  detail: (issueKey: string) => [...scheduleKeys.details(), issueKey] as const,
};

/**
 * Query keys for the schedule-timeline endpoint (KAN-105 PR1).
 * Nested under "schedule-timeline" to avoid collision with per-issue scheduleKeys.
 */
export const scheduleTimelineKeys = {
  all: ["schedule-timeline"] as const,
  projects: () => [...scheduleTimelineKeys.all, "project"] as const,
  project: (projectKey: string) =>
    [...scheduleTimelineKeys.projects(), projectKey] as const,
};

export const adminUserKeys = {
  all: ["admin-users"] as const,
  lists: () => [...adminUserKeys.all, "list"] as const,
  list: (params: { q: string; verified?: boolean; offset: number; limit: number }) =>
    [...adminUserKeys.lists(), params] as const,
  details: () => [...adminUserKeys.all, "detail"] as const,
  detail: (userId: string) => [...adminUserKeys.details(), userId] as const,
  workspaces: () => [...adminUserKeys.all, "workspaces"] as const,
  workspaceProjects: (workspaceId: string) =>
    [...adminUserKeys.all, "workspace-projects", workspaceId] as const,
};
