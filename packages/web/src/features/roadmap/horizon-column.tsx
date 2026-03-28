import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Horizon } from "@/types/roadmap";
import type { RoadmapItem } from "@/types/roadmap";
import { HORIZON_LABELS, HORIZON_PILL_COLORS } from "@/stores/roadmap-store";
import { RoadmapCard } from "./roadmap-card";

interface HorizonColumnProps {
  horizon: Horizon;
  items: RoadmapItem[];
  onSelectItem?: (id: string) => void;
  onAddItem?: (horizon: Horizon) => void;
}

export function HorizonColumn({
  horizon,
  items,
  onSelectItem,
  onAddItem,
}: HorizonColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: horizon });

  return (
    <div
      data-testid={`horizon-column-${horizon}`}
      className={`flex flex-col w-72 min-w-[18rem] shrink-0 rounded-md bg-surface-container-low
        transition-all duration-200 ease-out
        ${isOver ? "bg-primary-fixed/20" : ""}`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-[3px] h-4 rounded-full ${HORIZON_PILL_COLORS[horizon]}`}
            aria-hidden="true"
          />
          <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-on-surface/60">
            {HORIZON_LABELS[horizon]}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-primary-container text-on-primary-container text-[10px] font-semibold tabular-nums">
            {items.length}
          </span>
          {onAddItem && (
            <button
              type="button"
              onClick={() => onAddItem(horizon)}
              className="text-on-surface/40 hover:text-on-surface transition-colors"
              aria-label={`Add item to ${HORIZON_LABELS[horizon]}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
              >
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Droppable area with sorted cards */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-3 px-2 pb-3 overflow-y-auto flex-1 min-h-[4rem]"
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <RoadmapCard key={item.id} item={item} onSelect={onSelectItem} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
