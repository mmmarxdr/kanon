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

export const workSessionKeys = {
  all: ["work-sessions"] as const,
  lists: () => [...workSessionKeys.all, "list"] as const,
  list: (issueKey: string) =>
    [...workSessionKeys.lists(), issueKey] as const,
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

export const dashboardKeys = {
  all: ["dashboard"] as const,
  details: () => [...dashboardKeys.all, "detail"] as const,
  detail: (workspaceId: string | null) =>
    [...dashboardKeys.details(), workspaceId] as const,
};
