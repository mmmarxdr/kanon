import { useState, useCallback, useMemo, lazy, Suspense } from "react";
import { createRoute } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { useRoadmapQuery } from "@/features/roadmap/use-roadmap-query";
import { RoadmapBoard } from "@/features/roadmap/roadmap-board";
import { RoadmapDetail } from "@/features/roadmap/roadmap-detail";
import { RoadmapFilterBar } from "@/features/roadmap/roadmap-filter-bar";
import { NewRoadmapItemModal } from "@/features/roadmap/new-roadmap-item-modal";
import { AnalyticsDashboard } from "@/features/roadmap/analytics/analytics-dashboard";
import { GanttTimeline } from "@/features/roadmap/timeline/gantt-timeline";
import { useRoadmapStore, type ViewMode } from "@/stores/roadmap-store";
import type { Horizon, RoadmapItem } from "@/types/roadmap";
import { useCurrentProject } from "@/hooks/use-current-project";

const GraphView = lazy(
  () => import("@/features/roadmap/graph/graph-view"),
);

interface RoadmapSearchParams {
  item?: string;
}

export const roadmapRoute = createRoute({
  path: "/roadmap/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: RoadmapPage,
  validateSearch: (search: Record<string, unknown>): RoadmapSearchParams => ({
    item: typeof search.item === "string" ? search.item : undefined,
  }),
});

function RoadmapPage() {
  const { projectKey } = roadmapRoute.useParams();
  const { project: currentProject } = useCurrentProject();
  const { data: items, isLoading, error } = useRoadmapQuery(projectKey);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItemHorizon, setNewItemHorizon] = useState<Horizon>("later");

  const activeStatusFilter = useRoadmapStore((s) => s.activeStatusFilter);
  const activeHorizonFilter = useRoadmapStore((s) => s.activeHorizonFilter);
  const search = useRoadmapStore((s) => s.search);
  const viewMode = useRoadmapStore((s) => s.viewMode);
  const setViewMode = useRoadmapStore((s) => s.setViewMode);

  const VIEW_MODE_OPTIONS = [
    { label: "Board", value: "board" },
    { label: "Analytics", value: "analytics" },
    { label: "Timeline", value: "timeline" },
    { label: "Graph", value: "graph" },
  ];

  const filteredItems = useMemo(() => {
    if (!items) return [];
    let result = items;
    if (activeStatusFilter) {
      result = result.filter((i) => i.status === activeStatusFilter);
    }
    if (activeHorizonFilter) {
      result = result.filter((i) => i.horizon === activeHorizonFilter);
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((i) => i.title.toLowerCase().includes(lower));
    }
    return result;
  }, [items, activeStatusFilter, activeHorizonFilter, search]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId || !items) return undefined;
    return items.find((i) => i.id === selectedItemId);
  }, [selectedItemId, items]);

  const handleSelectItem = useCallback((id: string) => {
    setSelectedItemId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedItemId(undefined);
  }, []);

  const handleAddItem = useCallback((horizon: Horizon) => {
    setNewItemHorizon(horizon);
    setShowNewItem(true);
  }, []);

  const handleCloseNewItem = useCallback(() => {
    setShowNewItem(false);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">Loading roadmap...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-destructive-foreground">
          Failed to load roadmap: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-surface">
      {/* Top bar */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        {/* Breadcrumb & Title */}
        <div className="mb-3">
          <p className="text-[0.6875rem] text-on-surface/40 uppercase tracking-wider mb-1">
            Workspace &rsaquo; {currentProject?.name ?? projectKey}
          </p>
          <h1 className="text-xl font-semibold text-on-surface">
            {projectKey} &mdash; Roadmap
          </h1>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => {
              setNewItemHorizon("later");
              setShowNewItem(true);
            }}
            className="bg-gradient-to-b from-primary to-primary-hover text-primary-foreground hover:from-primary-hover hover:to-primary-hover rounded px-3 py-1.5 text-sm font-medium transition-all duration-200"
          >
            + New Item
          </button>

          {/* View mode segmented control */}
          <div className="flex items-center gap-1">
            {VIEW_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setViewMode(opt.value as ViewMode)}
                className={`px-2 py-1 text-xs uppercase tracking-wider rounded-md transition-all duration-200 ${
                  viewMode === opt.value
                    ? "bg-primary-fixed/20 text-primary font-semibold"
                    : "text-muted-foreground hover:bg-foreground/5"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <RoadmapFilterBar
            filteredCount={filteredItems.length}
            totalCount={items?.length ?? 0}
          />
        </div>
      </div>

      {/* Main content: Board or Analytics */}
      <div className="flex-1 overflow-hidden px-6">
        {viewMode === "board" ? (
          <RoadmapBoard
            items={filteredItems}
            projectKey={projectKey}
            onSelectItem={handleSelectItem}
            onAddItem={handleAddItem}
          />
        ) : viewMode === "timeline" ? (
          <GanttTimeline items={filteredItems} />
        ) : viewMode === "graph" ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">Loading graph...</p>
              </div>
            }
          >
            <GraphView
              items={filteredItems}
              onSelectItem={handleSelectItem}
            />
          </Suspense>
        ) : (
          <AnalyticsDashboard items={filteredItems} />
        )}
      </div>

      {/* Detail panel */}
      {selectedItem && (
        <RoadmapDetail
          item={selectedItem}
          projectKey={projectKey}
          onClose={handleCloseDetail}
        />
      )}

      {/* New item modal */}
      {showNewItem && (
        <NewRoadmapItemModal
          projectKey={projectKey}
          defaultHorizon={newItemHorizon}
          onClose={handleCloseNewItem}
        />
      )}
    </div>
  );
}
