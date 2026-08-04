import { useTranslation } from "react-i18next";
import { SettingsCard } from "@/components/ui/settings-card";
import {
  SettingsList,
  SettingsListRow,
  NOTIFICATIONS_GRID,
} from "@/components/ui/settings-list";
import { useNotificationPreferencesQuery } from "./use-notification-preferences-query";
import { useUpdateNotificationPreferencesMutation } from "./use-update-notification-preferences-mutation";
import type { NotificationPreferenceItem } from "@kanon/shared";

type PrefKey = keyof NotificationPreferenceItem;

const PREF_ROWS: { key: PrefKey; labelKey: string; descriptionKey: string }[] = [
  {
    key: "emailMention",
    labelKey: "notifMentions",
    descriptionKey: "notifMentionsDesc",
  },
  {
    key: "emailAssignment",
    labelKey: "notifAssignments",
    descriptionKey: "notifAssignmentsDesc",
  },
  {
    key: "emailCycleClosed",
    labelKey: "notifCycleClosed",
    descriptionKey: "notifCycleClosedDesc",
  },
];

const NOTIFICATION_COLUMNS = [
  { key: "toggle", label: "" },
  { key: "label", label: "" },
];

export function NotificationPreferencesSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useTranslation("settings");
  const { data, isLoading, error } = useNotificationPreferencesQuery(workspaceId);
  const update = useUpdateNotificationPreferencesMutation(workspaceId);

  if (isLoading) {
    return (
      <SettingsCard>
        <p className="text-sm text-muted-foreground">{t("notifLoading")}</p>
      </SettingsCard>
    );
  }

  if (error) {
    return (
      <SettingsCard>
        <p className="text-sm text-destructive">
          {t("notifFailed", {
            message: error instanceof Error ? error.message : t("notifUnknownError"),
          })}
        </p>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title={t("notifTitle")}>
      <p className="text-sm text-muted-foreground mb-4">
        {t("notifHelp")}
      </p>

      <SettingsList
        columns={NOTIFICATION_COLUMNS}
        gridTemplateColumns={NOTIFICATIONS_GRID}
        showHeader={false}
        data-testid="notification-preferences-list"
      >
        {PREF_ROWS.map(({ key, labelKey, descriptionKey }) => {
          const enabled = data?.[key] ?? true;

          return (
            <SettingsListRow
              key={key}
              label={t(labelKey)}
              columns={[
                <button
                  key="toggle"
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={t(labelKey)}
                  data-testid={`toggle-${key}`}
                  disabled={!data || update.isPending}
                  onClick={() => {
                    if (!data) return;
                    update.mutate({ ...data, [key]: !data[key] });
                  }}
                  className={[
                    "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed",
                    enabled ? "bg-primary" : "bg-input",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-primary-foreground shadow ring-0 transition duration-200 ease-in-out",
                      enabled ? "translate-x-4" : "translate-x-0",
                    ].join(" ")}
                  />
                </button>,
                <div key="label" className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{t(labelKey)}</p>
                  <p className="text-xs text-muted-foreground">{t(descriptionKey)}</p>
                </div>,
              ]}
            />
          );
        })}
      </SettingsList>
    </SettingsCard>
  );
}
