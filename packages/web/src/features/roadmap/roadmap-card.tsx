import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { useI18n } from "@/hooks/use-i18n";

/** Color classes for each roadmap status. */
const STATUS_COLORS: Record<RoadmapStatus, string> = {
  idea: "bg-gray-100 text-gray-600",
  planned: "bg-blue-50 text-blue-600",
  in_progress: "bg-amber-50 text-amber-600",
  done: "bg-emerald-50 text-emerald-600",
};

/** Effort/impact color intensity based on value (1-5). */
const SCORE_COLORS: Record<number, string> = {
  1: "bg-gray-100 text-gray-500",
  2: "bg-blue-50 text-blue-500",
  3: "bg-blue-100 text-blue-600",
  4: "bg-orange-100 text-orange-600",
  5: "bg-red-100 text-red-600",
};

function scoreBadgeClass(value: number): string {
  return SCORE_COLORS[value] ?? SCORE_COLORS[3] ?? "bg-blue-100 text-blue-600";
}

interface RoadmapCardProps {
  item: RoadmapItem;
  onSelect?: (id: string) => void;
}

export function RoadmapCard({ item, onSelect }: RoadmapCardProps) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  const handleClick = () => {
    if (!isDragging && onSelect) {
      onSelect(item.id);
    }
  };

  const statusLabel =
    item.status === "idea"
      ? t("roadmap.status.idea")
      : item.status === "planned"
        ? t("roadmap.status.planned")
        : item.status === "in_progress"
          ? t("roadmap.status.inProgress")
          : t("roadmap.status.done");

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`roadmap-card-${item.id}`}
      onClick={handleClick}
      className={`rounded-md bg-surface-container-lowest p-4
        cursor-grab active:cursor-grabbing
        hover:bg-primary-fixed/20 transition-all duration-200 ease-out
        animate-fade-in
        ${isDragging ? "opacity-50 scale-[1.02] shadow-[var(--shadow-drag)]" : ""}
        ${item.status === "done" && !isDragging ? "opacity-60" : ""}`}
    >
      {/* Top row: effort + impact badges */}
      <div className="flex items-center gap-1.5">
        {item.effort != null && (
          <span
            className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold ${scoreBadgeClass(item.effort)}`}
            title={`${t("roadmap.card.effortTitle")}: ${item.effort}/5`}
          >
            E{item.effort}
          </span>
        )}
        {item.impact != null && (
          <span
            className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold ${scoreBadgeClass(item.impact)}`}
            title={`${t("roadmap.card.impactTitle")}: ${item.impact}/5`}
          >
            I{item.impact}
          </span>
        )}
        <span
          className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_COLORS[item.status]}`}
          title={`${t("roadmap.card.statusTitle")}: ${statusLabel}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Title */}
      <p className="text-[0.875rem] font-medium text-on-surface leading-snug line-clamp-2 mt-4">
        {item.title}
      </p>

      {/* Bottom row: labels */}
      {item.labels.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-4">
          {item.labels.slice(0, 4).map((label) => (
            <span
              key={label}
              className="text-[0.6875rem] uppercase tracking-wider px-1.5 py-0.5 rounded-md outline outline-1 outline-outline-variant/20 text-on-surface/60 font-medium"
            >
              {label}
            </span>
          ))}
          {item.labels.length > 4 && (
            <span className="text-[0.6875rem] text-on-surface/50">
              +{item.labels.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
