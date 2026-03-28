import type { RoadmapStatus, Horizon } from "@/types/roadmap";
import { STATUS_LABELS } from "@/stores/roadmap-store";
import { HORIZON_LABELS } from "@/stores/roadmap-store";

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
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  if (!entry?.payload) return null;

  const d = entry.payload;

  return (
    <div className="bg-surface-container-lowest rounded-md shadow-float p-3 text-xs text-on-surface min-w-[180px]">
      <p className="font-semibold text-sm mb-1.5">{d.name}</p>

      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">Created</span>
          <span>{d.createdAt ? formatDate(d.createdAt) : "\u2014"}</span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">Target</span>
          <span>{d.targetDate ? formatDate(d.targetDate) : "No target date"}</span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">Status</span>
          <span className="font-medium">
            {d.status ? STATUS_LABELS[d.status] : "\u2014"}
          </span>
        </div>

        <div className="flex justify-between gap-4">
          <span className="text-on-surface/60">Horizon</span>
          <span className="font-medium">
            {d.horizon ? HORIZON_LABELS[d.horizon] : "\u2014"}
          </span>
        </div>
      </div>
    </div>
  );
}
