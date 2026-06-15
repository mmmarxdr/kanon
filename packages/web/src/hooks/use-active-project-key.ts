/**
 * useActiveProjectKey — resolves the current project key from the route pathname.
 *
 * The command palette renders in _authenticated.tsx OUTSIDE any $projectKey route,
 * so useParams() is not available. This hook reuses the pathname-regex pattern from
 * app-topbar.tsx (ADR-5) and extends it to cover the /issue/:key route.
 *
 * Pattern (in priority order):
 *  1. /(board|roadmap|dependencies|cycles)/:projectKey → group 2 is the key
 *  2. /issue/:issueKey (e.g. /issue/KAN-42) → prefix before the first "-" is the key
 *  3. Everything else → null (no project context)
 *
 * The pure helper `getProjectKeyFromPath` is exported for unit testing without
 * needing React or a router context.
 */

import { useLocation } from "@tanstack/react-router";

/**
 * Pure helper — extract the active project key from a pathname string.
 * Returns null when there is no recognisable project context.
 */
export function getProjectKeyFromPath(pathname: string): string | null {
  // Pattern 1: standard project routes — reuse the exact regex from app-topbar.tsx
  const projectRouteMatch = pathname.match(
    /^\/(board|roadmap|dependencies|cycles)\/([^/]+)/,
  );
  if (projectRouteMatch && projectRouteMatch[2]) {
    return projectRouteMatch[2];
  }

  // Pattern 2: issue detail route — /issue/KAN-42 → "KAN"
  const issueRouteMatch = pathname.match(/^\/issue\/([A-Za-z][^-/]*(?:-[^-/]+)*)/);
  if (issueRouteMatch && issueRouteMatch[1]) {
    // The project key is everything before the final "-<number>" segment
    const issueKey = issueRouteMatch[1];
    const lastDashIdx = issueKey.lastIndexOf("-");
    if (lastDashIdx > 0) {
      return issueKey.slice(0, lastDashIdx);
    }
  }

  return null;
}

/**
 * Hook — reactive wrapper around getProjectKeyFromPath.
 * Returns the active project key, or null if no project context is detectable.
 */
export function useActiveProjectKey(): string | null {
  const location = useLocation();
  return getProjectKeyFromPath(location.pathname);
}
