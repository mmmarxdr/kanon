import { useLocation } from "@tanstack/react-router";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";
import type { Project } from "@/types/project";

export function useCurrentProject(): {
  project: Project | undefined;
  projectKey: string;
  isLoading: boolean;
} {
  const location = useLocation();
  const workspaceId = useActiveWorkspaceId();
  const { data: projects, isLoading } = useProjectsQuery(workspaceId);

  // Extract projectKey from any project-scoped route.
  const projectKey =
    location.pathname.match(
      /^\/(board|roadmap|dependencies|cycles)\/([^/]+)/,
    )?.[2] ?? "";

  const project = projects?.find((p) => p.key === projectKey);

  return { project, projectKey, isLoading };
}
