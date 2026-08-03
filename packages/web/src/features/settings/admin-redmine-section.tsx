import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  issueStateSchema,
  type IntegrationConnection,
  type IntegrationDiscovery,
  type IssueState,
} from "@kanon/shared";
import { useWorkspacesQuery } from "@/hooks/use-workspace-query";
import {
  useConfigureRedmineProviderMapsMutation,
  useCreateRedmineConnectionMutation,
  useRedmineConnectionQuery,
  useRedmineDiscoveryQuery,
  useSetRedmineLifecycleMutation,
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
  existing?: Record<string, IssueState> | null,
) {
  return Object.fromEntries(
    statuses.map((status) => [status.id, existing?.[status.id] ?? guessState(status.name)]),
  ) as Record<string, IssueState>;
}

function initialWriteMap(
  statuses: IntegrationDiscovery["statuses"],
  readMap: Record<string, IssueState>,
  existing?: Record<string, string> | null,
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
  return (
    <section
      data-testid="admin-redmine-section"
      className="rounded-lg border border-border bg-card p-5 sm:p-6"
    >
      {children}
    </section>
  );
}

function ConnectionSetup({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation("settings");
  const create = useCreateRedmineConnectionMutation(workspaceId);
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">{t("redmineAdminSetupHelp")}</p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(apiKey, { onSuccess: () => setApiKey("") });
        }}
      >
        <label className="block text-sm font-medium text-foreground">
          {t("redmineServiceApiKey")}
          <input
            type="password"
            required
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            data-testid="admin-redmine-api-key"
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
        {create.isError && <p className="text-sm text-destructive">{create.error.message}</p>}
        <button
          type="submit"
          disabled={create.isPending || !apiKey}
          data-testid="admin-redmine-test-connection"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {create.isPending ? t("redmineTesting") : t("redmineTestConnection")}
        </button>
      </form>
    </div>
  );
}

function ProviderMapsForm({
  workspaceId,
  connection,
  discovery,
}: {
  workspaceId: string;
  connection: IntegrationConnection;
  discovery: IntegrationDiscovery;
}) {
  const { t } = useTranslation("settings");
  const existing = connection.providerMaps;
  const readInitial = initialReadMap(discovery.statuses, existing?.readMap);
  const [timeActivityId, setTimeActivityId] = useState(
    existing?.timeActivityId ??
      discovery.timeEntryActivities.find((activity) => activity.isDefault)?.id ??
      discovery.timeEntryActivities[0]?.id ??
      "",
  );
  const [readMap, setReadMap] = useState(readInitial);
  const [writeMap, setWriteMap] = useState(
    initialWriteMap(discovery.statuses, readInitial, existing?.writeMap),
  );
  const configure = useConfigureRedmineProviderMapsMutation(workspaceId, connection.id);
  const lifecycle = useSetRedmineLifecycleMutation(workspaceId, connection.id);
  const writableStatuses = discovery.statuses.filter((status) => status.writable);
  const complete = timeActivityId && Object.values(writeMap).every(Boolean);
  const canActivate = connection.bindings.length > 0 && connection.providerMaps?.timeActivityId;

  return (
    <div className="mt-5 space-y-6">
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          configure.mutate({ timeActivityId, readMap, writeMap });
        }}
      >
        <label className="block text-sm font-medium text-foreground">
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
        {configure.isSuccess && <p className="text-sm text-emerald-600">{t("redmineMapsSaved")}</p>}
        <button
          type="submit"
          disabled={configure.isPending || !complete}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {configure.isPending ? t("redmineSaving") : t("redmineSaveMaps")}
        </button>
      </form>

      <div className="border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">{t("redmineActivateHelp")}</p>
        {lifecycle.isError && <p className="mt-2 text-sm text-destructive">{lifecycle.error.message}</p>}
        <button
          type="button"
          disabled={lifecycle.isPending || !canActivate || connection.lifecycle === "active"}
          onClick={() => lifecycle.mutate("active")}
          className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {connection.lifecycle === "active" ? t("redmineAlreadyActive") : t("redmineActivate")}
        </button>
      </div>
    </div>
  );
}

function ConnectedAdminPanel({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: IntegrationConnection;
}) {
  const { t } = useTranslation("settings");
  const discovery = useRedmineDiscoveryQuery(connection.id, true);

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="break-all text-sm text-muted-foreground">{connection.baseUrl}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("redmineAdminMapsHelp")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`redmineLifecycle.${connection.lifecycle}`)}
          </span>
          <button
            type="button"
            onClick={() => void discovery.refetch()}
            disabled={discovery.isFetching}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-50"
          >
            {t("redmineRefresh")}
          </button>
        </div>
      </div>
      {discovery.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("redmineLoading")}</p>
      ) : discovery.error ? (
        <p className="mt-4 text-sm text-destructive">{discovery.error.message}</p>
      ) : !discovery.data ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("redmineLoading")}</p>
      ) : (
        <ProviderMapsForm
          key={discovery.data.statuses.map((status) => status.id).join(",")}
          workspaceId={workspaceId}
          connection={connection}
          discovery={discovery.data}
        />
      )}
    </div>
  );
}

export function AdminRedmineSection({ redmineBaseUrl }: { redmineBaseUrl: string | null }) {
  const { t } = useTranslation("settings");
  const workspaces = useWorkspacesQuery();
  const [workspaceId, setWorkspaceId] = useState("");
  const selectedId = workspaceId || workspaces.data?.[0]?.id || "";
  const connection = useRedmineConnectionQuery(selectedId || undefined);

  if (!redmineBaseUrl) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-foreground">{t("redmineAdminTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("redmineAdminNeedsUrl")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-foreground">{t("redmineAdminTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("redmineAdminHelp")}</p>

      {workspaces.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("redmineLoading")}</p>
      ) : !workspaces.data?.length ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("redmineAdminNoWorkspace")}</p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-medium text-foreground">
            {t("redmineAdminWorkspace")}
            <select
              value={selectedId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              data-testid="admin-redmine-workspace"
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2"
            >
              {workspaces.data.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          </label>

          {connection.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("redmineLoading")}</p>
          ) : connection.error ? (
            <p className="mt-4 text-sm text-destructive">{connection.error.message}</p>
          ) : !connection.data ? (
            <ConnectionSetup key={selectedId} workspaceId={selectedId} />
          ) : (
            <ConnectedAdminPanel
              key={selectedId}
              workspaceId={selectedId}
              connection={connection.data}
            />
          )}
        </>
      )}
    </Card>
  );
}
