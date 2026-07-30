import { createRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { authenticatedRoute } from "../_authenticated";
import { ProjectMembersSection } from "@/features/project-members/project-members-section";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "auto",
        background: "var(--bg)",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 720, width: "100%" }}>
        <h1
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--ink)",
            marginBottom: 24,
          }}
        >
          {t("projectSettings", { key: projectKey })}
        </h1>
        <ProjectMembersSection projectKey={projectKey} />
      </div>
    </div>
  );
}
