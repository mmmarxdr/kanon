import { createRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { authenticatedRoute } from "../_authenticated";
import { ProjectMembersSection } from "@/features/project-members/project-members-section";
import { SettingsShell } from "@/components/ui/settings-shell";

export const projectSettingsRoute = createRoute({
  path: "/project-settings/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: ProjectSettingsPage,
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});

function ProjectSettingsPage() {
  const { t } = useTranslation("settings");
  const { projectKey } = projectSettingsRoute.useParams();

  return (
    <SettingsShell title={t("projectSettings", { key: projectKey })}>
      <ProjectMembersSection projectKey={projectKey} />
    </SettingsShell>
  );
}
