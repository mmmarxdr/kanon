import { createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authenticatedRoute } from "../_authenticated";
import { fetchApi } from "@/lib/api-client";
import { projectKeys } from "@/lib/query-keys";
import type { Project } from "@/types/project";
import { useI18n } from "@/hooks/use-i18n";

export const projectSelectRoute = createRoute({
  path: "/workspaces/$workspaceId/projects",
  getParentRoute: () => authenticatedRoute,
  component: ProjectSelectPage,
});

function ProjectSelectPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { workspaceId } = projectSelectRoute.useParams();

  const projectsQuery = useQuery({
    queryKey: projectKeys.list(workspaceId),
    queryFn: () =>
      fetchApi<Project[]>(`/api/workspaces/${workspaceId}/projects`),
  });

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">
            {t("projectSelect.title")}
          </h1>
          <button
            onClick={() => void navigate({ to: "/workspaces" })}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("projectSelect.back")}
          </button>
        </div>

        {projectsQuery.isLoading && (
          <div className="py-8 text-center text-muted-foreground">
            {t("projectSelect.loading")}
          </div>
        )}

        {projectsQuery.error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("projectSelect.loadError")}
          </div>
        )}

        {projectsQuery.data && projectsQuery.data.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t("projectSelect.empty")}
          </div>
        )}

        {projectsQuery.data && projectsQuery.data.length > 0 && (
          <div className="space-y-2">
            {projectsQuery.data.map((project) => (
              <button
                key={project.id}
                onClick={() =>
                  void navigate({
                    to: "/board/$projectKey",
                    params: { projectKey: project.key },
                  })
                }
                className="w-full rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary hover:bg-accent shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-accent px-2 py-0.5 text-xs font-mono font-medium text-accent-foreground">
                    {project.key}
                  </span>
                  <span className="font-medium text-foreground">
                    {project.name}
                  </span>
                </div>
                {project.description && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {project.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
