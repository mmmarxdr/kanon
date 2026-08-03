import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth-store";
import { SettingsCard } from "@/components/ui/settings-card";
import {
  SettingsList,
  SettingsListRow,
  PROJECT_MEMBERS_GRID,
  projectMembersColumns,
} from "@/components/ui/settings-list";
import { ApiError } from "@/lib/api-client";
import {
  useProjectMembersQuery,
  useAddProjectMemberMutation,
  useChangeProjectMemberRoleMutation,
  useRemoveProjectMemberMutation,
  type EffectiveMemberRow,
  type MemberRole,
} from "./use-project-members-queries";

// ── Constants ────────────────────────────────────────────────────────────────

// TODO(PR4): pm assignability UI (role dropdown + display) is deferred to PR4.
const ROLES_BASE: MemberRole[] = ["viewer", "member", "admin"];
const ROLES_WITH_OWNER: MemberRole[] = ["viewer", "member", "admin", "owner"];

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initials(row: EffectiveMemberRow): string {
  const name = row.displayName ?? row.email;
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ── Error code → friendly message ────────────────────────────────────────────

function friendlyAddError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "ALREADY_PROJECT_MEMBER":
        return "This user is already a member of the project.";
      case "NOT_WORKSPACE_MEMBER":
        return "This user is not a member of the workspace.";
      case "ROLE_CAP_EXCEEDED":
        return "You do not have permission to assign that role.";
      case "FORBIDDEN":
        return "You do not have permission to add members.";
      default:
        return err.message;
    }
  }
  return "An unexpected error occurred.";
}

function friendlyRemoveError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "LAST_OWNER":
        return "Cannot remove the last owner of the project.";
      case "FORBIDDEN":
        return "You do not have permission to remove this member.";
      default:
        return err.message;
    }
  }
  return "An unexpected error occurred.";
}

function friendlyChangeRoleError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "ROLE_CAP_EXCEEDED":
        return "Role cap exceeded — you cannot assign that role.";
      case "LAST_OWNER":
        return "Cannot demote the last owner of the project.";
      case "FORBIDDEN":
        return "You do not have permission to change this member's role.";
      default:
        return err.message;
    }
  }
  return "An unexpected error occurred while changing the role.";
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectMembersSection({
  projectKey,
}: {
  projectKey: string;
}) {
  const { t } = useTranslation("settings");
  const currentUser = useAuthStore((s) => s.user);
  const { data: members, isLoading, error } = useProjectMembersQuery(projectKey);
  const addMember = useAddProjectMemberMutation(projectKey);
  const changeRole = useChangeProjectMemberRoleMutation(projectKey);
  const removeMember = useRemoveProjectMemberMutation(projectKey);

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Add form state
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<MemberRole>("member");

  // Determine current user's effective role in this project
  const currentUserRow = members?.find((m) => m.userId === currentUser?.id);
  const currentUserRole = currentUserRow?.role;
  const isAdmin =
    currentUserRole === "admin" || currentUserRole === "owner";
  const isOwner = currentUserRole === "owner";

  const availableRoles = isOwner ? ROLES_WITH_OWNER : ROLES_BASE;
  const listColumns = projectMembersColumns(t);

  if (isLoading) {
    return (
      <SettingsCard>
        <p className="text-sm text-muted-foreground">Loading members...</p>
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard>
        <p className="text-sm text-destructive">
          Failed to load members: {error.message}
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <h2 className="text-lg font-semibold text-foreground mb-4">Members</h2>

      {/* Remove mutation error */}
      {removeMember.isError && (
        <div
          data-testid="remove-error"
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {friendlyRemoveError(removeMember.error)}
        </div>
      )}

      {/* Change-role mutation error */}
      {changeRole.isError && (
        <div
          data-testid="change-role-error"
          className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {friendlyChangeRoleError(changeRole.error)}
        </div>
      )}

      {/* Member list */}
      {!members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members found.</p>
      ) : (
        <div className="mb-6">
        <SettingsList
          columns={listColumns}
          gridTemplateColumns={PROJECT_MEMBERS_GRID}
          data-testid="project-members-list"
        >
          {members.map((member) => {
            const isCurrentUser = member.userId === currentUser?.id;
            const isExplicit = member.source === "project" && !!member.pmId;
            const isImplicit = member.source === "workspace" || !member.pmId;
            const isOwnerRow = member.role === "owner";
            const displayName = member.displayName ?? member.email;
            // Key for DOM: explicit rows use pmId, implicit use userId
            const rowKey = isExplicit ? member.pmId! : member.userId;

            return (
              <SettingsListRow
                key={rowKey}
                data-testid={`member-row-${rowKey}`}
                label={displayName}
                columns={[
                  <div key="member" className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                      {initials(member)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {displayName}
                        {isCurrentUser && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground truncate sm:hidden">
                        {member.email}
                      </p>
                    </div>
                  </div>,
                  <p key="email" className="text-sm text-muted-foreground truncate">
                    {member.email}
                  </p>,
                  isImplicit ? (
                    <span
                      key="role"
                      data-testid={`implicit-badge-${member.userId}`}
                      className="px-2 py-0.5 rounded text-xs font-medium bg-secondary text-muted-foreground shrink-0"
                    >
                      workspace {roleLabel(member.role)}
                    </span>
                  ) : isExplicit && isAdmin && !isCurrentUser && !isOwnerRow ? (
                    <div key="role" className="relative">
                      <select
                        value={member.role}
                        onChange={(e) => {
                          changeRole.mutate({
                            pmId: member.pmId!,
                            role: e.target.value as MemberRole,
                          });
                        }}
                        className="appearance-none rounded-md border border-input bg-background px-2 py-1 pr-7 text-xs text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                      >
                        {availableRoles.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
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
                      className="text-xs font-medium text-muted-foreground px-2 py-1 rounded-md bg-secondary shrink-0"
                    >
                      {roleLabel(member.role)}
                    </span>
                  ),
                  <div key="actions" className="flex items-center justify-end gap-1 flex-wrap">
                    {isExplicit && isAdmin && !isCurrentUser && !isOwnerRow && (
                      <>
                        {confirmRemoveId === member.pmId ? (
                          <div className="flex items-center gap-1">
                            <button
                              data-testid={`confirm-remove-${member.pmId}`}
                              onClick={() => {
                                removeMember.mutate(member.pmId!, {
                                  onSettled: () => setConfirmRemoveId(null),
                                });
                              }}
                              disabled={removeMember.isPending}
                              className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                            >
                              {removeMember.isPending ? "..." : "Confirm"}
                            </button>
                            <button
                              data-testid={`cancel-remove-${member.pmId}`}
                              onClick={() => setConfirmRemoveId(null)}
                              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            data-testid={`remove-btn-${member.pmId}`}
                            onClick={() => setConfirmRemoveId(member.pmId!)}
                            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                          >
                            Remove
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
        </div>
      )}

      {/* Add member form — admins only */}
      {isAdmin && (
        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">
            Add member
          </h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addMember.mutate(
                { email: addEmail, role: addRole },
                {
                  onSuccess: () => {
                    setAddEmail("");
                    setAddRole("member");
                    addMember.reset();
                  },
                },
              );
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-card-foreground">
                Email
              </label>
              <input
                data-testid="add-member-email"
                type="email"
                required
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-card-foreground">
                Role
              </label>
              <div className="relative">
              <select
                data-testid="add-member-role"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as MemberRole)}
                className="appearance-none rounded-md border border-input bg-background px-2 py-1.5 pr-7 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              >
                {availableRoles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>

            <button
              data-testid="add-member-submit"
              type="submit"
              disabled={addMember.isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {addMember.isPending ? "Adding..." : "Add"}
            </button>
          </form>

          {/* Inline add error */}
          {addMember.isError && (
            <div
              data-testid="add-member-error"
              className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {friendlyAddError(addMember.error)}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
