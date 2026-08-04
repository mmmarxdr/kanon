import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import {
  useWorkspaceInvitesQuery,
  useCreateInviteMutation,
  useRevokeInviteMutation,
  type WorkspaceInvite,
} from "./use-settings-queries";
import { SettingsCard } from "@/components/ui/settings-card";
import {
  SettingsList,
  SettingsListRow,
  INVITES_GRID,
  INVITES_GRID_MOBILE,
  invitesColumns,
} from "@/components/ui/settings-list";
import { InviteDomainRestriction } from "./invite-domain-restriction";

const INVITE_ROLES = ["viewer", "member", "admin"] as const;
type ProjectAccess = "workspace" | "all" | "selected";

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

function isExpired(invite: WorkspaceInvite): boolean {
  return new Date(invite.expiresAt) < new Date();
}

function isExhausted(invite: WorkspaceInvite): boolean {
  return invite.maxUses > 0 && invite.useCount >= invite.maxUses;
}

function isActive(invite: WorkspaceInvite): boolean {
  return !invite.revokedAt && !isExpired(invite) && !isExhausted(invite);
}

function statusBadge(
  invite: WorkspaceInvite,
  t: (key: string) => string,
): { label: string; className: string } {
  if (invite.revokedAt) return { label: t("inviteStatusRevoked"), className: "bg-destructive/10 text-destructive" };
  if (isExpired(invite)) return { label: t("inviteStatusExpired"), className: "bg-muted text-muted-foreground" };
  if (isExhausted(invite)) return { label: t("inviteStatusExhausted"), className: "bg-muted text-muted-foreground" };
  return { label: t("inviteStatusActive"), className: "bg-success/10 text-success" };
}

export function InvitesSection({
  workspaceId,
  currentUserRole,
  allowedDomains,
}: {
  workspaceId: string;
  currentUserRole: string | undefined;
  allowedDomains: string[];
}) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const { data: invites, isLoading, error } = useWorkspaceInvitesQuery(workspaceId);
  const { data: projects = [], isLoading: projectsLoading } = useProjectsQuery(workspaceId);
  const createInvite = useCreateInviteMutation(workspaceId);
  const revokeInvite = useRevokeInviteMutation(workspaceId);

  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState<string>("member");
  const [maxUses, setMaxUses] = useState<string>("0");
  const [expiresInHours, setExpiresInHours] = useState<string>("168");
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [projectAccess, setProjectAccess] = useState<ProjectAccess>("workspace");
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const isAdmin = currentUserRole === "admin" || currentUserRole === "owner";
  const listColumns = invitesColumns(t);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const projectIds = projectAccess === "all"
      ? projects.map((project) => project.id)
      : selectedProjectIds;

    createInvite.mutate(
      {
        role,
        maxUses: parseInt(maxUses, 10) || 0,
        expiresInHours: parseInt(expiresInHours, 10) || 168,
        label: label || undefined,
        email: email || undefined,
        projectAssignments: projectAccess === "workspace"
          ? undefined
          : projectIds.map((projectId) => ({ projectId, role })),
      },
      {
        onSuccess: () => {
          setShowForm(false);
          setRole("member");
          setMaxUses("0");
          setExpiresInHours("168");
          setLabel("");
          setEmail("");
          setProjectAccess("workspace");
          setSelectedProjectIds([]);
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
      <SettingsCard title={t("invitesTitle")}>
        <p className="text-sm text-muted-foreground">{t("invitesLoading")}</p>
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard title={t("invitesTitle")}>
        <p className="text-sm text-destructive">
          {t("invitesFailed", { message: error.message })}
        </p>
      </SettingsCard>
    );
  }

  const activeInvites = (invites ?? []).filter(isActive);
  const inactiveInvites = (invites ?? []).filter((i) => !isActive(i));

  const createButton = isAdmin ? (
    <button
      onClick={() => setShowForm(!showForm)}
      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      {showForm ? tCommon("actions.cancel") : t("invitesCreate")}
    </button>
  ) : undefined;

  return (
    <>
      <SettingsCard title={t("invitesTitle")} actions={createButton} insetList>
        {showForm && (
          <form onSubmit={handleCreate} className="mb-6 space-y-3 rounded-md border border-border p-4 bg-secondary/30">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-card-foreground">{t("invitesFieldRole")}</label>
                <div className="relative">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full appearance-none rounded-md border border-input bg-background px-2 py-1.5 pr-7 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                  >
                    {INVITE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r, t)}
                      </option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-card-foreground">
                  {t("invitesMaxUses")} <span className="text-muted-foreground">{t("invitesMaxUsesHint")}</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-card-foreground">{t("invitesFieldExpires")}</label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-card-foreground">{t("invitesFieldLabel")}</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={t("invitesLabelPlaceholder")}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-card-foreground">
                {t("invitesSendEmail")} <span className="text-muted-foreground">{tCommon("actions.optional")}</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("invitesEmailPlaceholder")}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-all duration-150 ease-out"
              />
              {email && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("invitesWillSendTo")} <span className="font-medium text-foreground">{email}</span>
                </p>
              )}
            </div>

            <fieldset className="space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-card-foreground">
                {t("invitesProjectAccess")}
              </legend>
              <select
                data-testid="invite-project-access"
                value={projectAccess}
                onChange={(e) => setProjectAccess(e.target.value as ProjectAccess)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              >
                <option value="workspace">{t("invitesAccessWorkspace")}</option>
                <option value="all" disabled={projectsLoading || projects.length === 0}>
                  {t("invitesAccessAll")}
                </option>
                <option value="selected" disabled={projectsLoading || projects.length === 0}>
                  {t("invitesAccessSelected")}
                </option>
              </select>
              <p className="text-xs text-muted-foreground">{t("invitesAccessHint")}</p>

              {projectAccess === "all" && (
                <p className="text-xs text-foreground">
                  {t("invitesAccessAllSummary", { count: projects.length })}
                </p>
              )}

              {projectAccess === "selected" && (
                <div className="max-h-40 space-y-1 overflow-auto rounded-md bg-background p-2">
                  {projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={(e) => setSelectedProjectIds((current) =>
                          e.target.checked
                            ? [...current, project.id]
                            : current.filter((id) => id !== project.id),
                        )}
                      />
                      {project.name} ({project.key})
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            {createInvite.isError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createInvite.error.message}
              </div>
            )}

            <button
              type="submit"
              disabled={createInvite.isPending || (projectAccess === "selected" && selectedProjectIds.length === 0)}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 ease-out"
            >
              {createInvite.isPending ? tCommon("actions.creating") : t("invitesCreateLink")}
            </button>
          </form>
        )}

        {activeInvites.length === 0 && inactiveInvites.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("invitesEmpty")}</p>
        )}

        {activeInvites.length > 0 && (
          <div className="mb-4">
          <SettingsList
            columns={listColumns}
            gridTemplateColumns={INVITES_GRID}
            mobileGridTemplateColumns={INVITES_GRID_MOBILE}
            data-testid="workspace-invites-list-active"
          >
            {activeInvites.map((invite) => (
              <InviteListRow
                key={invite.id}
                invite={invite}
                copiedId={copiedId}
                isAdmin={isAdmin}
                onCopy={copyInviteLink}
                onRevoke={(id) => revokeInvite.mutate(id)}
                revoking={revokeInvite.isPending}
              />
            ))}
          </SettingsList>
          </div>
        )}

        {inactiveInvites.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t("invitesInactive")}
            </p>
            <div className="opacity-60">
            <SettingsList
              columns={listColumns}
              gridTemplateColumns={INVITES_GRID}
              mobileGridTemplateColumns={INVITES_GRID_MOBILE}
              data-testid="workspace-invites-list-inactive"
            >
              {inactiveInvites.map((invite) => (
                <InviteListRow
                  key={invite.id}
                  invite={invite}
                  copiedId={copiedId}
                  isAdmin={false}
                  onCopy={copyInviteLink}
                  onRevoke={() => {}}
                  revoking={false}
                />
              ))}
            </SettingsList>
            </div>
          </div>
        )}
      </SettingsCard>

      <div className="mt-4">
        <InviteDomainRestriction
          workspaceId={workspaceId}
          currentUserRole={currentUserRole}
          allowedDomains={allowedDomains}
        />
      </div>
    </>
  );
}

function InviteListRow({
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
  const { t } = useTranslation("settings");
  const status = statusBadge(invite, t);
  const active = isActive(invite);
  const title = invite.label || t("invitesUntitled");
  const usesText = `${t("invitesUsesLabel")} ${invite.useCount}${invite.maxUses > 0 ? `/${invite.maxUses}` : "/\u221E"}`;
  const expiresText = `${t("invitesExpiresLabel")} ${new Date(invite.expiresAt).toLocaleDateString()}`;
  const byText = `${t("invitesByLabel")} ${invite.createdBy.displayName ?? invite.createdBy.email}`;

  return (
    <SettingsListRow
      label={title}
      columns={[
        <div key="label" className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{title}</p>
          <div className="sm:hidden flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${status.className}`}>
              {status.label}
            </span>
            <span className="text-xs text-muted-foreground">{roleLabel(invite.role, t)}</span>
            {invite.email && (
              <span className="text-xs text-muted-foreground truncate">{invite.email}</span>
            )}
            <span className="text-xs text-muted-foreground">{usesText}</span>
          </div>
        </div>,
        <span
          key="status"
          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium w-fit ${status.className}`}
        >
          {status.label}
        </span>,
        <span key="role" className="text-xs text-muted-foreground">
          {roleLabel(invite.role, t)}
        </span>,
        <span key="email" className="text-xs text-muted-foreground truncate">
          {invite.email ?? "—"}
        </span>,
        <span key="uses" className="text-xs text-muted-foreground">
          {usesText}
        </span>,
        <span key="expires" className="text-xs text-muted-foreground">
          {expiresText}
        </span>,
        <span key="createdBy" className="text-xs text-muted-foreground truncate">
          {byText}
        </span>,
        <div key="actions" className="flex items-center justify-end gap-1">
          {active && (
            <button
              type="button"
              onClick={() => onCopy(invite)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
            >
              {copiedId === invite.id ? t("invitesCopied") : t("invitesCopyLink")}
            </button>
          )}
          {active && isAdmin && (
            <button
              type="button"
              onClick={() => onRevoke(invite.id)}
              disabled={revoking}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors shrink-0 disabled:opacity-50"
            >
              {t("invitesRevoke")}
            </button>
          )}
        </div>,
      ]}
    />
  );
}
