import { useState } from "react";
import {
  useWorkspaceInvitesQuery,
  useCreateInviteMutation,
  useRevokeInviteMutation,
  type WorkspaceInvite,
} from "./use-settings-queries";

const INVITE_ROLES = ["viewer", "member", "admin"] as const;

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function isExpired(invite: WorkspaceInvite): boolean {
  return new Date(invite.expiresAt) < new Date();
}

function isExhausted(invite: WorkspaceInvite): boolean {
  return invite.maxUses > 0 && invite.useCount >= invite.maxUses;
}

function isActive(invite: WorkspaceInvite): boolean {
  return !invite.revokedAt && !isExpired(invite) && !isExhausted(invite);
}

function statusBadge(invite: WorkspaceInvite): { label: string; className: string } {
  if (invite.revokedAt) return { label: "Revoked", className: "bg-destructive/10 text-destructive" };
  if (isExpired(invite)) return { label: "Expired", className: "bg-muted text-muted-foreground" };
  if (isExhausted(invite)) return { label: "Exhausted", className: "bg-muted text-muted-foreground" };
  return { label: "Active", className: "bg-green-500/10 text-green-700" };
}

export function InvitesSection({
  workspaceId,
  currentUserRole,
}: {
  workspaceId: string;
  currentUserRole: string | undefined;
}) {
  const { data: invites, isLoading, error } = useWorkspaceInvitesQuery(workspaceId);
  const createInvite = useCreateInviteMutation(workspaceId);
  const revokeInvite = useRevokeInviteMutation(workspaceId);

  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState<string>("member");
  const [maxUses, setMaxUses] = useState<string>("0");
  const [expiresInHours, setExpiresInHours] = useState<string>("168");
  const [label, setLabel] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isAdmin = currentUserRole === "admin" || currentUserRole === "owner";

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createInvite.mutate(
      {
        role,
        maxUses: parseInt(maxUses, 10) || 0,
        expiresInHours: parseInt(expiresInHours, 10) || 168,
        label: label || undefined,
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setRole("member");
          setMaxUses("0");
          setExpiresInHours("168");
          setLabel("");
        },
      },
    );
  }

  function copyInviteLink(invite: WorkspaceInvite) {
    const url = `${window.location.origin}/invite/${invite.token}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Loading invites...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-destructive">
          Failed to load invites: {error.message}
        </p>
      </div>
    );
  }

  const activeInvites = (invites ?? []).filter(isActive);
  const inactiveInvites = (invites ?? []).filter((i) => !isActive(i));

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Invite Links</h2>
        {isAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {showForm ? "Cancel" : "Create Invite"}
          </button>
        )}
      </div>

      {/* Create invite form */}
      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 space-y-3 rounded-md border border-border p-4 bg-secondary/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-card-foreground">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full rounded-md border border-input bg-[#E8E8E8] px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-card-foreground">
                Max Uses <span className="text-muted-foreground">(0 = unlimited)</span>
              </label>
              <input
                type="number"
                min={0}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="w-full rounded-md border border-input bg-[#E8E8E8] px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-card-foreground">Expires in (hours)</label>
              <input
                type="number"
                min={1}
                max={720}
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                className="w-full rounded-md border border-input bg-[#E8E8E8] px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-card-foreground">Label (optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Team onboarding"
                className="w-full rounded-md border border-input bg-[#E8E8E8] px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
            </div>
          </div>

          {createInvite.isError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {createInvite.error.message}
            </div>
          )}

          <button
            type="submit"
            disabled={createInvite.isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
          >
            {createInvite.isPending ? "Creating..." : "Create Invite Link"}
          </button>
        </form>
      )}

      {/* Active invites */}
      {activeInvites.length === 0 && inactiveInvites.length === 0 && (
        <p className="text-sm text-muted-foreground">No invite links yet.</p>
      )}

      {activeInvites.length > 0 && (
        <div className="space-y-2 mb-4">
          {activeInvites.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              copiedId={copiedId}
              isAdmin={isAdmin}
              onCopy={copyInviteLink}
              onRevoke={(id) => revokeInvite.mutate(id)}
              revoking={revokeInvite.isPending}
            />
          ))}
        </div>
      )}

      {/* Inactive invites */}
      {inactiveInvites.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Inactive
          </p>
          <div className="space-y-2 opacity-60">
            {inactiveInvites.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                copiedId={copiedId}
                isAdmin={false}
                onCopy={copyInviteLink}
                onRevoke={() => {}}
                revoking={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InviteRow({
  invite,
  copiedId,
  isAdmin,
  onCopy,
  onRevoke,
  revoking,
}: {
  invite: WorkspaceInvite;
  copiedId: string | null;
  isAdmin: boolean;
  onCopy: (invite: WorkspaceInvite) => void;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  const status = statusBadge(invite);
  const active = isActive(invite);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md border border-border/50 bg-secondary/20">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">
            {invite.label || "Untitled invite"}
          </p>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${status.className}`}>
            {status.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {roleLabel(invite.role)}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <p className="text-xs text-muted-foreground">
            Uses: {invite.useCount}{invite.maxUses > 0 ? `/${invite.maxUses}` : "/\u221E"}
          </p>
          <p className="text-xs text-muted-foreground">
            Expires: {new Date(invite.expiresAt).toLocaleDateString()}
          </p>
          <p className="text-xs text-muted-foreground">
            By: {invite.createdBy.displayName ?? invite.createdBy.email}
          </p>
        </div>
      </div>

      {active && (
        <button
          onClick={() => onCopy(invite)}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
        >
          {copiedId === invite.id ? "Copied!" : "Copy Link"}
        </button>
      )}

      {active && isAdmin && (
        <button
          onClick={() => onRevoke(invite.id)}
          disabled={revoking}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors shrink-0 disabled:opacity-50"
        >
          Revoke
        </button>
      )}
    </div>
  );
}
