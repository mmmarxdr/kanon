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
