import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { CyclesView } from "@/features/cycles/cycles-view";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";
import { Icon } from "@/components/ui/icons";

export const cyclesRoute = createRoute({
  path: "/cycles/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: CyclesView,
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});

export const cyclesIndexRoute = createRoute({
  path: "/cycles",
  getParentRoute: () => authenticatedRoute,
  component: CyclesPickerPage,
});

function CyclesPickerPage() {
  const navigate = useNavigate();
  const workspaceId = useActiveWorkspaceId();
  const { data: projects, isLoading } = useProjectsQuery(workspaceId);

  if (isLoading) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        Loading projects…
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        <p>No projects in this workspace yet.</p>
      </div>
    );
  }

  if (projects.length === 1) {
    void navigate({
      to: "/cycles/$projectKey",
      params: { projectKey: projects[0]!.key },
      replace: true,
    });
    return null;
  }

  return (
    <div
      style={{
        height: "100%",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "20px 28px 14px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Cycles
        </div>
        <h1
          style={{
            margin: "6px 0 0",
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Pick a project
        </h1>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: "var(--ink-2)",
          }}
        >
          Cycles are scoped per project. Choose one to view its current cycle.
        </p>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 28px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 10,
            maxWidth: 880,
          }}
        >
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                void navigate({
                  to: "/cycles/$projectKey",
                  params: { projectKey: p.key },
                })
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                textAlign: "left",
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
                className="mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 28,
                  height: 28,
                  borderRadius: 5,
                  background: "color-mix(in oklch, var(--accent) 22%, transparent)",
                  color: "var(--accent)",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {p.key}
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
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </span>
                {p.description && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--ink-4)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.description}
                  </span>
                )}
              </div>
              <Icon.ChevR style={{ color: "var(--ink-4)" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
