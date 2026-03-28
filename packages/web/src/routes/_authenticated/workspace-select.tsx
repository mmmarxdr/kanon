import { createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { authenticatedRoute } from "../_authenticated";
import { fetchApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

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
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => fetchApi<Workspace[]>("/api/workspaces"),
  });

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
            Select Workspace
          </h1>
          <button
            onClick={() => {
              useAuthStore.getState().logout();
              void navigate({ to: "/login" });
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </div>

        {user && (
          <p className="mb-4 text-sm text-muted-foreground">
            Signed in as {user.email}
          </p>
        )}

        {workspacesQuery.isLoading && (
          <div className="py-8 text-center text-muted-foreground">
            Loading workspaces...
          </div>
        )}

        {workspacesQuery.error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Failed to load workspaces. Please try again.
          </div>
        )}

        {workspacesQuery.data && workspacesQuery.data.length === 0 && (
          <div className="py-8 text-center text-muted-foreground">
            No workspaces found. You may need to be invited to a workspace.
          </div>
        )}

        {workspacesQuery.data && workspacesQuery.data.length > 0 && (
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
