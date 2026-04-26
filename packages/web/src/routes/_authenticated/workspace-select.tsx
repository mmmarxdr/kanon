import { createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { authenticatedRoute } from "../_authenticated";
import { fetchApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { workspaceKeys } from "@/lib/query-keys";
import { Monogram } from "@/components/ui/icons";

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
  const didAutoRedirect = useRef(false);

  const workspacesQuery = useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => fetchApi<Workspace[]>("/api/workspaces"),
  });

  useEffect(() => {
    if (didAutoRedirect.current) return;
    if (!workspacesQuery.data) return;

    if (workspacesQuery.data.length === 1) {
      didAutoRedirect.current = true;
      const workspace = workspacesQuery.data[0]!;
      void fetchApi<Project[]>(`/api/workspaces/${workspace.id}/projects`).then(
        (projects) => {
          if (projects.length > 0) {
            void navigate({ to: "/inbox" });
          } else {
            void navigate({
              to: "/workspaces/$workspaceId/projects",
              params: { workspaceId: workspace.id },
            });
          }
        },
      );
    }
  }, [workspacesQuery.data, navigate]);

  if (
    workspacesQuery.isLoading ||
    (workspacesQuery.data?.length === 1 && !didAutoRedirect.current)
  ) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading workspace…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  function handleSelectWorkspace(workspace: Workspace) {
    void navigate({
      to: "/workspaces/$workspaceId/projects",
      params: { workspaceId: workspace.id },
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        padding: "32px 24px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 32,
        }}
      >
        <Monogram size={24} />
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          kanon
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => {
            useAuthStore.getState().logout();
            void navigate({ to: "/login" });
          }}
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          Sign out
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 440 }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--accent-ink)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pick a workspace
          </div>
          <h1
            style={{
              margin: "8px 0 0",
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
            }}
          >
            Where to today?
          </h1>
          {user && (
            <p
              style={{
                margin: "6px 0 24px",
                fontSize: 13,
                color: "var(--ink-3)",
              }}
            >
              Signed in as <span className="mono">{user.email}</span>
            </p>
          )}

          {workspacesQuery.error && (
            <div
              style={{
                padding: "8px 12px",
                background: "color-mix(in oklch, var(--bad) 12%, transparent)",
                border: "1px solid color-mix(in oklch, var(--bad) 40%, transparent)",
                borderRadius: 5,
                color: "var(--bad)",
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              Failed to load workspaces. Please try again.
            </div>
          )}

          {workspacesQuery.data && workspacesQuery.data.length === 0 && (
            <div
              style={{
                padding: 32,
                textAlign: "center",
                fontSize: 13,
                color: "var(--ink-3)",
                border: "1px dashed var(--line-2)",
                borderRadius: 6,
              }}
            >
              No workspaces found. You may need to be invited to a workspace.
            </div>
          )}

          {workspacesQuery.data && workspacesQuery.data.length > 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {workspacesQuery.data.map((ws) => {
                const initial =
                  ws.name.charAt(0).toUpperCase() || "?";
                return (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => handleSelectWorkspace(ws)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: 12,
                      textAlign: "left",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      background: "var(--panel)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.borderColor = "var(--accent)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.borderColor = "var(--line)")
                    }
                  >
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 7,
                        background:
                          "color-mix(in oklch, var(--accent) 22%, var(--bg-3))",
                        color: "var(--accent)",
                        fontSize: 14,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid var(--line)",
                        flexShrink: 0,
                      }}
                    >
                      {initial}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 8,
                        }}
                      >
                        <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                          {ws.name}
                        </span>
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: "var(--ink-4)" }}
                        >
                          {ws.slug}
                        </span>
                      </div>
                    </div>
                    <span style={{ fontSize: 16, color: "var(--ink-4)" }}>
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
