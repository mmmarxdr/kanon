import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import * as dagre from "@dagrejs/dagre";
import type { RoadmapItem } from "@/types/roadmap";
import { RoadmapNode } from "./roadmap-node";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

const nodeTypes = { roadmapNode: RoadmapNode };

interface GraphViewProps {
  items: RoadmapItem[];
  onSelectItem: (id: string) => void;
}

/**
 * Convert roadmap items into a Dagre-laid-out set of React Flow nodes and edges.
 */
function layoutGraph(
  items: RoadmapItem[],
  onSelectItem: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  if (items.length === 0) {
    return { nodes: [], edges: [] };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 120 });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  for (const item of items) {
    g.setNode(item.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges from blocks relationships
  const edges: Edge[] = [];
  for (const item of items) {
    for (const dep of item.blocks ?? []) {
      // Only add edge if target node exists in our set
      if (g.hasNode(dep.targetId)) {
        g.setEdge(item.id, dep.targetId);
        edges.push({
          id: dep.id,
          source: item.id,
          target: dep.targetId,
          animated: true,
          style: { stroke: "var(--color-primary, #6366f1)", strokeWidth: 2 },
          markerEnd: {
            type: "arrowclosed" as const,
            color: "var(--color-primary, #6366f1)",
          },
        });
      }
    }
  }

  // Run layout
  dagre.layout(g);

  // Map to React Flow nodes
  const nodes: Node[] = items.map((item) => {
    const nodeWithPosition = g.node(item.id);
    return {
      id: item.id,
      type: "roadmapNode",
      position: {
        x: (nodeWithPosition?.x ?? 0) - NODE_WIDTH / 2,
        y: (nodeWithPosition?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: { ...item, onSelect: onSelectItem },
    };
  });

  return { nodes, edges };
}

export default function GraphView({ items, onSelectItem }: GraphViewProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutGraph(items, onSelectItem),
    [items, onSelectItem],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const hasDependencies = useMemo(
    () => items.some((item) => (item.blocks ?? []).length > 0 || (item.dependsOn ?? []).length > 0),
    [items],
  );

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground text-sm">
          No roadmap items to display.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {!hasDependencies && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2 shadow-sm">
          <p className="text-sm text-muted-foreground">
            No dependencies yet. Open an item and add dependencies to see
            connections here.
          </p>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="!bg-card !border-border !shadow-sm [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground" />
        <MiniMap
          className="!bg-card !border-border"
          nodeColor="var(--color-primary, #6366f1)"
          maskColor="rgba(0,0,0,0.1)"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="var(--color-muted-foreground, #94a3b8)"
          style={{ opacity: 0.3 }}
        />
      </ReactFlow>
    </div>
  );
}
