import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { loginRoute } from "./routes/login";
import { registerRoute } from "./routes/register";
import { forgotPasswordRoute } from "./routes/forgot-password";
import { resetPasswordRoute } from "./routes/reset-password";
import { inviteRoute } from "./routes/invite";
import { authenticatedRoute } from "./routes/_authenticated";
import { workspaceSelectRoute } from "./routes/_authenticated/workspace-select";
import { projectSelectRoute } from "./routes/_authenticated/project-select";
import { inboxRoute } from "./routes/_authenticated/inbox";
import { issueRoute } from "./routes/_authenticated/issue";
import { dependenciesRoute } from "./routes/_authenticated/dependencies";
import { cyclesRoute, cyclesIndexRoute } from "./routes/_authenticated/cycles";
import { boardRoute } from "./routes/_authenticated/board";
import { profileRoute } from "./routes/_authenticated/profile";
import { roadmapRoute } from "./routes/_authenticated/roadmap";
import { settingsRoute } from "./routes/_authenticated/settings";

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  inviteRoute,
  authenticatedRoute.addChildren([
    workspaceSelectRoute,
    projectSelectRoute,
    inboxRoute,
    boardRoute,
    issueRoute,
    profileRoute,
    roadmapRoute,
    dependenciesRoute,
    cyclesRoute,
    cyclesIndexRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

// Type-safe router declaration
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
