import { useTranslation } from "react-i18next";
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
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">{t("notifLoading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-destructive">
          {t("notifFailed", {
            message: error instanceof Error ? error.message : t("notifUnknownError"),
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">
        {t("notifTitle")}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("notifHelp")}
      </p>

      <div className="space-y-3">
        {PREF_ROWS.map(({ key, labelKey, descriptionKey }) => {
          const enabled = data?.[key] ?? true;

          return (
            <div
              key={key}
              className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-secondary/50 transition-colors"
            >
              {/* Toggle */}
              <button
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
                    "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                    enabled ? "translate-x-4" : "translate-x-0",
                  ].join(" ")}
                />
              </button>

              {/* Label + Description */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{t(labelKey)}</p>
                <p className="text-xs text-muted-foreground">{t(descriptionKey)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
