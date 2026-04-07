import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authenticatedRoute } from "../_authenticated";
import { useActiveWorkspaceId, useWorkspacesQuery } from "@/hooks/use-workspace-query";
import { useWorkspaceMembersQuery } from "@/features/settings/use-settings-queries";
import { useAuthStore } from "@/stores/auth-store";
import { MembersSection } from "@/features/settings/members-section";
import { InvitesSection } from "@/features/settings/invites-section";
import { DomainsSection } from "@/features/settings/domains-section";

export const settingsRoute = createRoute({
  path: "/settings",
  getParentRoute: () => authenticatedRoute,
  component: SettingsPage,
});

type SettingsTab = "members" | "invites" | "domains";

const TABS: { key: SettingsTab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites" },
  { key: "domains", label: "Allowed Domains" },
];

function SettingsPage() {
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
        <p className="text-muted-foreground">No workspace selected.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wider mb-1">
            Workspace Settings
          </p>
          <h1 className="text-2xl font-bold text-foreground">
            {workspace?.name ?? "Settings"}
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-border">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "text-foreground border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
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
      </div>
    </div>
  );
}
