import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import {
  useWorkspaceMembersQuery,
  useRemoveMemberMutation,
  useChangeMemberRoleMutation,
  useGenerateOnboardingInviteMutation,
  type WorkspaceMember,
  type OnboardingInviteResponse,
} from "./use-settings-queries";
import { SettingsCard } from "@/components/ui/settings-card";
import {
  SettingsList,
  SettingsListRow,
  WORKSPACE_MEMBERS_GRID,
  workspaceMembersColumns,
} from "@/components/ui/settings-list";
import { OnboardingLinkModal } from "./onboarding-link-modal";

const ROLES = ["viewer", "member", "admin", "owner"] as const;

const ROLE_KEYS: Record<string, string> = {
  viewer: "roleViewer",
  member: "roleMember",
  admin: "roleAdmin",
  owner: "roleOwner",
};

function roleLabel(role: string, t: (key: string) => string): string {
  const key = ROLE_KEYS[role];
  return key ? t(key) : role.charAt(0).toUpperCase() + role.slice(1);
}

function initials(member: WorkspaceMember): string {
  const name = member.user.displayName ?? member.user.email;
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function MembersSection({
  workspaceId,
  currentUserRole,
}: {
  workspaceId: string;
  currentUserRole: string | undefined;
}) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const { data: members, isLoading, error } = useWorkspaceMembersQuery(workspaceId);
  const removeMember = useRemoveMemberMutation(workspaceId);
  const changeRole = useChangeMemberRoleMutation(workspaceId);
  const generateOnboardingInvite = useGenerateOnboardingInviteMutation(workspaceId);
  const currentUser = useAuthStore((s) => s.user);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [onboardingModal, setOnboardingModal] = useState<OnboardingInviteResponse | null>(null);

  const isAdmin = currentUserRole === "admin" || currentUserRole === "owner";
  const listColumns = workspaceMembersColumns(t);

  if (isLoading) {
    return (
      <SettingsCard title={t("membersTitle")}>
        <p className="text-sm text-muted-foreground">{t("membersLoading")}</p>
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard title={t("membersTitle")}>
        <p className="text-sm text-destructive">
          {t("membersFailed", { message: error.message })}
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title={t("membersTitle")}>
      {!members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("membersEmpty")}</p>
      ) : (
        <SettingsList
          columns={listColumns}
          gridTemplateColumns={WORKSPACE_MEMBERS_GRID}
          data-testid="workspace-members-list"
        >
          {members.map((member) => {
            const isCurrentUser = member.user.email === currentUser?.email;
            const isOwner = member.role === "owner";
            const displayName = member.user.displayName ?? member.username;
            const joinedLabel = t("membersJoined", {
              date: new Date(member.createdAt).toLocaleDateString(),
            });

            return (
              <SettingsListRow
                key={member.id}
                label={displayName}
                columns={[
                  <div key="member" className="flex items-center gap-3 min-w-0">
                    {member.user.avatarUrl ? (
                      <img
                        src={member.user.avatarUrl}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                        {initials(member)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {displayName}
                        {isCurrentUser && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {t("membersYou")}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate sm:hidden">
                        {member.user.email}
                      </p>
                    </div>
                  </div>,
                  <p key="email" className="text-sm text-muted-foreground truncate">
                    {member.user.email}
                  </p>,
                  <p key="joined" className="text-xs text-muted-foreground">
                    {joinedLabel}
                  </p>,
                  isAdmin && !isOwner && !isCurrentUser ? (
                    <div key="role" className="relative">
                      <select
                        value={member.role}
                        onChange={(e) => {
                          changeRole.mutate({
                            memberId: member.id,
                            role: e.target.value,
                          });
                        }}
                        className="appearance-none rounded-md border border-input bg-background px-2 py-1 pr-7 text-xs text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                      >
                        {ROLES.filter((r) => r !== "owner").map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r, t)}
                          </option>
                        ))}
                      </select>
                      <svg
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  ) : (
                    <span
                      key="role"
                      className="text-xs font-medium text-muted-foreground px-2 py-1 rounded-md bg-secondary"
                    >
                      {roleLabel(member.role, t)}
                    </span>
                  ),
                  <div key="actions" className="flex items-center justify-end gap-1 flex-wrap">
                    {isAdmin && (
                      <button
                        data-testid={`onboarding-gen-btn-${member.id}`}
                        disabled={generateOnboardingInvite.isPending}
                        onClick={() => {
                          generateOnboardingInvite.mutate(
                            { userId: member.user.id },
                            {
                              onSuccess: (data) => {
                                setOnboardingModal(data);
                              },
                            },
                          );
                        }}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0 disabled:opacity-50"
                      >
                        {generateOnboardingInvite.isPending ? "..." : t("membersOnboard")}
                      </button>
                    )}
                    {isAdmin && !isOwner && !isCurrentUser && (
                      <>
                        {confirmRemoveId === member.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                removeMember.mutate(member.id, {
                                  onSettled: () => setConfirmRemoveId(null),
                                });
                              }}
                              disabled={removeMember.isPending}
                              className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                            >
                              {removeMember.isPending ? "..." : tCommon("actions.confirm")}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveId(null)}
                              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                            >
                              {tCommon("actions.cancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRemoveId(member.id)}
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                          >
                            {t("membersRemove")}
                          </button>
                        )}
                      </>
                    )}
                  </div>,
                ]}
              />
            );
          })}
        </SettingsList>
      )}

      {onboardingModal && (
        <OnboardingLinkModal
          open={true}
          onClose={() => setOnboardingModal(null)}
          url={onboardingModal.url}
          expiresAt={onboardingModal.expiresAt}
        />
      )}
    </SettingsCard>
  );
}
