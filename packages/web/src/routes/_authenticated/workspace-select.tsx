import { createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authenticatedRoute } from "../_authenticated";
import { fetchApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { workspaceKeys } from "@/lib/query-keys";
import { useI18n } from "@/hooks/use-i18n";

export const workspaceSelectRoute = createRoute({
  path: "/workspaces",
  getParentRoute: () => authenticatedRoute,
  component: WorkspaceSelectPage,
});

interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

function WorkspaceSelectPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const didAutoRedirect = useRef(false);

  const workspacesQuery = useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => fetchApi<Workspace[]>("/api/workspaces"),
  });

  // Auto-redirect: if user has exactly one workspace, skip the picker
  // and go straight to its first project (or project list)
  useEffect(() => {
    if (didAutoRedirect.current) return;
    if (!workspacesQuery.data) return;

    if (workspacesQuery.data.length === 1) {
      didAutoRedirect.current = true;
      const workspace = workspacesQuery.data[0]!;
      // Fetch projects for this workspace, then redirect to the first project's board
      void fetchApi<Project[]>(`/api/workspaces/${workspace.id}/projects`).then(
        (projects) => {
          const firstProject = projects[0];
          if (firstProject) {
            void navigate({
              to: "/board/$projectKey",
              params: { projectKey: firstProject.key },
            });
          } else {
            // No projects yet — go to project selection
            void navigate({
              to: "/workspaces/$workspaceId/projects",
              params: { workspaceId: workspace.id },
            });
          }
        },
      );
    }
  }, [workspacesQuery.data, navigate]);

  // While auto-redirecting, show a loading state instead of the picker
  if (
    workspacesQuery.isLoading ||
    (workspacesQuery.data?.length === 1 && !didAutoRedirect.current)
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">{t("workspaceSelect.loading")}</p>
        </div>
      </div>
    );
  }

  function handleSelectWorkspace(workspace: Workspace) {
    // Navigate to project list for this workspace
    void navigate({
      to: "/workspaces/$workspaceId/projects",
      params: { workspaceId: workspace.id },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">
            {t("workspaceSelect.title")}
          </h1>
          <button
            onClick={() => {
              useAuthStore.getState().logout();
              void navigate({ to: "/login" });
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("workspaceSelect.signOut")}
          </button>
        </div>

        {user && (
          <p className="mb-4 text-sm text-muted-foreground">
            {t("workspaceSelect.signedInAs")} {user.email}
          </p>
        )}

        {workspacesQuery.error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("workspaceSelect.loadError")}
          </div>
        )}

        {workspacesQuery.data && workspacesQuery.data.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            {t("workspaceSelect.empty")}
          </div>
        )}

        {workspacesQuery.data && workspacesQuery.data.length > 1 && (
          <div className="space-y-2">
            {workspacesQuery.data.map((ws) => (
              <button
                key={ws.id}
                onClick={() => handleSelectWorkspace(ws)}
                className="w-full rounded-md border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary hover:bg-accent shadow-sm"
              >
                <div className="font-medium text-foreground">{ws.name}</div>
                <div className="text-sm text-muted-foreground">{ws.slug}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
