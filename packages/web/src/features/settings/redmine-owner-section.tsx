import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  issuePrioritySchema,
  issueStateSchema,
  type IntegrationConnection,
  type IntegrationDiscovery,
  type IssuePriority,
  type IssueState,
} from "@kanon/shared";
import { SettingsCard } from "@/components/ui/settings-card";
import {
  useConfigureRedmineProviderMapsMutation,
  useCreateRedmineConnectionMutation,
  useRedmineDiscoveryQuery,
  useRedmineAuditHealthQuery,
  useReplaceRedmineServiceCredentialMutation,
  useSetRedmineLifecycleMutation,
} from "./use-redmine-integration";

function AuditHealthCard({
  workspaceId,
  connectionId,
  bindingId,
  bindingNumber,
}: {
  workspaceId: string;
  connectionId: string;
  bindingId: string | undefined;
  bindingNumber?: number;
}) {
  const { t } = useTranslation("settings");
  const health = useRedmineAuditHealthQuery(workspaceId, connectionId, bindingId, true);
  const [now, setNow] = useState(Date.now);
  const validUntil = Date.parse(health.data?.validUntil ?? "");
  const isCurrent =
    health.data?.fresh === true &&
    health.data.state === "complete" &&
    Number.isFinite(validUntil) &&
    validUntil > now;

  useEffect(() => {
    if (!Number.isFinite(validUntil) || validUntil <= now) return;
    const timeout = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(validUntil - Date.now(), 0), 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [now, validUntil]);

  const title = bindingNumber
    ? `${t("redmineAuditHealthTitle")} — ${t("redmineAuditBinding", { number: bindingNumber })}`
    : t("redmineAuditHealthTitle");

  return (
    <section aria-label={title} className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {!bindingId ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("redmineAuditNoEvidence")}</p>
      ) : health.isLoading ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("redmineAuditLoading")}</p>
      ) : health.error || !health.data ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("redmineAuditUnknown")}</p>
      ) : !isCurrent ? (
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          <p>
            {health.data.state === "stale" || validUntil <= now
              ? t("redmineAuditStale")
              : t("redmineAuditUnknown")}
          </p>
          {health.data.reasonCode && (
            <p>{t("redmineAuditReason", { reason: health.data.reasonCode })}</p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          <p>{t("redmineAuditFresh")}</p>
          {health.data.completedAt && (
            <p>{t("redmineAuditCompletedAt", { time: health.data.completedAt })}</p>
          )}
          {health.data.validUntil && (
            <p>{t("redmineAuditFreshUntil", { time: health.data.validUntil })}</p>
          )}
        </div>
      )}
    </section>
  );
}

const ISSUE_STATES = issueStateSchema.options;
const ISSUE_PRIORITIES = issuePrioritySchema.options;

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

function guessPriority(name: string): IssuePriority {
  const value = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/urgent|immediate|critical|urgente|inmediata|critica/.test(value)) return "critical";
  if (/high|alta/.test(value)) return "high";
  if (/low|baja/.test(value)) return "low";
  return "medium";
}

function initialPriorityReadMap(
  priorities: IntegrationDiscovery["priorities"],
  existing?: Record<string, IssuePriority> | null,
) {
  return Object.fromEntries(
    priorities.map((priority) => [
      priority.id,
      existing?.[priority.id] ?? guessPriority(priority.name),
    ]),
  ) as Record<string, IssuePriority>;
}

function initialPriorityWriteMap(
  priorities: IntegrationDiscovery["priorities"],
  readMap: Record<string, IssuePriority>,
  existing?: Partial<Record<IssuePriority, string>> | null,
) {
  const known = new Set(priorities.map((priority) => priority.id));
  return Object.fromEntries(
    ISSUE_PRIORITIES.map((priority) => [
      priority,
      (existing?.[priority] && known.has(existing[priority]) ? existing[priority] : undefined) ??
        priorities.find((remote) => readMap[remote.id] === priority)?.id ??
        priorities[0]?.id ??
        "",
    ]),
  ) as Record<IssuePriority, string>;
}

function ConnectionSetup({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation("settings");
  const create = useCreateRedmineConnectionMutation(workspaceId);
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-muted-foreground">{t("redmineOwnerSetupHelp")}</p>
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
  const priorityReadInitial = initialPriorityReadMap(
    discovery.priorities,
    existing?.priorityReadMap,
  );
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
  const [priorityReadMap, setPriorityReadMap] = useState(priorityReadInitial);
  const [priorityWriteMap, setPriorityWriteMap] = useState(
    initialPriorityWriteMap(
      discovery.priorities,
      priorityReadInitial,
      existing?.priorityWriteMap,
    ),
  );
  const configure = useConfigureRedmineProviderMapsMutation(workspaceId, connection.id);
  const writableStatuses = discovery.statuses.filter((status) => status.writable);
  const complete =
    timeActivityId &&
    discovery.priorities.length > 0 &&
    Object.values(writeMap).every(Boolean) &&
    Object.values(priorityWriteMap).every(Boolean);

  return (
    <div className="mt-5 space-y-6">
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          configure.mutate({
            timeActivityId,
            readMap,
            writeMap,
            priorityReadMap,
            priorityWriteMap,
          });
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
          <h3 className="text-sm font-semibold text-foreground">{t("redminePriorityInboundMap")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("redminePriorityInboundMapHelp")}</p>
          <div className="mt-3 divide-y divide-border rounded-md border border-border">
            {discovery.priorities.map((priority) => (
              <label key={priority.id} className="grid gap-2 p-3 sm:grid-cols-2 sm:items-center">
                <span className="text-sm text-foreground">{priority.name}</span>
                <select
                  value={priorityReadMap[priority.id]}
                  onChange={(event) =>
                    setPriorityReadMap((current) => ({
                      ...current,
                      [priority.id]: event.target.value as IssuePriority,
                    }))
                  }
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {ISSUE_PRIORITIES.map((value) => (
                    <option key={value} value={value}>{t(`redminePriority.${value}`)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("redminePriorityOutboundMap")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("redminePriorityOutboundMapHelp")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {ISSUE_PRIORITIES.map((priority) => (
              <label key={priority} className="text-sm text-foreground">
                {t(`redminePriority.${priority}`)}
                <select
                  value={priorityWriteMap[priority]}
                  onChange={(event) =>
                    setPriorityWriteMap((current) => ({
                      ...current,
                      [priority]: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5"
                >
                  {discovery.priorities.map((remote) => (
                    <option key={remote.id} value={remote.id}>{remote.name}</option>
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
        {configure.isSuccess && <p className="text-sm text-success">{t("redmineMapsSaved")}</p>}
        <button
          type="submit"
          disabled={configure.isPending || !complete}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {configure.isPending ? t("redmineSaving") : t("redmineSaveMaps")}
        </button>
      </form>

    </div>
  );
}

function ConnectedOwnerPanel({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: IntegrationConnection;
}) {
  const { t } = useTranslation("settings");
  const discovery = useRedmineDiscoveryQuery(workspaceId, connection.id, true);
  const replace = useReplaceRedmineServiceCredentialMutation(workspaceId, connection.id);
  const lifecycle = useSetRedmineLifecycleMutation(workspaceId, connection.id);
  const [apiKey, setApiKey] = useState("");
  const canActivate = Boolean(
    connection.bindings.length > 0 && connection.providerMaps?.timeActivityId,
  );

  return (
    <div className="mt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="break-all text-sm text-muted-foreground">{connection.baseUrl}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("redmineOwnerMapsHelp")}</p>
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
      <div className="mt-4 space-y-4">
        {connection.bindings.length ? (
          connection.bindings.map((binding, index) => (
            <AuditHealthCard
              key={binding.id}
              workspaceId={workspaceId}
              connectionId={connection.id}
              bindingId={binding.id}
              bindingNumber={index + 1}
            />
          ))
        ) : (
          <AuditHealthCard workspaceId={workspaceId} connectionId={connection.id} bindingId={undefined} />
        )}
        <form
          className="rounded-lg border border-border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            replace.mutate(apiKey, { onSuccess: () => setApiKey("") });
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t("redmineServiceCredentialBlocked")}
          </p>
          <label className="mt-3 block text-sm font-medium text-foreground">
            {t("redmineServiceApiKey")}
            <input
              type="password"
              required
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </label>
          {replace.isError && (
            <p className="mt-2 text-sm text-destructive">{replace.error.message}</p>
          )}
          {replace.isSuccess && (
            <p className="mt-2 text-sm text-emerald-600">{t("redmineServiceKeyReplaced")}</p>
          )}
          <button
            type="submit"
            disabled={replace.isPending || !apiKey}
            className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {replace.isPending
              ? t("redmineReplacingServiceKey")
              : t("redmineReplaceServiceKey")}
          </button>
        </form>
        <div className="rounded-lg border border-border p-4">
          <label className="block text-sm font-medium text-foreground">
            {t("redmineLifecycleControl")}
            <select
              value={connection.lifecycle}
              onChange={(event) =>
                lifecycle.mutate(event.target.value as "active" | "paused" | "disabled")
              }
              disabled={lifecycle.isPending}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2"
            >
              <option value="draft" disabled>{t("redmineLifecycle.draft")}</option>
              <option value="pausing" disabled>{t("redmineLifecycle.pausing")}</option>
              <option value="active" disabled={!canActivate}>{t("redmineLifecycle.active")}</option>
              <option value="paused">{t("redmineLifecycle.paused")}</option>
              <option value="disabled">{t("redmineLifecycle.disabled")}</option>
            </select>
          </label>
          <p className="mt-2 text-sm text-muted-foreground">{t("redmineActivateHelp")}</p>
          {lifecycle.isError && (
            <p className="mt-2 text-sm text-destructive">{lifecycle.error.message}</p>
          )}
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
          key={`${discovery.data.statuses.map((status) => status.id).join(",")}:${discovery.data.priorities.map((priority) => priority.id).join(",")}`}
          workspaceId={workspaceId}
          connection={connection}
          discovery={discovery.data}
        />
      )}
    </div>
  );
}

export function RedmineOwnerSection({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection: IntegrationConnection | null;
}) {
  const { t } = useTranslation("settings");

  return (
    <SettingsCard testId="redmine-owner-section">
      <h2 className="text-lg font-semibold text-foreground">{t("redmineOwnerTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("redmineOwnerHelp")}</p>
      {connection ? (
        <ConnectedOwnerPanel workspaceId={workspaceId} connection={connection} />
      ) : (
        <ConnectionSetup workspaceId={workspaceId} />
      )}
    </SettingsCard>
  );
}
