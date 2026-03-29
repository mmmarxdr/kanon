// ─── Roadmap Tools ──────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import {
  ListRoadmapInput,
  CreateRoadmapItemInput,
  UpdateRoadmapItemInput,
  DeleteRoadmapItemInput,
  PromoteRoadmapItemInput,
  AddDependencyInput,
  RemoveDependencyInput,
} from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList, formatEntity, type Format } from "../transforms.js";

export function registerRoadmapTools(server: McpServer, client: KanonClient): void {
  server.tool(
    "kanon_list_roadmap",
    "List roadmap items in a Kanon project with optional filters",
    ListRoadmapInput.shape,
    async ({ projectKey, horizon, status, label, format, limit, offset }) => {
      try {
        const filters: Record<string, string> = {};
        if (horizon) filters["horizon"] = horizon;
        if (status) filters["status"] = status;
        if (label) filters["label"] = label;

        const items = await client.listRoadmap(projectKey, filters);
        const result = formatList(
          items as unknown[],
          "roadmap",
          (format ?? "compact") as Format,
          limit ?? 20,
          offset ?? 0,
        );
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_create_roadmap_item",
    "Create a new roadmap item in a Kanon project",
    CreateRoadmapItemInput.shape,
    async ({ projectKey, title, description, horizon, status, effort, impact, labels, sortOrder, targetDate, format }) => {
      try {
        const body: Record<string, unknown> = { title };
        if (description !== undefined) body["description"] = description;
        if (horizon !== undefined) body["horizon"] = horizon;
        if (status !== undefined) body["status"] = status;
        if (effort !== undefined) body["effort"] = effort;
        if (impact !== undefined) body["impact"] = impact;
        if (labels !== undefined) body["labels"] = labels;
        if (sortOrder !== undefined) body["sortOrder"] = sortOrder;
        if (targetDate !== undefined) body["targetDate"] = targetDate;

        const item = await client.createRoadmapItem(projectKey, body);
        return dataResult(formatEntity(item, "roadmap-write", (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── Write Tools ────────────────────────────────────────────────────────

  server.tool(
    "kanon_update_roadmap_item",
    "Update fields of an existing roadmap item",
    UpdateRoadmapItemInput.shape,
    async ({ projectKey, itemId, title, description, horizon, status, effort, impact, labels, sortOrder, targetDate, format }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body["title"] = title;
        if (description !== undefined) body["description"] = description;
        if (horizon !== undefined) body["horizon"] = horizon;
        if (status !== undefined) body["status"] = status;
        if (effort !== undefined) body["effort"] = effort;
        if (impact !== undefined) body["impact"] = impact;
        if (labels !== undefined) body["labels"] = labels;
        if (sortOrder !== undefined) body["sortOrder"] = sortOrder;
        if (targetDate !== undefined) body["targetDate"] = targetDate;

        const item = await client.updateRoadmapItem(projectKey, itemId, body);
        return dataResult(formatEntity(item, "roadmap-write", (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_delete_roadmap_item",
    "Delete a roadmap item from a Kanon project",
    DeleteRoadmapItemInput.shape,
    async ({ projectKey, itemId }) => {
      try {
        await client.deleteRoadmapItem(projectKey, itemId);
        return dataResult({ deleted: true, itemId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_promote_roadmap_item",
    "Promote a roadmap item to a full Kanon issue",
    PromoteRoadmapItemInput.shape,
    async ({ projectKey, itemId, title, type, priority, labels, groupKey }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body["title"] = title;
        if (type !== undefined) body["type"] = type;
        if (priority !== undefined) body["priority"] = priority;
        if (labels !== undefined) body["labels"] = labels;
        if (groupKey !== undefined) body["groupKey"] = groupKey;

        const issue = await client.promoteRoadmapItem(projectKey, itemId, body);
        return dataResult(formatEntity(issue, "issue-write"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── Dependency Tools ──────────────────────────────────────────────────

  server.tool(
    "kanon_add_dependency",
    "Add a dependency between two roadmap items (source blocks target). Returns the created dependency or an error if a cycle would be created.",
    AddDependencyInput.shape,
    async ({ projectKey, sourceItemId, targetItemId, type }) => {
      try {
        const body: Record<string, unknown> = { targetId: targetItemId };
        if (type !== undefined) body["type"] = type;

        const dep = await client.addDependency(projectKey, sourceItemId, body);
        return dataResult({ id: (dep as Record<string, unknown>)["id"], type: (dep as Record<string, unknown>)["type"] ?? "blocks" });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_remove_dependency",
    "Remove a dependency from a roadmap item",
    RemoveDependencyInput.shape,
    async ({ projectKey, sourceItemId, dependencyId }) => {
      try {
        await client.removeDependency(projectKey, sourceItemId, dependencyId);
        return dataResult({ deleted: true, dependencyId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
