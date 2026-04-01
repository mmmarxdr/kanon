import type { RoadmapStatus, Horizon } from "@/types/roadmap";
import { useI18n } from "@/hooks/use-i18n";

interface TooltipPayloadItem {
  payload?: {
    name?: string;
    createdAt?: string;
    targetDate?: string | null;
    status?: RoadmapStatus;
    horizon?: Horizon;
  };
}

interface TimelineTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Custom recharts tooltip for timeline bars.
 * Shows title, created date, target date (or "No target date"), status badge, horizon badge.
 * Option A styling: bg-surface-container-lowest, rounded-md, shadow-float, no border.
 */
export function TimelineTooltip({ active, payload }: TimelineTooltipProps) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  if (!entry?.payload) return null;

  const d = entry.payload;

  return (
    <div className="bg-surface-container-lowest rounded-md shadow-float p-3 text-xs text-on-surface min-w-[180px]">
      <p className="font-semibold text-sm mb-1.5">{d.name}</p>

      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">{t("roadmap.timeline.tooltip.created")}</span>
          <span>{d.createdAt ? formatDate(d.createdAt) : "\u2014"}</span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">{t("roadmap.timeline.tooltip.target")}</span>
          <span>{d.targetDate ? formatDate(d.targetDate) : t("roadmap.timeline.tooltip.noTargetDate")}</span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">{t("roadmap.timeline.tooltip.status")}</span>
          <span className="font-medium">
            {d.status
              ? d.status === "idea"
                ? t("roadmap.status.idea")
                : d.status === "planned"
                  ? t("roadmap.status.planned")
                  : d.status === "in_progress"
                    ? t("roadmap.status.inProgress")
                    : t("roadmap.status.done")
              : "\u2014"}
          </span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">{t("roadmap.timeline.tooltip.horizon")}</span>
          <span className="font-medium">
            {d.horizon
              ? d.horizon === "now"
                ? t("roadmap.horizon.now")
                : d.horizon === "next"
                  ? t("roadmap.horizon.next")
                  : d.horizon === "later"
                    ? t("roadmap.horizon.later")
                    : t("roadmap.horizon.someday")
              : "\u2014"}
          </span>
        </div>
      </div>
    </div>
  );
}
