import { useState, useCallback, useMemo } from "react";
import { createRoute, redirect, Link } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { useRoadmapQuery } from "@/features/roadmap/use-roadmap-query";
import { RoadmapBoard } from "@/features/roadmap/roadmap-board";
import { RoadmapProposalBanner } from "@/features/roadmap/proposal-banner";
import { RoadmapDetail } from "@/features/roadmap/roadmap-detail";
import { RoadmapFilterBar } from "@/features/roadmap/roadmap-filter-bar";
import { NewRoadmapItemModal } from "@/features/roadmap/new-roadmap-item-modal";
import { AnalyticsDashboard } from "@/features/roadmap/analytics/analytics-dashboard";
import { GanttTimeline } from "@/features/roadmap/timeline/gantt-timeline";
import { useRoadmapStore, type ViewMode } from "@/stores/roadmap-store";
import type { Horizon } from "@/types/roadmap";
import { Segmented } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

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
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});

function RoadmapPage() {
  const { projectKey } = roadmapRoute.useParams();
  const { data: items, isLoading, error } = useRoadmapQuery(projectKey);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItemHorizon, setNewItemHorizon] = useState<Horizon>("later");

  const activeStatusFilter = useRoadmapStore((s) => s.activeStatusFilter);
  const activeHorizonFilter = useRoadmapStore((s) => s.activeHorizonFilter);
  const search = useRoadmapStore((s) => s.search);
  const viewMode = useRoadmapStore((s) => s.viewMode);
  const setViewMode = useRoadmapStore((s) => s.setViewMode);

  const VIEW_MODE_OPTIONS: { id: Exclude<ViewMode, "graph">; label: string }[] = [
    { id: "board", label: "Horizons" },
    { id: "timeline", label: "Timeline" },
    { id: "analytics", label: "Analytics" },
  ];

  const effectiveViewMode: Exclude<ViewMode, "graph"> =
    viewMode === "graph" ? "board" : viewMode;

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
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        Loading roadmap…
      </div>
    );
  }

  if (!projectKey) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        <p>No project selected.</p>
        <Link to="/" style={{ color: "var(--accent-ink)" }}>
          Go to project selection
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--bad)",
          fontSize: 12,
        }}
      >
        Failed to load roadmap: {error.message}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <Segmented<Exclude<ViewMode, "graph">>
          value={effectiveViewMode}
          options={VIEW_MODE_OPTIONS}
          onChange={(v) => setViewMode(v)}
        />
        <Link
          to="/dependencies/$projectKey"
          params={{ projectKey }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 8px",
            border: "1px solid var(--line)",
            borderRadius: 4,
            background: "var(--panel)",
            color: "var(--ink-2)",
            fontSize: 12,
          }}
        >
          <Icon.Graph /> Open dependency graph
        </Link>
        <button
          type="button"
          onClick={() => {
            setNewItemHorizon("later");
            setShowNewItem(true);
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 26,
            padding: "0 10px",
            background: "var(--accent)",
            color: "var(--btn-ink)",
            border: "none",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <Icon.Plus /> New item
        </button>

        <div style={{ flex: 1 }} />

        <RoadmapFilterBar
          filteredCount={filteredItems.length}
          totalCount={items?.length ?? 0}
        />
      </div>

      {effectiveViewMode === "board" && (
        <RoadmapProposalBanner projectKey={projectKey} />
      )}

      <div style={{ flex: 1, overflow: "hidden" }}>
        {effectiveViewMode === "board" ? (
          <RoadmapBoard
            items={filteredItems}
            projectKey={projectKey}
            onSelectItem={handleSelectItem}
            onAddItem={handleAddItem}
          />
        ) : effectiveViewMode === "timeline" ? (
          <GanttTimeline items={filteredItems} />
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
