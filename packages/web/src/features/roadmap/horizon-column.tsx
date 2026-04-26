import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Horizon } from "@/types/roadmap";
import type { RoadmapItem } from "@/types/roadmap";
import {
  HORIZON_LABELS,
  HORIZON_SUB_LABELS,
} from "@/stores/roadmap-store";
import { RoadmapCard } from "./roadmap-card";
import { Icon } from "@/components/ui/icons";

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
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: isOver ? "var(--bg-2)" : "transparent",
        borderRadius: 6,
        transition: "background 120ms",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          padding: "0 4px 8px",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
          {HORIZON_LABELS[horizon]}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
          {HORIZON_SUB_LABELS[horizon]}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {items.length}
        </span>
        {onAddItem && (
          <button
            type="button"
            onClick={() => onAddItem(horizon)}
            style={{ color: "var(--ink-4)" }}
            aria-label={`Add item to ${HORIZON_LABELS[horizon]}`}
          >
            <Icon.Plus />
          </button>
        )}
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          overflow: "auto",
          paddingBottom: 8,
          flex: 1,
          minHeight: 64,
        }}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <RoadmapCard key={item.id} item={item} onSelect={onSelectItem} />
          ))}
        </SortableContext>
        {items.length === 0 && (
          <div
            style={{
              padding: "16px 8px",
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 11,
              border: "1px dashed var(--line)",
              borderRadius: 5,
            }}
          >
            Empty
          </div>
        )}
      </div>
    </div>
  );
}
