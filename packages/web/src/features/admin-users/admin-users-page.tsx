import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/auth-store";
import { ApiError } from "@/lib/api-client";
import { SettingsShell } from "@/components/ui/settings-shell";
import { SettingsCard } from "@/components/ui/settings-card";
import {
  SettingsList,
  SettingsListRow,
  type SettingsListColumn,
} from "@/components/ui/settings-list";
import { SETTINGS_INPUT_CLASS } from "@/components/ui/settings-field";
import {
  useAddAdminMembershipMutation,
  useAdminUserDetailQuery,
  useAdminUsersBulkMutation,
  useAdminUsersQuery,
  useAdminWorkspaceProjectsQuery,
  useAdminWorkspacesQuery,
  usePatchAdminMembershipMutation,
  useRemoveAdminMembershipMutation,
  useReplaceAdminProjectsMutation,
  useVerifyAdminUserEmailMutation,
  type AdminMembership,
  type AdminUserListItem,
} from "./use-admin-users";

const PAGE_SIZE = 20;
const ROLES = ["viewer", "member", "pm", "admin", "owner"] as const;

const USERS_GRID = "auto minmax(0,2fr) minmax(0,1.2fr) auto auto auto";
const USERS_GRID_MOBILE = "auto minmax(0,1fr) auto";

function usersColumns(t: (key: string) => string): SettingsListColumn[] {
  return [
    { key: "select", label: "" },
    { key: "email", label: t("colEmail") },
    { key: "name", label: t("colName"), hideBelow: "sm" },
    { key: "verified", label: t("colVerified") },
    { key: "workspaces", label: t("colWorkspaces"), hideBelow: "sm" },
    { key: "created", label: t("colCreated"), hideBelow: "sm" },
  ];
}

function MembershipEditor({
  userId,
  membership,
}: {
  userId: string;
  membership: AdminMembership;
}) {
  const { t } = useTranslation("admin");
  const [role, setRole] = useState(membership.role);
  const [projectAccess, setProjectAccess] = useState(membership.projectAccess);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    membership.projects.map((p) => p.projectId),
  );

  const patch = usePatchAdminMembershipMutation(userId);
  const remove = useRemoveAdminMembershipMutation(userId);
  const replaceProjects = useReplaceAdminProjectsMutation(userId);
  const projectsQuery = useAdminWorkspaceProjectsQuery(
    projectAccess === "assigned" ? membership.workspaceId : null,
  );

  useEffect(() => {
    setRole(membership.role);
    setProjectAccess(membership.projectAccess);
    setSelectedProjectIds(membership.projects.map((p) => p.projectId));
  }, [membership]);

  return (
    <div
      data-testid={`membership-${membership.memberId}`}
      className="rounded-md border border-border px-3 py-3 flex flex-col gap-3"
    >
      <div className="text-sm font-medium">{membership.workspaceName}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("role")}
          <select
            className={SETTINGS_INPUT_CLASS}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            data-testid={`membership-role-${membership.memberId}`}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("projectAccess")}
          <select
            className={SETTINGS_INPUT_CLASS}
            value={projectAccess}
            onChange={(e) =>
              setProjectAccess(e.target.value as "workspace" | "assigned")
            }
            data-testid={`membership-access-${membership.memberId}`}
          >
            <option value="workspace">{t("accessWorkspace")}</option>
            <option value="assigned">{t("accessAssigned")}</option>
          </select>
        </label>
      </div>

      {projectAccess === "assigned" && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">{t("projects")}</div>
          {projectsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("loading")}</p>
          ) : !projectsQuery.data?.length ? (
            <p className="text-xs text-muted-foreground">{t("noAssignedProjects")}</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-40 overflow-auto">
              {projectsQuery.data.map((p) => {
                const checked = selectedProjectIds.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedProjectIds((prev) =>
                          checked
                            ? prev.filter((id) => id !== p.id)
                            : [...prev, p.id],
                        );
                      }}
                    />
                    <span>
                      {p.key} — {p.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="self-start rounded-md border border-border px-3 py-1.5 text-xs"
            disabled={replaceProjects.isPending}
            onClick={() => {
              replaceProjects.mutate({
                memberId: membership.memberId,
                projects: selectedProjectIds.map((projectId) => ({
                  projectId,
                  role: "member",
                })),
              });
            }}
          >
            {t("saveProjects")}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          disabled={patch.isPending}
          onClick={() =>
            patch.mutate({
              memberId: membership.memberId,
              role,
              projectAccess,
            })
          }
        >
          {t("saveMembership")}
        </button>
        <button
          type="button"
          className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive disabled:opacity-50"
          disabled={remove.isPending}
          onClick={() => remove.mutate(membership.memberId)}
        >
          {t("removeMembership")}
        </button>
      </div>
    </div>
  );
}

function UserDetailPanel({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  const detail = useAdminUserDetailQuery(userId);
  const verify = useVerifyAdminUserEmailMutation();
  const workspaces = useAdminWorkspacesQuery(true);
  const addMembership = useAddAdminMembershipMutation(userId);
  const [addWorkspaceId, setAddWorkspaceId] = useState("");
  const [addRole, setAddRole] = useState<string>("member");
  const [addAccess, setAddAccess] = useState<"workspace" | "assigned">("assigned");

  if (detail.isLoading) {
    return (
      <SettingsCard title={t("detailTitle")} testId="admin-user-detail">
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </SettingsCard>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <SettingsCard title={t("detailTitle")} testId="admin-user-detail">
        <p className="text-sm text-destructive">
          {t("failed", { message: detail.error?.message ?? "error" })}
        </p>
      </SettingsCard>
    );
  }

  const user = detail.data;

  return (
    <SettingsCard title={t("detailTitle")} testId="admin-user-detail">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{user.email}</div>
            <div className="text-xs text-muted-foreground">
              {user.displayName ?? "—"}
            </div>
            {user.isInstanceAdmin && (
              <div className="mt-1 text-xs text-muted-foreground">
                {t("instanceAdminBadge")}
              </div>
            )}
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={onClose}
          >
            {t("detailClose")}
          </button>
        </div>

        {user.emailVerified ? (
          <p className="text-sm text-muted-foreground">{t("alreadyVerified")}</p>
        ) : (
          <button
            type="button"
            data-testid="verify-email-btn"
            className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={verify.isPending}
            onClick={() => verify.mutate(userId)}
          >
            {t("verifyEmail")}
          </button>
        )}

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{t("memberships")}</div>
          {user.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMemberships")}</p>
          ) : (
            user.memberships.map((m) => (
              <MembershipEditor key={m.memberId} userId={userId} membership={m} />
            ))
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="text-sm font-medium">{t("addMembership")}</div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("selectWorkspace")}
            <select
              className={SETTINGS_INPUT_CLASS}
              value={addWorkspaceId}
              onChange={(e) => setAddWorkspaceId(e.target.value)}
              data-testid="add-membership-workspace"
            >
              <option value="">—</option>
              {workspaces.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              className={SETTINGS_INPUT_CLASS}
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              className={SETTINGS_INPUT_CLASS}
              value={addAccess}
              onChange={(e) =>
                setAddAccess(e.target.value as "workspace" | "assigned")
              }
            >
              <option value="workspace">{t("accessWorkspace")}</option>
              <option value="assigned">{t("accessAssigned")}</option>
            </select>
          </div>
          <button
            type="button"
            data-testid="add-membership-btn"
            className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            disabled={!addWorkspaceId || addMembership.isPending}
            onClick={() => {
              addMembership.mutate(
                {
                  workspaceId: addWorkspaceId,
                  role: addRole,
                  projectAccess: addAccess,
                },
                { onSuccess: () => setAddWorkspaceId("") },
              );
            }}
          >
            {t("add")}
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}

export function AdminUsersPage() {
  const { t } = useTranslation("admin");
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isInstanceAdmin = user?.isInstanceAdmin ?? false;

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState<"all" | "true" | "false">(
    "all",
  );
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<"verify_email" | "remove_from_workspace" | null>(
    null,
  );
  const [bulkWorkspaceId, setBulkWorkspaceId] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQ(q);
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    if (user && !isInstanceAdmin) {
      void navigate({ to: "/" });
    }
  }, [user, isInstanceAdmin, navigate]);

  const verified =
    verifiedFilter === "all" ? undefined : verifiedFilter === "true";

  const listQuery = useAdminUsersQuery({
    q: debouncedQ,
    verified,
    offset,
    limit: PAGE_SIZE,
    enabled: isInstanceAdmin,
  });

  const workspaces = useAdminWorkspacesQuery(isInstanceAdmin && bulkMode === "remove_from_workspace");
  const bulk = useAdminUsersBulkMutation();
  const columns = useMemo(() => usersColumns(t), [t]);

  if (!isInstanceAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground" data-testid="admin-users-forbidden">
        {t("forbiddenRedirect")}
      </div>
    );
  }

  const users = listQuery.data?.users ?? [];
  const total = listQuery.data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  function toggleAll(rows: AdminUserListItem[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = rows.every((u) => next.has(u.id));
      for (const u of rows) {
        if (allSelected) next.delete(u.id);
        else next.add(u.id);
      }
      return next;
    });
  }

  async function applyBulk() {
    if (!bulkMode || selected.size === 0) return;
    await bulk.mutateAsync({
      action: bulkMode,
      userIds: [...selected],
      workspaceId:
        bulkMode === "remove_from_workspace" ? bulkWorkspaceId : undefined,
    });
    setSelected(new Set());
    setBulkMode(null);
    setBulkWorkspaceId("");
  }

  return (
    <SettingsShell title={t("usersTitle")} eyebrow={t("usersEyebrow")} maxWidth="wide">
      <SettingsCard testId="admin-users-page">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              data-testid="admin-users-search"
              className={`${SETTINGS_INPUT_CLASS} sm:max-w-sm`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchPlaceholder")}
            />
            <select
              data-testid="admin-users-verified-filter"
              className={`${SETTINGS_INPUT_CLASS} sm:max-w-[180px]`}
              value={verifiedFilter}
              onChange={(e) => {
                setVerifiedFilter(e.target.value as "all" | "true" | "false");
                setOffset(0);
              }}
            >
              <option value="all">{t("filterAll")}</option>
              <option value="true">{t("filterVerified")}</option>
              <option value="false">{t("filterUnverified")}</option>
            </select>
          </div>

          {selected.size > 0 && (
            <div
              data-testid="admin-users-bulk-bar"
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <span className="text-xs text-muted-foreground">
                {t("selected", { count: selected.size })}
              </span>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs"
                onClick={() => setBulkMode("verify_email")}
              >
                {t("bulkVerify")}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs"
                onClick={() => setBulkMode("remove_from_workspace")}
              >
                {t("bulkRemove")}
              </button>
              {bulkMode && (
                <>
                  {bulkMode === "remove_from_workspace" && (
                    <select
                      data-testid="bulk-workspace-select"
                      className={`${SETTINGS_INPUT_CLASS} max-w-[220px]`}
                      value={bulkWorkspaceId}
                      onChange={(e) => setBulkWorkspaceId(e.target.value)}
                    >
                      <option value="">{t("bulkWorkspace")}</option>
                      {workspaces.data?.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    data-testid="bulk-apply"
                    className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                    disabled={
                      bulk.isPending ||
                      (bulkMode === "remove_from_workspace" && !bulkWorkspaceId)
                    }
                    onClick={() => {
                      void applyBulk().catch((err: unknown) => {
                        if (!(err instanceof ApiError)) return;
                      });
                    }}
                  >
                    {t("bulkApply")}
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground"
                    onClick={() => {
                      setBulkMode(null);
                      setBulkWorkspaceId("");
                    }}
                  >
                    {t("bulkCancel")}
                  </button>
                </>
              )}
            </div>
          )}

          {listQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : listQuery.error ? (
            <p className="text-sm text-destructive">
              {t("failed", { message: listQuery.error.message })}
            </p>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <SettingsList
              columns={columns}
              gridTemplateColumns={USERS_GRID}
              mobileGridTemplateColumns={USERS_GRID_MOBILE}
              data-testid="admin-users-list"
            >
              <SettingsListRow
                label="select-all"
                columns={[
                  <input
                    key="all"
                    type="checkbox"
                    aria-label="select all"
                    checked={users.every((u) => selected.has(u.id))}
                    onChange={() => toggleAll(users)}
                  />,
                  <span key="h" className="text-xs text-muted-foreground">
                    —
                  </span>,
                  <span key="n" />,
                  <span key="v" />,
                  <span key="w" />,
                  <span key="c" />,
                ]}
              />
              {users.map((u) => (
                <SettingsListRow
                  key={u.id}
                  data-testid={`admin-user-row-${u.id}`}
                  label={u.email}
                  className={
                    selectedUserId === u.id ? "bg-muted/40 cursor-pointer" : "cursor-pointer"
                  }
                  columns={[
                    <input
                      key="sel"
                      type="checkbox"
                      checked={selected.has(u.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />,
                    <button
                      key="email"
                      type="button"
                      className="text-left text-sm truncate"
                      onClick={() => setSelectedUserId(u.id)}
                    >
                      {u.email}
                    </button>,
                    <span key="name" className="text-sm truncate">
                      {u.displayName ?? "—"}
                    </span>,
                    <span key="ver" className="text-sm">
                      {u.emailVerified ? t("verifiedYes") : t("verifiedNo")}
                    </span>,
                    <span key="ws" className="text-sm">
                      {u.workspaceCount}
                    </span>,
                    <span key="created" className="text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </span>,
                  ]}
                />
              ))}
            </SettingsList>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {t("pageOf", { from, to, total })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              >
                {t("prev")}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
              >
                {t("next")}
              </button>
            </div>
          </div>
        </div>
      </SettingsCard>

      {selectedUserId && (
        <UserDetailPanel
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </SettingsShell>
  );
}
