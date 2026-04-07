import { useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import {
  useWorkspaceMembersQuery,
  useRemoveMemberMutation,
  useChangeMemberRoleMutation,
  type WorkspaceMember,
} from "./use-settings-queries";

const ROLES = ["viewer", "member", "admin", "owner"] as const;

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
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
  const { data: members, isLoading, error } = useWorkspaceMembersQuery(workspaceId);
  const removeMember = useRemoveMemberMutation(workspaceId);
  const changeRole = useChangeMemberRoleMutation(workspaceId);
  const currentUser = useAuthStore((s) => s.user);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const isAdmin = currentUserRole === "admin" || currentUserRole === "owner";

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Loading members...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-destructive">
          Failed to load members: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-4">Members</h2>

      {!members || members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members found.</p>
      ) : (
        <div className="space-y-3">
          {members.map((member) => {
            const isCurrentUser = member.user.email === currentUser?.email;
            const isOwner = member.role === "owner";

            return (
              <div
                key={member.id}
                className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-secondary/50 transition-colors"
              >
                {/* Avatar */}
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

                {/* Name + Email */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {member.user.displayName ?? member.username}
                    {isCurrentUser && (
                      <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {member.user.email}
                  </p>
                </div>

                {/* Joined date */}
                <p className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                  Joined {new Date(member.createdAt).toLocaleDateString()}
                </p>

                {/* Role */}
                {isAdmin && !isOwner && !isCurrentUser ? (
                  <select
                    value={member.role}
                    onChange={(e) => {
                      changeRole.mutate({
                        memberId: member.id,
                        role: e.target.value,
                      });
                    }}
                    className="rounded-md border border-input bg-[#E8E8E8] px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                  >
                    {ROLES.filter((r) => r !== "owner").map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground px-2 py-1 rounded-md bg-secondary">
                    {roleLabel(member.role)}
                  </span>
                )}

                {/* Remove button */}
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
                          className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                        >
                          {removeMember.isPending ? "..." : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemoveId(member.id)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
