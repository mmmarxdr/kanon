import { createRoute, lazyRouteComponent } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";

/**
 * Full-page document viewer route.
 * Path: /issue/:key/doc/:docId
 *
 * Renders a single design record (ADR/PDR/RFC/NOTE) with comfortable reading
 * width, metadata header, and a back-to-issue link.
 */
export const issueDocRoute = createRoute({
  path: "/issue/$key/doc/$docId",
  getParentRoute: () => authenticatedRoute,
  component: lazyRouteComponent(() => import("./issue-doc-page")),
});
