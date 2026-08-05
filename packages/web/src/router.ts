import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { loginRoute } from "./routes/login";
import { registerRoute } from "./routes/register";
import { forgotPasswordRoute } from "./routes/forgot-password";
import { resetPasswordRoute } from "./routes/reset-password";
import { verifyEmailRoute } from "./routes/verify-email";
import { magicLinkRoute } from "./routes/magic-link";
import { inviteRoute } from "./routes/invite";
import { authenticatedRoute } from "./routes/_authenticated";
import { workspaceSelectRoute } from "./routes/_authenticated/workspace-select";
import { projectSelectRoute } from "./routes/_authenticated/project-select";
import { inboxRoute } from "./routes/_authenticated/inbox";
import { issueRoute } from "./routes/_authenticated/issue";
import { issueDocRoute } from "./routes/_authenticated/issue-doc";
import { dependenciesRoute } from "./routes/_authenticated/dependencies";
import { cyclesRoute, cyclesIndexRoute } from "./routes/_authenticated/cycles";
import { boardRoute } from "./routes/_authenticated/board";
import { profileRoute } from "./routes/_authenticated/profile";
import { roadmapRoute } from "./routes/_authenticated/roadmap";
import { scheduleTimelineRoute } from "./routes/_authenticated/schedule-timeline";
import { settingsRoute } from "./routes/_authenticated/settings";
import { projectSettingsRoute } from "./routes/_authenticated/project-settings";
import { setupRoute } from "./routes/setup";
import { adminInstanceRoute } from "./routes/_authenticated/admin.instance";
import { adminUsersRoute } from "./routes/_authenticated/admin.users";

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  verifyEmailRoute,
  magicLinkRoute,
  inviteRoute,
  setupRoute,
  authenticatedRoute.addChildren([
    workspaceSelectRoute,
    projectSelectRoute,
    inboxRoute,
    boardRoute,
    issueRoute,
    // issueDocRoute is a flat sibling (not nested under issueRoute) because
    // issueRoute renders a full issue-page layout component with no <Outlet/>.
    // Nesting would wrap the doc viewer inside the issue page layout, which is
    // not desired. Revisit if issueRoute is ever converted to a layout route.
    issueDocRoute,
    profileRoute,
    roadmapRoute,
    scheduleTimelineRoute,
    dependenciesRoute,
    cyclesRoute,
    cyclesIndexRoute,
    settingsRoute,
    projectSettingsRoute,
    adminInstanceRoute,
    adminUsersRoute,
  ]),
]);

export const router = createRouter({ routeTree });

// Type-safe router declaration
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
