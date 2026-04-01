import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { loginRoute } from "./routes/login";
import { registerRoute } from "./routes/register";
import { authenticatedRoute } from "./routes/_authenticated";
import { workspaceSelectRoute } from "./routes/_authenticated/workspace-select";
import { projectSelectRoute } from "./routes/_authenticated/project-select";
import { boardRoute } from "./routes/_authenticated/board";
import { backlogRoute } from "./routes/_authenticated/backlog";
import { profileRoute } from "./routes/_authenticated/profile";
import { roadmapRoute } from "./routes/_authenticated/roadmap";
import { settingsRoute } from "./routes/_authenticated/settings";

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  authenticatedRoute.addChildren([
    workspaceSelectRoute,
    projectSelectRoute,
    boardRoute,
    backlogRoute,
    profileRoute,
    roadmapRoute,
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
