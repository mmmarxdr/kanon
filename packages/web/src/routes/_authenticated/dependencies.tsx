import { useCallback } from "react";
import { createRoute, redirect, useNavigate } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { useRoadmapQuery } from "@/features/roadmap/use-roadmap-query";
import GraphView from "@/features/roadmap/graph/graph-view";

export const dependenciesRoute = createRoute({
  path: "/dependencies/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: DependenciesPage,
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});

function DependenciesPage() {
  const { projectKey } = dependenciesRoute.useParams();
  const navigate = useNavigate();
  const { data: items, isLoading, error } = useRoadmapQuery(projectKey);

  const handleSelectItem = useCallback(
    (id: string) => {
      // Roadmap items don't have keys yet — open the roadmap detail by id via
      // navigating to roadmap with the item search param.
      void navigate({
        to: "/roadmap/$projectKey",
        params: { projectKey },
        search: { item: id },
      });
    },
    [navigate, projectKey],
  );

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
        Loading graph…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--bad)",
          fontSize: 12,
        }}
      >
        Failed to load dependencies: {error.message}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg)",
      }}
    >
      <GraphView items={items ?? []} onSelectItem={handleSelectItem} />
    </div>
  );
}
