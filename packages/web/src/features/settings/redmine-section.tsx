import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { IntegrationConnection, IntegrationDiscovery } from "@kanon/shared";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import {
  useBindRedmineProjectMutation,
  useClearRedmineCredentialMutation,
  useConnectRedmineCredentialMutation,
  useRedmineConnectionQuery,
  useRedmineDiscoveryQuery,
} from "./use-redmine-integration";
import type { WorkspaceMember } from "./use-settings-queries";

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-5 sm:p-6">{children}</section>;
}

function CredentialCard({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: IntegrationConnection;
}) {
  const { t } = useTranslation("settings");
  const connect = useConnectRedmineCredentialMutation(workspaceId, connection.id);
  const clear = useClearRedmineCredentialMutation(workspaceId, connection.id);
  const [apiKey, setApiKey] = useState("");
  const credential = connection.callerCredential;

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("redmineMyAccount")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {credential.connected
              ? t("redmineConnectedAs", { login: credential.externalLogin ?? credential.externalUserId })
              : t("redmineMyAccountHelp")}
          </p>
        </div>
        {credential.connected && (
          <button
            type="button"
            onClick={() => clear.mutate()}
            disabled={clear.isPending}
            className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-destructive disabled:opacity-50"
          >
            {t("redmineDisconnect")}
          </button>
        )}
      </div>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          connect.mutate(apiKey, { onSuccess: () => setApiKey("") });
        }}
      >
        <input
          type="password"
          required
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          aria-label={t("redmineApiKey")}
          placeholder={t("redmineApiKey")}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
        <button
          type="submit"
          disabled={connect.isPending || !apiKey}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {connect.isPending
            ? t("redmineConnecting")
            : credential.connected
              ? t("redmineReplaceKey")
              : t("redmineConnect")}
        </button>
      </form>
      {(connect.isError || clear.isError) && (
        <p className="mt-2 text-sm text-destructive">
          {(connect.error ?? clear.error)?.message}
        </p>
      )}
    </Card>
  );
}

function ProjectBindFields({
  workspaceId,
  connection,
  discovery,
  projectId,
}: {
  workspaceId: string;
  connection: IntegrationConnection;
  discovery: IntegrationDiscovery;
  projectId: string;
}) {
  const { t } = useTranslation("settings");
  const binding = connection.bindings.find((item) => item.projectId === projectId);
  const [remoteProjectId, setRemoteProjectId] = useState(
    binding?.remoteProjectId ?? discovery.projects[0]?.id ?? "",
  );
  const bind = useBindRedmineProjectMutation(workspaceId, connection.id);
  const complete = projectId && remoteProjectId;

  return (
    <form
      className="mt-5 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        bind.mutate({ projectId, remoteProjectId });
      }}
    >
      <label className="block text-sm font-medium text-foreground">
        {t("redmineRemoteProject")}
        <select
          value={remoteProjectId}
          onChange={(event) => setRemoteProjectId(event.target.value)}
          className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2"
        >
          {discovery.projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>
      {bind.isError && <p className="text-sm text-destructive">{bind.error.message}</p>}
      {bind.isSuccess && <p className="text-sm text-success">{t("redmineProjectBound")}</p>}
      <button
        type="submit"
        disabled={bind.isPending || !complete}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {bind.isPending ? t("redmineSaving") : t("redmineSaveProject")}
      </button>
    </form>
  );
}

function ProjectBindCard({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: IntegrationConnection;
}) {
  const { t } = useTranslation("settings");
  const discovery = useRedmineDiscoveryQuery(connection.id, true);
  const projects = useProjectsQuery(workspaceId);
  const [projectId, setProjectId] = useState(connection.bindings[0]?.projectId ?? "");
  const selectedProjectId = projectId || projects.data?.[0]?.id || "";

  return (
    <Card>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("redmineProjectBindTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("redmineProjectBindHelp")}</p>
        </div>
        <button
          type="button"
          onClick={() => void discovery.refetch()}
          disabled={discovery.isFetching}
          className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-50"
        >
          {t("redmineRefresh")}
        </button>
      </div>
      {discovery.isLoading || projects.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("redmineLoading")}</p>
      ) : discovery.error || projects.error ? (
        <p className="mt-4 text-sm text-destructive">
          {(discovery.error ?? projects.error)?.message}
        </p>
      ) : !discovery.data?.projects.length || !projects.data?.length ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("redmineNoProjects")}</p>
      ) : (
        <>
          <label className="mt-5 block text-sm font-medium text-foreground">
            {t("redmineKanonProject")}
            <select
              value={selectedProjectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2"
            >
              {projects.data.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <ProjectBindFields
            key={`${selectedProjectId}:${discovery.data.projects.map((project) => project.id).join(",")}`}
            workspaceId={workspaceId}
            connection={connection}
            discovery={discovery.data}
            projectId={selectedProjectId}
          />
        </>
      )}
    </Card>
  );
}

function CoverageCard({
  connection,
  members,
}: {
  connection: IntegrationConnection;
  members: WorkspaceMember[] | undefined;
}) {
  const { t } = useTranslation("settings");
  const { validCredentials, workspaceMembers } = connection.counts;
  const percent = workspaceMembers ? Math.round((validCredentials / workspaceMembers) * 100) : 0;

  return (
    <Card>
      <h2 className="text-lg font-semibold text-foreground">{t("redmineCoverageTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("redmineCoverageSummary", { connected: validCredentials, total: workspaceMembers })}
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-4 divide-y divide-border rounded-md border border-border">
        {(members ?? []).map((member) => (
          <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {member.user.displayName ?? member.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
            </div>
            <span
              className={
                connection.connectedMemberIds.includes(member.id)
                  ? "rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success"
                  : "rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground"
              }
            >
              {connection.connectedMemberIds.includes(member.id)
                ? t("redmineConnectedBadge")
                : t("redmineDisconnectedBadge")}
            </span>
          </div>
        ))}
      </div>
      {connection.bindings.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {t("redmineProjectsMapped", { count: connection.bindings.length })}
        </p>
      )}
    </Card>
  );
}

export function RedmineSection({
  workspaceId,
  currentUserRole,
  members,
}: {
  workspaceId: string;
  currentUserRole: string | undefined;
  members: WorkspaceMember[] | undefined;
}) {
  const { t } = useTranslation("settings");
  const connection = useRedmineConnectionQuery(workspaceId);
  const isOwner = currentUserRole === "owner";

  if (connection.isLoading) {
    return <Card><p className="text-sm text-muted-foreground">{t("redmineLoading")}</p></Card>;
  }
  if (connection.error) {
    return <Card><p className="text-sm text-destructive">{connection.error.message}</p></Card>;
  }
  if (!connection.data) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-foreground">Redmine</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("redmineNotConfigured")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Redmine</h2>
            <p className="mt-1 break-all text-sm text-muted-foreground">{connection.data.baseUrl}</p>
          </div>
          <span className="self-start rounded-full bg-secondary px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`redmineLifecycle.${connection.data.lifecycle}`)}
          </span>
        </div>
      </Card>
      <CredentialCard workspaceId={workspaceId} connection={connection.data} />
      {isOwner && <ProjectBindCard workspaceId={workspaceId} connection={connection.data} />}
      <CoverageCard connection={connection.data} members={members} />
    </div>
  );
}
