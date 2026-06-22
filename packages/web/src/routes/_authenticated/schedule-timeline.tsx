import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";

export const scheduleTimelineRoute = createRoute({
  path: "/schedule/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./schedule-timeline-page")),
});
