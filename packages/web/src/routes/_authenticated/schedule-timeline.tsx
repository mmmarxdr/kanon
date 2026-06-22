import { createRoute, redirect, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";

export const scheduleTimelineRoute = createRoute({
  path: "/schedule/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./schedule-timeline-page")),
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});
