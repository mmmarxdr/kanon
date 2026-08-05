import { useEffect, useState, type ReactNode } from "react";
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
  useAdminUsersBulkMutation,
  useAdminUsersQuery,
  useAdminWorkspacesQuery,
  type AdminUserListItem,
} from "./use-admin-users";
import { UserDetailPanel } from "./user-detail-panel";

const PAGE_SIZE = 20;

/**
 * Fixed tracks (not `auto`): each SettingsList row is its own grid, so `auto`
 * columns size independently and headers drift away from cells.
 */
const USERS_GRID = "2rem minmax(0,2.2fr) minmax(0,1.2fr) 5.5rem minmax(0,1.4fr) 6rem";
const USERS_GRID_MOBILE = "2rem minmax(0,1fr) 4.5rem";

function usersColumns(
  t: (key: string) => string,
  selectAll: ReactNode,
): SettingsListColumn[] {
  return [
    { key: "select", label: selectAll },
    { key: "email", label: t("colEmail") },
    { key: "name", label: t("colName"), hideBelow: "sm" },
    { key: "verified", label: t("colVerified") },
    { key: "workspaces", label: t("colWorkspaces"), hideBelow: "sm" },
    { key: "created", label: t("colCreated"), hideBelow: "sm" },
  ];
}

function sharedWorkspacesForSelection(
  selectedWorkspaces: Map<string, Array<{ id: string; name: string }>>,
): Array<{ id: string; name: string }> {
  const lists = [...selectedWorkspaces.values()];
  if (lists.length === 0) return [];

  const counts = new Map<string, { name: string; hits: number }>();
  for (const workspaces of lists) {
    for (const ws of workspaces) {
      const prev = counts.get(ws.id);
      if (prev) prev.hits += 1;
      else counts.set(ws.id, { name: ws.name, hits: 1 });
    }
  }

  return [...counts.entries()]
    .filter(([, v]) => v.hits === lists.length)
    .map(([id, v]) => ({ id, name: v.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  /** Workspace memberships for selected users (survives pagination). */
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<
    Map<string, Array<{ id: string; name: string }>>
  >(new Map());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState<"verify_email" | "remove_from_workspace" | null>(
    null,
  );
  const [bulkWorkspaceId, setBulkWorkspaceId] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);

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

  const bulk = useAdminUsersBulkMutation();
  // Keep catalog warm for add-membership in detail; bulk remove uses selection intersection.
  useAdminWorkspacesQuery(isInstanceAdmin);

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
  const pageSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const sharedWorkspaces = sharedWorkspacesForSelection(selectedWorkspaces);
  const selectedWorkspaceName =
    sharedWorkspaces.find((w) => w.id === bulkWorkspaceId)?.name ?? "";

  function clearBulkUi() {
    setBulkMode(null);
    setBulkWorkspaceId("");
    setBulkError(null);
  }

  function toggleUser(u: AdminUserListItem) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.add(u.id);
      return next;
    });
    setSelectedWorkspaces((prev) => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, u.workspaces ?? []);
      return next;
    });
    clearBulkUi();
  }

  function toggleAll(rows: AdminUserListItem[]) {
    const allSelected = rows.every((u) => selected.has(u.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const u of rows) {
        if (allSelected) next.delete(u.id);
        else next.add(u.id);
      }
      return next;
    });
    setSelectedWorkspaces((prev) => {
      const next = new Map(prev);
      for (const u of rows) {
        if (allSelected) next.delete(u.id);
        else next.set(u.id, u.workspaces ?? []);
      }
      return next;
    });
    clearBulkUi();
  }

  async function applyBulk() {
    if (!bulkMode || selected.size === 0) return;
    setBulkError(null);
    try {
      const result = await bulk.mutateAsync({
        action: bulkMode,
        userIds: [...selected],
        workspaceId:
          bulkMode === "remove_from_workspace" ? bulkWorkspaceId : undefined,
      });
      const failed = result.results.filter((r) => !r.ok);
      const succeeded = result.results.filter((r) => r.ok).map((r) => r.userId);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of succeeded) next.delete(id);
        return next;
      });
      setSelectedWorkspaces((prev) => {
        const next = new Map(prev);
        for (const id of succeeded) next.delete(id);
        return next;
      });
      if (failed.length === 0) {
        clearBulkUi();
      } else {
        setBulkError(
          t("bulkPartialFailed", {
            failed: failed.length,
            total: result.results.length,
          }),
        );
      }
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : "Bulk request failed");
    }
  }

  const columns = usersColumns(
    t,
    <input
      type="checkbox"
      aria-label={t("selectAllPage")}
      data-testid="admin-users-select-all"
      checked={pageSelected}
      onChange={() => toggleAll(users)}
    />,
  );

  return (
    <SettingsShell title={t("usersTitle")} eyebrow={t("usersEyebrow")} maxWidth="wide">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] xl:items-start">
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
              className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("selected", { count: selected.size })}
                </span>
                <button
                  type="button"
                  data-testid="bulk-verify-btn"
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
                  onClick={() => {
                    setBulkMode("verify_email");
                    setBulkWorkspaceId("");
                    setBulkError(null);
                  }}
                >
                  {t("bulkVerify")}
                </button>
                <button
                  type="button"
                  data-testid="bulk-remove-btn"
                  className="rounded-md border border-border px-3 py-1.5 text-xs"
                  onClick={() => {
                    setBulkMode("remove_from_workspace");
                    setBulkWorkspaceId("");
                    setBulkError(null);
                  }}
                >
                  {t("bulkRemove")}
                </button>
              </div>

              {bulkMode === "verify_email" && (
                <div
                  data-testid="bulk-verify-panel"
                  className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-3"
                >
                  <p className="text-sm">
                    {t("bulkVerifyConfirm", { count: selected.size })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="bulk-apply"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      disabled={bulk.isPending}
                      onClick={() => {
                        void applyBulk();
                      }}
                    >
                      {t("bulkApply")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
                      onClick={() => {
                        setBulkMode(null);
                        setBulkError(null);
                      }}
                    >
                      {t("bulkCancel")}
                    </button>
                  </div>
                </div>
              )}

              {bulkMode === "remove_from_workspace" && (
                <div
                  data-testid="bulk-remove-panel"
                  className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">{t("bulkRemoveTitle")}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("bulkRemoveHelp")}
                    </p>
                  </div>

                  {sharedWorkspaces.length === 0 ? (
                    <p
                      data-testid="bulk-no-shared-workspaces"
                      className="text-sm text-destructive"
                    >
                      {t("bulkNoSharedWorkspaces")}
                    </p>
                  ) : (
                    <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                      {t("bulkWorkspace")}
                      <select
                        data-testid="bulk-workspace-select"
                        className={SETTINGS_INPUT_CLASS}
                        value={bulkWorkspaceId}
                        onChange={(e) => setBulkWorkspaceId(e.target.value)}
                      >
                        <option value="">{t("bulkWorkspacePlaceholder")}</option>
                        {sharedWorkspaces.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {bulkWorkspaceId && selectedWorkspaceName && (
                    <p className="text-sm" data-testid="bulk-remove-summary">
                      {t("bulkRemoveConfirm", {
                        count: selected.size,
                        workspace: selectedWorkspaceName,
                      })}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="bulk-apply"
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      disabled={
                        bulk.isPending ||
                        !bulkWorkspaceId ||
                        sharedWorkspaces.length === 0
                      }
                      onClick={() => {
                        void applyBulk();
                      }}
                    >
                      {t("bulkApply")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
                      onClick={() => {
                        setBulkMode(null);
                        setBulkWorkspaceId("");
                        setBulkError(null);
                      }}
                    >
                      {t("bulkCancel")}
                    </button>
                  </div>
                </div>
              )}

              {bulkError && (
                <span data-testid="bulk-error" className="text-xs text-destructive">
                  {bulkError}
                </span>
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
              {users.map((u) => (
                <SettingsListRow
                  key={u.id}
                  data-testid={`admin-user-row-${u.id}`}
                  label={u.email}
                  className={
                    selectedUserId === u.id ? "bg-muted/40" : undefined
                  }
                  columns={[
                    <input
                      key="sel"
                      type="checkbox"
                      aria-label={u.email}
                      checked={selected.has(u.id)}
                      onChange={() => toggleUser(u)}
                    />,
                    <button
                      key="email"
                      type="button"
                      className="text-left text-sm truncate w-full"
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
                    <span
                      key="ws"
                      className="text-sm truncate"
                      title={(u.workspaces ?? []).map((w) => w.name).join(", ")}
                    >
                      {(u.workspaces ?? []).length === 0
                        ? t("workspacesNone")
                        : (u.workspaces ?? []).map((w) => w.name).join(", ")}
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

      {selectedUserId ? (
        <UserDetailPanel
          userId={selectedUserId}
          onClose={() => setSelectedUserId(null)}
        />
      ) : (
        <SettingsCard testId="admin-user-detail-empty">
          <p className="text-sm text-muted-foreground">{t("detailEmpty")}</p>
        </SettingsCard>
      )}
      </div>
    </SettingsShell>
  );
}
