import { useNotificationPreferencesQuery } from "./use-notification-preferences-query";
import { useUpdateNotificationPreferencesMutation } from "./use-update-notification-preferences-mutation";
import type { NotificationPreferenceItem } from "@kanon/shared";

type PrefKey = keyof NotificationPreferenceItem;

const PREF_ROWS: { key: PrefKey; label: string; description: string }[] = [
  {
    key: "emailMention",
    label: "Mentions",
    description: "Receive an email when someone mentions you in a comment.",
  },
  {
    key: "emailAssignment",
    label: "Assignments",
    description: "Receive an email when an issue is assigned to you.",
  },
  {
    key: "emailCycleClosed",
    label: "Cycle closed",
    description: "Receive an email when a cycle you participate in is closed.",
  },
];

export function NotificationPreferencesSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { data, isLoading, error } = useNotificationPreferencesQuery(workspaceId);
  const update = useUpdateNotificationPreferencesMutation(workspaceId);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Loading preferences...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-destructive">
          Failed to load notification preferences:{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground mb-1">
        Email Notifications
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Choose which events trigger email notifications.
      </p>

      <div className="space-y-3">
        {PREF_ROWS.map(({ key, label, description }) => {
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
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
