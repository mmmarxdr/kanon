import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  issueStateSchema,
  type IntegrationConnection,
  type IntegrationDiscovery,
  type IssueState,
} from "@kanon/shared";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import {
  useClearRedmineCredentialMutation,
  useConfigureRedmineMutation,
  useConnectRedmineCredentialMutation,
  useCreateRedmineConnectionMutation,
  useRedmineConnectionQuery,
  useRedmineDiscoveryQuery,
} from "./use-redmine-integration";

const ISSUE_STATES = issueStateSchema.options;

function guessState(name: string): IssueState {
  const value = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/done|closed|resolved|cerrad|resuelt|implementad/.test(value)) return "done";
  if (/review|qa|uat|test|valid|revision/.test(value)) return "review";
  if (/progress|doing|develop|desarroll|curso/.test(value)) return "in_progress";
  if (/analy|analisis|triage|refin/.test(value)) return "analysis";
  if (/todo|ready|pendiente|hacer/.test(value)) return "todo";
  return "backlog";
}

function initialReadMap(
  statuses: IntegrationDiscovery["statuses"],
  existing?: Record<string, IssueState>,
) {
  return Object.fromEntries(
    statuses.map((status) => [status.id, existing?.[status.id] ?? guessState(status.name)]),
  ) as Record<string, IssueState>;
}

function initialWriteMap(
  statuses: IntegrationDiscovery["statuses"],
  readMap: Record<string, IssueState>,
  existing?: Record<string, string>,
) {
  const writable = statuses.filter((status) => status.writable);
  return Object.fromEntries(
    ISSUE_STATES.map((state, index) => {
      const exact = writable.find((status) => readMap[status.id] === state)?.id;
      const fallback = writable.length
        ? writable[Math.round((index * (writable.length - 1)) / (ISSUE_STATES.length - 1))]!.id
        : "";
      return [state, existing?.[state] ?? exact ?? fallback];
    }),
  ) as Record<IssueState, string>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-border bg-card p-5 sm:p-6">{children}</section>;
}

function ConnectionSetup({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation("settings");
  const create = useCreateRedmineConnectionMutation(workspaceId);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  return (
    <Card>
      <h2 className="text-lg font-semibold text-foreground">{t("redmineSetupTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("redmineSetupHelp")}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { baseUrl: baseUrl.trim().replace(/\/$/, ""), apiKey },
            { onSuccess: () => setApiKey("") },
          );
        }}
      >
        <label className="block text-sm font-medium text-foreground">
          {t("redmineBaseUrl")}
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://redmine.example.com"
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
        <label className="block text-sm font-medium text-foreground">
          {t("redmineApiKey")}
          <input
            type="password"
            required
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
        {create.isError && <p className="text-sm text-destructive">{create.error.message}</p>}
        <button
          type="submit"
          disabled={create.isPending || !baseUrl.trim() || !apiKey}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {create.isPending ? t("redmineTesting") : t("redmineTestConnection")}
        </button>
      </form>
    </Card>
  );
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

function MappingFields({
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
  const readInitial = initialReadMap(discovery.statuses, binding?.readMap);
  const [remoteProjectId, setRemoteProjectId] = useState(
    binding?.remoteProjectId ?? discovery.projects[0]?.id ?? "",
  );
  const [timeActivityId, setTimeActivityId] = useState(
    binding?.timeActivityId ??
      discovery.timeEntryActivities.find((activity) => activity.isDefault)?.id ??
      discovery.timeEntryActivities[0]?.id ??
      "",
  );
  const [readMap, setReadMap] = useState(readInitial);
  const [writeMap, setWriteMap] = useState(
    initialWriteMap(discovery.statuses, readInitial, binding?.writeMap),
  );
  const configure = useConfigureRedmineMutation(workspaceId, connection.id);
  const writableStatuses = discovery.statuses.filter((status) => status.writable);
  const complete =
    projectId && remoteProjectId && timeActivityId && Object.values(writeMap).every(Boolean);

  return (
    <form
      className="mt-5 space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        configure.mutate({ projectId, remoteProjectId, timeActivityId, readMap, writeMap });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-foreground">
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
        <label className="text-sm font-medium text-foreground">
          {t("redmineTimeActivity")}
          <select
            value={timeActivityId}
            onChange={(event) => setTimeActivityId(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2"
          >
            {discovery.timeEntryActivities.map((activity) => (
              <option key={activity.id} value={activity.id}>{activity.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("redmineInboundMap")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("redmineInboundMapHelp")}</p>
        <div className="mt-3 divide-y divide-border rounded-md border border-border">
          {discovery.statuses.map((status) => (
            <label key={status.id} className="grid gap-2 p-3 sm:grid-cols-2 sm:items-center">
              <span className="text-sm text-foreground">{status.name}</span>
              <select
                value={readMap[status.id]}
                onChange={(event) =>
                  setReadMap((current) => ({
                    ...current,
                    [status.id]: event.target.value as IssueState,
                  }))
                }
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {ISSUE_STATES.map((state) => (
                  <option key={state} value={state}>{t(`redmineState.${state}`)}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">{t("redmineOutboundMap")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("redmineOutboundMapHelp")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ISSUE_STATES.map((state) => (
            <label key={state} className="text-sm text-foreground">
              {t(`redmineState.${state}`)}
              <select
                value={writeMap[state]}
                onChange={(event) =>
                  setWriteMap((current) => ({ ...current, [state]: event.target.value }))
                }
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
              >
                {writableStatuses.map((status) => (
                  <option key={status.id} value={status.id}>{status.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      {configure.isError && <p className="text-sm text-destructive">{configure.error.message}</p>}
      {configure.isSuccess && <p className="text-sm text-emerald-600">{t("redmineMappingSaved")}</p>}
      <button
        type="submit"
        disabled={configure.isPending || !complete}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {configure.isPending ? t("redmineSaving") : t("redmineSaveActivate")}
      </button>
    </form>
  );
}

function MappingCard({
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
          <h2 className="text-lg font-semibold text-foreground">{t("redmineMappingTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("redmineMappingHelp")}</p>
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
      ) : !discovery.data || !projects.data?.length ? (
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
          <MappingFields
            key={selectedProjectId}
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

function CoverageCard({ connection }: { connection: IntegrationConnection }) {
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
        {connection.memberCoverage.map((member) => (
          <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {member.user.displayName ?? member.username}
              </p>
              <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
            </div>
            <span
              className={
                member.credential.connected
                  ? "rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600"
                  : "rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground"
              }
            >
              {member.credential.connected
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
}: {
  workspaceId: string;
  currentUserRole: string | undefined;
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
    return isOwner ? (
      <ConnectionSetup workspaceId={workspaceId} />
    ) : (
      <Card><p className="text-sm text-muted-foreground">{t("redmineNotConfigured")}</p></Card>
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
            {connection.data.lifecycle}
          </span>
        </div>
      </Card>
      <CredentialCard workspaceId={workspaceId} connection={connection.data} />
      {isOwner && <MappingCard workspaceId={workspaceId} connection={connection.data} />}
      <CoverageCard connection={connection.data} />
    </div>
  );
}
