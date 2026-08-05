import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api-client";
import { SettingsCard } from "@/components/ui/settings-card";
import { SETTINGS_INPUT_CLASS } from "@/components/ui/settings-field";
import {
  useAddAdminMembershipMutation,
  useAdminUserDetailQuery,
  useAdminWorkspaceProjectsQuery,
  useAdminWorkspacesQuery,
  useMoveAdminMembershipMutation,
  usePatchAdminMembershipMutation,
  useRemoveAdminMembershipMutation,
  useReplaceAdminProjectsMutation,
  useVerifyAdminUserEmailMutation,
  type AdminMembership,
} from "./use-admin-users";

const ROLES = ["viewer", "member", "pm", "admin", "owner"] as const;

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

function MembershipCard({
  userId,
  membership,
  otherWorkspaceOptions,
}: {
  userId: string;
  membership: AdminMembership;
  otherWorkspaceOptions: Array<{ id: string; name: string }>;
}) {
  const { t } = useTranslation("admin");
  const [role, setRole] = useState(membership.role);
  const [projectAccess, setProjectAccess] = useState(membership.projectAccess);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(
    (membership.projects ?? []).map((p) => p.projectId),
  );
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveWorkspaceId, setMoveWorkspaceId] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const patch = usePatchAdminMembershipMutation(userId);
  const remove = useRemoveAdminMembershipMutation(userId);
  const replaceProjects = useReplaceAdminProjectsMutation(userId);
  const move = useMoveAdminMembershipMutation(userId);
  const projectsQuery = useAdminWorkspaceProjectsQuery(
    projectAccess === "assigned" ? membership.workspaceId : null,
  );

  useEffect(() => {
    setRole(membership.role);
    setProjectAccess(membership.projectAccess);
    setSelectedProjectIds((membership.projects ?? []).map((p) => p.projectId));
  }, [membership]);

  function flash(msg: string) {
    setSavedFlash(msg);
    window.setTimeout(() => setSavedFlash(null), 2000);
  }

  const dirtyMembership =
    role !== membership.role || projectAccess !== membership.projectAccess;

  const currentProjectIds = (membership.projects ?? []).map((p) => p.projectId).sort();
  const dirtyProjects =
    projectAccess === "assigned" &&
    (selectedProjectIds.length !== currentProjectIds.length ||
      [...selectedProjectIds].sort().some((id, i) => id !== currentProjectIds[i]));

  return (
    <div
      data-testid={`membership-${membership.memberId}`}
      className="rounded-md border border-border px-3 py-3 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{membership.workspaceName}</div>
          <div className="text-xs text-muted-foreground">
            {membership.workspaceSlug}
          </div>
        </div>
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {membership.projectAccess === "workspace"
            ? t("accessWorkspaceShort")
            : t("accessAssignedShort")}
        </span>
      </div>

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
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("projects")}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline"
                onClick={() =>
                  setSelectedProjectIds((projectsQuery.data ?? []).map((p) => p.id))
                }
              >
                {t("selectAllProjects")}
              </button>
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline"
                onClick={() => setSelectedProjectIds([])}
              >
                {t("clearProjects")}
              </button>
            </div>
          </div>
          {projectsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("loading")}</p>
          ) : !projectsQuery.data?.length ? (
            <p className="text-xs text-muted-foreground">{t("noAssignedProjects")}</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-44 overflow-auto">
              {projectsQuery.data.map((p) => {
                const checked = selectedProjectIds.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
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
                    <span className="truncate">
                      <span className="font-medium">{p.key}</span>
                      <span className="text-muted-foreground"> — {p.name}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <button
            type="button"
            data-testid={`save-projects-${membership.memberId}`}
            className="self-start rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={replaceProjects.isPending || !dirtyProjects}
            onClick={() => {
              setLocalError(null);
              replaceProjects.mutate(
                {
                  memberId: membership.memberId,
                  projects: selectedProjectIds.map((projectId) => ({
                    projectId,
                    role:
                      membership.projects?.find((p) => p.projectId === projectId)
                        ?.role ?? role,
                  })),
                },
                {
                  onSuccess: () => flash(t("saved")),
                  onError: (err) => setLocalError(errorMessage(err, t("actionFailed"))),
                },
              );
            }}
          >
            {t("saveProjects")}
          </button>
        </div>
      )}

      {projectAccess === "workspace" && (
        <p className="text-xs text-muted-foreground">{t("workspaceAccessHint")}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid={`save-membership-${membership.memberId}`}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          disabled={patch.isPending || !dirtyMembership}
          onClick={() => {
            setLocalError(null);
            patch.mutate(
              {
                memberId: membership.memberId,
                role,
                projectAccess,
              },
              {
                onSuccess: () => flash(t("saved")),
                onError: (err) => setLocalError(errorMessage(err, t("actionFailed"))),
              },
            );
          }}
        >
          {t("saveMembership")}
        </button>
        <button
          type="button"
          data-testid={`move-membership-btn-${membership.memberId}`}
          className="rounded-md border border-border px-3 py-1.5 text-xs"
          onClick={() => {
            setMoveOpen((v) => !v);
            setConfirmRemove(false);
            setLocalError(null);
          }}
        >
          {t("moveMembership")}
        </button>
        {!confirmRemove ? (
          <button
            type="button"
            data-testid={`remove-membership-btn-${membership.memberId}`}
            className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive"
            onClick={() => {
              setConfirmRemove(true);
              setMoveOpen(false);
            }}
          >
            {t("removeMembership")}
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid={`confirm-remove-${membership.memberId}`}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
              disabled={remove.isPending}
              onClick={() => {
                setLocalError(null);
                remove.mutate(membership.memberId, {
                  onError: (err) =>
                    setLocalError(errorMessage(err, t("actionFailed"))),
                });
              }}
            >
              {t("confirmRemove")}
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              onClick={() => setConfirmRemove(false)}
            >
              {t("bulkCancel")}
            </button>
          </>
        )}
      </div>

      {moveOpen && (
        <div
          data-testid={`move-panel-${membership.memberId}`}
          className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 px-3 py-3"
        >
          <div className="text-sm font-medium">{t("moveMembershipTitle")}</div>
          <p className="text-xs text-muted-foreground">{t("moveMembershipHelp")}</p>
          {otherWorkspaceOptions.length === 0 ? (
            <p className="text-xs text-destructive">{t("noMoveTargets")}</p>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t("selectWorkspace")}
              <select
                className={SETTINGS_INPUT_CLASS}
                value={moveWorkspaceId}
                onChange={(e) => setMoveWorkspaceId(e.target.value)}
                data-testid={`move-workspace-${membership.memberId}`}
              >
                <option value="">{t("bulkWorkspacePlaceholder")}</option>
                {otherWorkspaceOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid={`confirm-move-${membership.memberId}`}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              disabled={!moveWorkspaceId || move.isPending}
              onClick={() => {
                setLocalError(null);
                move.mutate(
                  {
                    memberId: membership.memberId,
                    workspaceId: moveWorkspaceId,
                    role,
                    projectAccess,
                  },
                  {
                    onSuccess: () => {
                      setMoveOpen(false);
                      setMoveWorkspaceId("");
                      flash(t("moved"));
                    },
                    onError: (err) =>
                      setLocalError(errorMessage(err, t("actionFailed"))),
                  },
                );
              }}
            >
              {t("confirmMove")}
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
              onClick={() => {
                setMoveOpen(false);
                setMoveWorkspaceId("");
              }}
            >
              {t("bulkCancel")}
            </button>
          </div>
        </div>
      )}

      {savedFlash && (
        <p className="text-xs text-success" data-testid="membership-saved">
          {savedFlash}
        </p>
      )}
      {localError && (
        <p className="text-xs text-destructive" data-testid="membership-error">
          {localError}
        </p>
      )}
    </div>
  );
}

export function UserDetailPanel({
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
  const [addProjectIds, setAddProjectIds] = useState<string[]>([]);
  const [addError, setAddError] = useState<string | null>(null);

  const addProjectsQuery = useAdminWorkspaceProjectsQuery(
    addAccess === "assigned" && addWorkspaceId ? addWorkspaceId : null,
  );

  const memberWorkspaceIds = useMemo(
    () => new Set((detail.data?.memberships ?? []).map((m) => m.workspaceId)),
    [detail.data?.memberships],
  );

  const availableWorkspaces = useMemo(
    () =>
      (workspaces.data ?? []).filter((w) => !memberWorkspaceIds.has(w.id)),
    [workspaces.data, memberWorkspaceIds],
  );

  useEffect(() => {
    setAddProjectIds([]);
  }, [addWorkspaceId, addAccess]);

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
          {t("detailFailed", { message: detail.error?.message ?? "error" })}
        </p>
      </SettingsCard>
    );
  }

  const user = detail.data;

  return (
    <SettingsCard title={t("detailTitle")} testId="admin-user-detail">
      <div className="flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-medium truncate">{user.email}</div>
            <div className="text-sm text-muted-foreground">
              {user.displayName ?? "—"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                {user.emailVerified ? t("alreadyVerified") : t("unverifiedBadge")}
              </span>
              {user.isInstanceAdmin && (
                <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                  {t("instanceAdminBadge")}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground underline shrink-0"
            onClick={onClose}
          >
            {t("detailClose")}
          </button>
        </div>

        {!user.emailVerified && (
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

        <section className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-medium">{t("memberships")}</div>
            <p className="text-xs text-muted-foreground">{t("membershipsHelp")}</p>
          </div>

          {user.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noMemberships")}</p>
          ) : (
            user.memberships.map((m) => (
              <MembershipCard
                key={m.memberId}
                userId={userId}
                membership={m}
                otherWorkspaceOptions={availableWorkspaces}
              />
            ))
          )}
        </section>

        <section
          data-testid="add-membership-section"
          className="flex flex-col gap-3 border-t border-border pt-4"
        >
          <div>
            <div className="text-sm font-medium">{t("addMembership")}</div>
            <p className="text-xs text-muted-foreground">{t("addMembershipHelp")}</p>
          </div>

          {availableWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noWorkspacesToAdd")}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("selectWorkspace")}
                <select
                  className={SETTINGS_INPUT_CLASS}
                  value={addWorkspaceId}
                  onChange={(e) => setAddWorkspaceId(e.target.value)}
                  data-testid="add-membership-workspace"
                >
                  <option value="">{t("bulkWorkspacePlaceholder")}</option>
                  {availableWorkspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {t("role")}
                  <select
                    className={SETTINGS_INPUT_CLASS}
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                    data-testid="add-membership-role"
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
                    value={addAccess}
                    onChange={(e) =>
                      setAddAccess(e.target.value as "workspace" | "assigned")
                    }
                    data-testid="add-membership-access"
                  >
                    <option value="workspace">{t("accessWorkspace")}</option>
                    <option value="assigned">{t("accessAssigned")}</option>
                  </select>
                </label>
              </div>

              {addAccess === "assigned" && addWorkspaceId && (
                <div className="flex flex-col gap-2 rounded-md border border-dashed border-border px-2 py-2">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("initialProjects")}
                  </div>
                  {addProjectsQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">{t("loading")}</p>
                  ) : !addProjectsQuery.data?.length ? (
                    <p className="text-xs text-muted-foreground">
                      {t("noAssignedProjects")}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-36 overflow-auto">
                      {addProjectsQuery.data.map((p) => {
                        const checked = addProjectIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setAddProjectIds((prev) =>
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
                </div>
              )}

              <button
                type="button"
                data-testid="add-membership-btn"
                className="self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                disabled={!addWorkspaceId || addMembership.isPending}
                onClick={() => {
                  setAddError(null);
                  addMembership.mutate(
                    {
                      workspaceId: addWorkspaceId,
                      role: addRole,
                      projectAccess: addAccess,
                      projects:
                        addAccess === "assigned"
                          ? addProjectIds.map((projectId) => ({
                              projectId,
                              role: addRole,
                            }))
                          : undefined,
                    },
                    {
                      onSuccess: () => {
                        setAddWorkspaceId("");
                        setAddProjectIds([]);
                        setAddRole("member");
                        setAddAccess("assigned");
                      },
                      onError: (err) =>
                        setAddError(errorMessage(err, t("actionFailed"))),
                    },
                  );
                }}
              >
                {t("add")}
              </button>
              {addError && (
                <p className="text-xs text-destructive" data-testid="add-membership-error">
                  {addError}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </SettingsCard>
  );
}
