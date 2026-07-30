import { useTranslation } from "react-i18next";
import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authenticatedRoute } from "../_authenticated";
import { useActiveWorkspaceId, useWorkspacesQuery } from "@/hooks/use-workspace-query";
import { useWorkspaceMembersQuery } from "@/features/settings/use-settings-queries";
import { useAuthStore } from "@/stores/auth-store";
import { MembersSection } from "@/features/settings/members-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { DomainsSection } from "@/features/settings/domains-section";
import { NotificationPreferencesSection } from "@/features/settings/notification-preferences-section";

export const settingsRoute = createRoute({
  path: "/settings",
  getParentRoute: () => authenticatedRoute,
  component: SettingsPage,
});

type SettingsTab = "members" | "invites" | "domains" | "notifications";

const TAB_KEYS: { key: SettingsTab; labelKey: string }[] = [
  { key: "members", labelKey: "tabMembers" },
  { key: "invites", labelKey: "tabInvites" },
  { key: "domains", labelKey: "tabDomains" },
  { key: "notifications", labelKey: "tabNotifications" },
];

function SettingsPage() {
  const { t } = useTranslation("settings");
  const [activeTab, setActiveTab] = useState<SettingsTab>("members");
  const workspaceId = useActiveWorkspaceId();
  const { data: workspaces } = useWorkspacesQuery();
  const currentUser = useAuthStore((s) => s.user);
  const { data: members } = useWorkspaceMembersQuery(workspaceId);

  const workspace = workspaces?.[0];

  // Find current user's role in this workspace
  const currentUserRole = members?.find(
    (m) => m.user.email === currentUser?.email,
  )?.role;

  if (!workspaceId) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">{t("noWorkspace")}</p>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 28px 0",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {workspace?.name ?? t("workspaceFallback")}
          </h1>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            {t("workspaceSettingsSub")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
          {TAB_KEYS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 32,
                  padding: "0 12px",
                  borderBottom: active
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  marginBottom: -1,
                }}
              >
                {t(tab.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px 28px 28px",
        }}
      >
        <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 24 }}>
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
            />
          )}
          {activeTab === "domains" && (
            <DomainsSection
              workspaceId={workspaceId}
              currentUserRole={currentUserRole}
              allowedDomains={workspace?.allowedDomains ?? []}
            />
          )}
          {activeTab === "notifications" && (
            <NotificationPreferencesSection workspaceId={workspaceId} />
          )}
        </div>
      </div>
    </div>
  );
}
