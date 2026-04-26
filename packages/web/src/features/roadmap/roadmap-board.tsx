import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Horizon, RoadmapItem } from "@/types/roadmap";
import { HORIZONS } from "@/stores/roadmap-store";
import type { HorizonDndVars } from "./use-roadmap-query";
import { useHorizonDndMutation } from "./use-roadmap-query";
import { HorizonColumn } from "./horizon-column";
import { RoadmapCard } from "./roadmap-card";

interface RoadmapBoardProps {
  items: RoadmapItem[];
  projectKey: string;
  onSelectItem?: (id: string) => void;
  onAddItem?: (horizon: Horizon) => void;
}

/**
 * Groups roadmap items by horizon into a Map.
 * Every horizon gets an entry (possibly empty) so columns always render.
 */
export function groupByHorizon(items: RoadmapItem[]): Map<Horizon, RoadmapItem[]> {
  const grouped = new Map<Horizon, RoadmapItem[]>();

  for (const h of HORIZONS) {
    grouped.set(h, []);
  }

  for (const item of items) {
    const bucket = grouped.get(item.horizon);
    if (bucket) {
      bucket.push(item);
    }
  }

  // Sort each bucket by sortOrder ASC, then createdAt DESC
  for (const [, bucket] of grouped) {
    bucket.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  return grouped;
}

/**
 * Pure computation for handleDragEnd.
 * Returns the mutation vars to fire, or `null` when the drop is a no-op.
 *
 * @param activeId  - id of the dragged card
 * @param overId    - id of the drop target (horizon string or card UUID)
 * @param items     - flat list of all roadmap items
 * @param grouped   - items grouped by horizon (pre-sorted)
 */
export function computeDragResult(
  activeId: string,
  overId: string,
  items: RoadmapItem[],
  grouped: Map<Horizon, RoadmapItem[]>,
): HorizonDndVars | null {
  const item = items.find((i) => i.id === activeId);
  if (!item) return null;

  let targetHorizon: Horizon;
  if ((HORIZONS as readonly string[]).includes(overId)) {
    targetHorizon = overId as Horizon;
  } else {
    const overItem = items.find((i) => i.id === overId);
    if (!overItem) return null;
    targetHorizon = overItem.horizon;
  }

  const targetItems = grouped.get(targetHorizon) ?? [];
  let newSortOrder: number;

  if (item.horizon === targetHorizon) {
    const overItem = items.find((i) => i.id === overId);
    if (!overItem) return null;

    const fromIndex = targetItems.findIndex((i) => i.id === item.id);
    const toIndex = targetItems.findIndex((i) => i.id === overItem.id);
    if (fromIndex === toIndex) return null;

    const filtered = targetItems.filter((i) => i.id !== item.id);
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    const before = filtered[insertAt - 1]?.sortOrder ?? 0;
    const after = filtered[insertAt]?.sortOrder ?? before + 2;
    newSortOrder = (before + after) / 2;
  } else {
    const maxSortOrder = targetItems.reduce(
      (max, i) => Math.max(max, i.sortOrder),
      0,
    );
    newSortOrder = maxSortOrder + 1;
  }

  return { itemId: item.id, horizon: targetHorizon, sortOrder: newSortOrder };
}

export function RoadmapBoard({
  items,
  projectKey,
  onSelectItem,
  onAddItem,
}: RoadmapBoardProps) {
  const grouped = useMemo(() => groupByHorizon(items), [items]);
  const horizonDndMutation = useHorizonDndMutation(projectKey);
  const [activeItem, setActiveItem] = useState<RoadmapItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const itemId = event.active.id as string;
      const found = items.find((i) => i.id === itemId);
      setActiveItem(found ?? null);
    },
    [items],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null);

      const { active, over } = event;
      if (!over) return;

      const result = computeDragResult(
        active.id as string,
        over.id as string,
        items,
        grouped,
      );
      if (!result) return;

      horizonDndMutation.mutate(result);
    },
    [items, grouped, horizonDndMutation],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="kanban-scroll"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(280px, 1fr))",
          gap: 12,
          padding: "12px 16px",
          overflow: "auto",
          height: "100%",
          background: "var(--bg)",
        }}
      >
        {HORIZONS.map((horizon) => (
          <HorizonColumn
            key={horizon}
            horizon={horizon}
            items={grouped.get(horizon) ?? []}
            onSelectItem={onSelectItem}
            onAddItem={onAddItem}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div style={{ boxShadow: "var(--shadow-drag)", borderRadius: 6 }}>
            <RoadmapCard item={activeItem} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
