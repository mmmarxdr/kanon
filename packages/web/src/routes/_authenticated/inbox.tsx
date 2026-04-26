import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { InboxView } from "@/features/inbox/inbox-view";

export const inboxRoute = createRoute({
  path: "/inbox",
  getParentRoute: () => authenticatedRoute,
  component: InboxView,
});
