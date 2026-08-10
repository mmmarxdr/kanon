import { createRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { authenticatedRoute } from "../_authenticated";
import { fetchApi, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { workspaceKeys } from "@/lib/query-keys";
import { Monogram } from "@/components/ui/icons";
import { useCreateWorkspaceMutation } from "@/hooks/use-create-workspace-mutation";
import { useSetActiveWorkspace } from "@/hooks/use-workspace-query";
import { deriveSlug } from "@/lib/derive-slug";

export const workspaceSelectRoute = createRoute({
  path: "/workspaces",
  getParentRoute: () => authenticatedRoute,
  component: WorkspaceSelectPage,
});

// ---------------------------------------------------------------------------
// CreateWorkspaceForm — rendered in empty-state and when "New workspace" toggled
// ---------------------------------------------------------------------------

interface CreateWorkspaceFormProps {
  /** Called with the returned workspace id on successful creation. */
  onCreated: (workspaceId: string) => void;
}

export function CreateWorkspaceForm({ onCreated }: CreateWorkspaceFormProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);

  const createMutation = useCreateWorkspaceMutation();

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setName(value);
    if (!slugEdited) {
      setSlug(deriveSlug(value));
    }
    if (slugError) setSlugError(null);
  }

  function handleSlugChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSlug(e.target.value);
    setSlugEdited(true);
    if (slugError) setSlugError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    setSlugError(null);
    createMutation.mutate(
      { name: name.trim(), slug: slug.trim() },
      {
        onSuccess: (workspace) => {
          onCreated(workspace.id);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            setSlugError(
              "This slug is already taken — please change the slug and try again.",
            );
          }
        },
      },
    );
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    fontSize: 13,
    border: "1px solid var(--line)",
    borderRadius: 5,
    background: "var(--panel)",
    color: "var(--ink)",
    boxSizing: "border-box" as const,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--ink-3)",
    marginBottom: 4,
    letterSpacing: "0.02em",
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div>
        <label htmlFor="ws-name" style={labelStyle}>
          Workspace name
        </label>
        <input
          id="ws-name"
          type="text"
          aria-label="Workspace name"
          value={name}
          onChange={handleNameChange}
          placeholder="e.g. Acme Corp"
          style={inputStyle}
          autoFocus
        />
      </div>

      <div>
        <label htmlFor="ws-slug" style={labelStyle}>
          Slug
        </label>
        <input
          id="ws-slug"
          type="text"
          aria-label="Slug"
          value={slug}
          onChange={handleSlugChange}
          placeholder="e.g. acme-corp"
          style={{
            ...inputStyle,
            ...(slugError
              ? {
                  borderColor:
                    "color-mix(in oklch, var(--bad) 60%, transparent)",
                }
              : {}),
          }}
          className="mono"
        />
        {slugError && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--bad)",
            }}
          >
            {slugError}
          </p>
        )}
      </div>

      <button
        type="submit"
        data-testid="create-workspace-submit"
        disabled={createMutation.isPending || !name.trim() || !slug.trim()}
        style={{
          padding: "9px 16px",
          fontSize: 13,
          fontWeight: 500,
          background: "var(--accent)",
          color: "var(--accent-ink)",
          border: "none",
          borderRadius: 5,
          cursor: createMutation.isPending ? "wait" : "pointer",
          opacity: !name.trim() || !slug.trim() ? 0.5 : 1,
        }}
      >
        {createMutation.isPending ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /** Optional — only rendered when present; not currently returned by GET /api/workspaces */
  role?: string;
  /** Optional — only rendered when present; not currently returned by GET /api/workspaces */
  memberCount?: number;
}

interface Project {
  id: string;
  key: string;
  name: string;
  description: string | null;
}

export function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  // Workspace creation is instance-admin-only (KAN-49: POST /api/workspaces is
  // guarded by requireInstanceAdmin). Gate the create affordances on the same
  // flag so non-admins don't hit a 403 dead-end — they join via invite instead.
  const isInstanceAdmin = user?.isInstanceAdmin ?? false;
  const didAutoRedirect = useRef(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const setActiveWorkspace = useSetActiveWorkspace();

  const workspacesQuery = useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => fetchApi<Workspace[]>("/api/workspaces"),
  });

  useEffect(() => {
    if (didAutoRedirect.current) return;
    if (!workspacesQuery.data) return;

    if (workspacesQuery.data.length === 1 && !isInstanceAdmin) {
      didAutoRedirect.current = true;
      const workspace = workspacesQuery.data[0]!;
      setActiveWorkspace(workspace.id);
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
  }, [workspacesQuery.data, navigate, isInstanceAdmin, setActiveWorkspace]);

  if (
    workspacesQuery.isLoading ||
    (workspacesQuery.data?.length === 1 && !isInstanceAdmin && !didAutoRedirect.current)
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
    setActiveWorkspace(workspace.id);
    void navigate({
      to: "/workspaces/$workspaceId/projects",
      params: { workspaceId: workspace.id },
    });
  }

  function handleWorkspaceCreated(workspaceId: string) {
    // Set the ref BEFORE navigating so the auto-redirect effect (length===1)
    // cannot race and fire a second navigation when the list refetches.
    didAutoRedirect.current = true;
    setActiveWorkspace(workspaceId);
    void navigate({
      to: "/workspaces/$workspaceId/projects",
      params: { workspaceId },
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
        {isInstanceAdmin && workspacesQuery.data && workspacesQuery.data.length >= 1 && (
          <button
            type="button"
            aria-label="New workspace"
            onClick={() => setShowCreateForm((v) => !v)}
            style={{
              fontSize: 12,
              color: "var(--accent)",
              marginRight: 12,
              fontWeight: 500,
            }}
          >
            + New workspace
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void useAuthStore.getState().logout();
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
              data-testid="workspace-empty-state"
              style={{
                padding: 24,
                border: "1px solid var(--line)",
                borderRadius: 6,
                background: "var(--panel)",
              }}
            >
              {isInstanceAdmin ? (
                <>
                  <p
                    style={{
                      margin: "0 0 16px",
                      fontSize: 13,
                      color: "var(--ink-3)",
                    }}
                  >
                    Create your first workspace to get started.
                  </p>
                  <CreateWorkspaceForm onCreated={handleWorkspaceCreated} />
                </>
              ) : (
                <p
                  data-testid="workspace-no-membership"
                  style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}
                >
                  You're not a member of any workspace yet. Ask an instance
                  admin to invite you — they can send an invite from their
                  workspace settings.
                </p>
              )}
            </div>
          )}

          {showCreateForm && isInstanceAdmin && workspacesQuery.data && workspacesQuery.data.length >= 1 && (
            <div
              style={{
                padding: 24,
                border: "1px solid var(--line)",
                borderRadius: 6,
                background: "var(--panel)",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  New workspace
                </span>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  style={{ fontSize: 12, color: "var(--ink-3)" }}
                >
                  Cancel
                </button>
              </div>
              <CreateWorkspaceForm onCreated={handleWorkspaceCreated} />
            </div>
          )}

          {workspacesQuery.data && workspacesQuery.data.length >= 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {workspacesQuery.data.map((ws) => {
                const initial =
                  ws.name.charAt(0).toUpperCase() || "?";
                return (
                  <button
                    key={ws.id}
                    type="button"
                    data-testid={`workspace-item-${ws.slug}`}
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
                      {/* Role badge + member count — rendered only when the API provides them */}
                      {(ws.role !== undefined || ws.memberCount !== undefined) && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            fontSize: 11,
                            color: "var(--ink-3)",
                            marginTop: 1,
                          }}
                        >
                          {ws.memberCount !== undefined && (
                            <span>
                              {ws.memberCount}{" "}
                              {ws.memberCount === 1 ? "person" : "people"}
                            </span>
                          )}
                          {ws.memberCount !== undefined && ws.role !== undefined && (
                            <span style={{ color: "var(--ink-4)" }}>·</span>
                          )}
                          {ws.role !== undefined && (
                            <span
                              data-testid={`workspace-role-badge-${ws.slug}`}
                              className="mono"
                              style={{
                                padding: "1px 5px",
                                border: "1px solid var(--line-2)",
                                borderRadius: 3,
                                fontSize: 9.5,
                                color: "var(--ink-2)",
                              }}
                            >
                              {ws.role}
                            </span>
                          )}
                        </div>
                      )}
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
