import { createRoute, redirect } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { useAuthStore } from "@/stores/auth-store";

export const indexRoute = createRoute({
  path: "/",
  getParentRoute: () => rootRoute,
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (isAuthenticated) {
      throw redirect({ to: "/workspaces" });
    }
    throw redirect({ to: "/login" });
  },
});
