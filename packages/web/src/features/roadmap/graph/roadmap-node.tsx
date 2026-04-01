import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { HORIZON_PILL_COLORS } from "@/stores/roadmap-store";
import { useI18n } from "@/hooks/use-i18n";

/** Color classes for each roadmap status. */
const STATUS_COLORS: Record<RoadmapStatus, string> = {
  idea: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  planned: "bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300",
  in_progress:
    "bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300",
  done: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const SCORE_COLORS: Record<number, string> = {
  1: "bg-gray-100 text-gray-500",
  2: "bg-blue-50 text-blue-500",
  3: "bg-blue-100 text-blue-600",
  4: "bg-orange-100 text-orange-600",
  5: "bg-red-100 text-red-600",
};

type RoadmapNodeData = RoadmapItem & { onSelect?: (id: string) => void };

function RoadmapNodeComponent({ data }: NodeProps) {
  const { t } = useI18n();
  const item = data as unknown as RoadmapNodeData;
  const statusLabel =
    item.status === "idea"
      ? t("roadmap.status.idea")
      : item.status === "planned"
        ? t("roadmap.status.planned")
        : item.status === "in_progress"
          ? t("roadmap.status.inProgress")
          : t("roadmap.status.done");
  const horizonLabel =
    item.horizon === "now"
      ? t("roadmap.horizon.now")
      : item.horizon === "next"
        ? t("roadmap.horizon.next")
        : item.horizon === "later"
          ? t("roadmap.horizon.later")
          : t("roadmap.horizon.someday");

  const handleClick = () => {
    item.onSelect?.(item.id);
  };

  return (
    <div
      onClick={handleClick}
      className="rounded-lg bg-card border border-border shadow-sm px-3 py-2.5 w-[220px] cursor-pointer
        hover:border-primary/50 hover:shadow-md transition-all duration-200"
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-muted-foreground !border-border"
      />

      {/* Top row: status + horizon */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_COLORS[item.status]}`}
        >
          {statusLabel}
        </span>
        <span
          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold text-white ${HORIZON_PILL_COLORS[item.horizon]}`}
        >
          {horizonLabel}
        </span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
        {item.title}
      </p>

      {/* Effort / Impact */}
      {(item.effort != null || item.impact != null) && (
        <div className="flex items-center gap-1.5 mt-1.5">
          {item.effort != null && (
            <span
              className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold ${SCORE_COLORS[item.effort] ?? "bg-gray-100 text-gray-500"}`}
            >
              E{item.effort}
            </span>
          )}
          {item.impact != null && (
            <span
              className={`inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold ${SCORE_COLORS[item.impact] ?? "bg-gray-100 text-gray-500"}`}
            >
              I{item.impact}
            </span>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-muted-foreground !border-border"
      />
    </div>
  );
}

export const RoadmapNode = memo(RoadmapNodeComponent);
