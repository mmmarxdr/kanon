/**
 * /admin/users — Instance-admin user directory (KAN-224).
 */
import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { AdminUsersPage } from "@/features/admin-users/admin-users-page";

export const adminUsersRoute = createRoute({
  path: "/admin/users",
  getParentRoute: () => authenticatedRoute,
  component: AdminUsersPage,
});
