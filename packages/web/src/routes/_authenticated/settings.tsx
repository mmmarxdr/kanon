import { useTranslation } from "react-i18next";
import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authenticatedRoute } from "../_authenticated";
import { useActiveWorkspaceId, useWorkspacesQuery } from "@/hooks/use-workspace-query";
import {
  useWorkspaceMembersQuery,
  type WorkspaceMember,
} from "@/features/settings/use-settings-queries";
import { MembersSection } from "@/features/settings/members-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { RedmineSection } from "@/features/settings/redmine-section";
import { ProjectsSection } from "@/features/settings/projects-section";
import { SettingsShell } from "@/components/ui/settings-shell";

const SETTINGS_TAB_ID_PREFIX = "settings";

export const settingsRoute = createRoute({
  path: "/settings",
  getParentRoute: () => authenticatedRoute,
  component: SettingsPage,
});

type SettingsTab = "members" | "invites" | "integrations" | "projects";

const TAB_KEYS: { key: SettingsTab; labelKey: string }[] = [
  { key: "members", labelKey: "tabMembers" },
  { key: "invites", labelKey: "tabInvites" },
  { key: "integrations", labelKey: "tabIntegrations" },
];

export function SettingsPage() {
  const { t } = useTranslation("settings");
  const workspaceId = useActiveWorkspaceId();
  const { data: workspaces } = useWorkspacesQuery();
  const { data: members } = useWorkspaceMembersQuery(workspaceId);

  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? workspaces?.[0];

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">{t("noWorkspace")}</p>
      </div>
    );
  }

  return (
    <WorkspaceSettings
      key={workspaceId}
      workspaceId={workspaceId}
      workspaceName={workspace?.name}
      allowedDomains={workspace?.allowedDomains ?? []}
      currentUserRole={workspace?.role ?? undefined}
      members={members}
    />
  );
}

function WorkspaceSettings({
  workspaceId,
  workspaceName,
  allowedDomains,
  currentUserRole,
  members,
}: {
  workspaceId: string;
  workspaceName: string | undefined;
  allowedDomains: string[];
  currentUserRole: string | undefined;
  members: WorkspaceMember[] | undefined;
}) {
  const { t } = useTranslation("settings");
  const [activeTab, setActiveTab] = useState<SettingsTab>("members");
  const tabs =
    currentUserRole === "owner"
      ? [...TAB_KEYS, { key: "projects" as const, labelKey: "tabProjects" }]
      : TAB_KEYS;

  return (
    <SettingsShell
      title={workspaceName ?? t("workspaceFallback")}
      eyebrow={t("workspaceSettingsSub")}
      maxWidth={activeTab === "integrations" ? "wide" : "default"}
      tabs={{
        idPrefix: SETTINGS_TAB_ID_PREFIX,
        tabs: tabs.map((tab) => ({
          key: tab.key,
          label: t(tab.labelKey),
        })),
        activeKey: activeTab,
        onChange: (key) => setActiveTab(key as SettingsTab),
      }}
      tabPanel={{
        id: `${SETTINGS_TAB_ID_PREFIX}-panel-${activeTab}`,
        ariaLabelledBy: `${SETTINGS_TAB_ID_PREFIX}-tab-${activeTab}`,
      }}
    >
      {activeTab === "members" && (
        <MembersSection
          workspaceId={workspaceId}
          currentUserRole={currentUserRole}
        />
      )}
      {activeTab === "invites" && (
        <InvitesSection
          workspaceId={workspaceId}
          currentUserRole={currentUserRole}
          allowedDomains={allowedDomains}
        />
      )}
      {activeTab === "integrations" && (
        <RedmineSection
          workspaceId={workspaceId}
          currentUserRole={currentUserRole}
          members={members}
        />
      )}
      {activeTab === "projects" && <ProjectsSection workspaceId={workspaceId} />}
    </SettingsShell>
  );
}
