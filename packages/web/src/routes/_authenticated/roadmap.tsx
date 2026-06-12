import { createRoute, redirect, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";

interface RoadmapSearchParams {
  item?: string;
}

export const roadmapRoute = createRoute({
  path: "/roadmap/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./roadmap-page")),
  validateSearch: (search: Record<string, unknown>): RoadmapSearchParams => ({
    item: typeof search.item === "string" ? search.item : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});
