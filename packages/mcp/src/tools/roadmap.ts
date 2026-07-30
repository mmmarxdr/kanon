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
import { formatList, formatEntity, formatAck, type Format } from "../transforms.js";
import { resolveProjectKey } from "../binding-resolver.js";
import type { InvalidBinding } from "../binding-resolver.js";
import type { KanonBinding } from "../kanon-binding.js";

export function registerRoadmapTools(server: McpServer, client: KanonClient, binding: KanonBinding | InvalidBinding | null = null): void {
  server.tool(
    "list_roadmap",
    "List roadmap items for projectKey with filters (horizon,status,label). Returns compact list.",
    ListRoadmapInput.shape,
    async ({ projectKey, horizon, status, label, format, limit, offset }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));

        const filters: Record<string, string> = {};
        if (horizon) filters["horizon"] = horizon;
        if (status) filters["status"] = status;
        if (label) filters["label"] = label;

        const items = await client.listRoadmap(resolved.projectKey, filters);
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
    "create_roadmap_item",
    "Create roadmap item (title,horizon,status,effort,impact,labels,targetDate). Returns ack {ok,id,status}; format:'full' for entity.",
    CreateRoadmapItemInput.shape,
    async ({ projectKey, title, description, horizon, status, effort, impact, labels, sortOrder, targetDate, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));

        const body: Record<string, unknown> = { title };
        if (description !== undefined) body["description"] = description;
        if (horizon !== undefined) body["horizon"] = horizon;
        if (status !== undefined) body["status"] = status;
        if (effort !== undefined) body["effort"] = effort;
        if (impact !== undefined) body["impact"] = impact;
        if (labels !== undefined) body["labels"] = labels;
        if (sortOrder !== undefined) body["sortOrder"] = sortOrder;
        if (targetDate !== undefined) body["targetDate"] = targetDate;

        const item = await client.createRoadmapItem(resolved.projectKey, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(item, "roadmap-item"));
        return dataResult(formatEntity(item, "roadmap-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── Write Tools ────────────────────────────────────────────────────────

  server.tool(
    "update_roadmap_item",
    "Update roadmap item fields (itemId,title,horizon,status,effort,impact,labels,targetDate). Returns ack {ok,id,status}; format:'full' for entity.",
    UpdateRoadmapItemInput.shape,
    async ({ projectKey, itemId, title, description, horizon, status, effort, impact, labels, sortOrder, targetDate, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
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

        const item = await client.updateRoadmapItem(resolved.projectKey, itemId, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(item, "roadmap-item"));
        return dataResult(formatEntity(item, "roadmap-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "delete_roadmap_item",
    "Delete roadmap item (projectKey,itemId). Returns {deleted:true,itemId}.",
    DeleteRoadmapItemInput.shape,
    async ({ projectKey, itemId }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        await client.deleteRoadmapItem(resolved.projectKey, itemId);
        return dataResult({ deleted: true, itemId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "promote_roadmap_item",
    "Promote roadmap item to issue (itemId,title,type,priority,labels,groupKey). Returns ack {ok,id,key}; format:'full' for entity.",
    PromoteRoadmapItemInput.shape,
    async ({ projectKey, itemId, title, type, priority, labels, groupKey, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const body: Record<string, unknown> = {};
        if (title !== undefined) body["title"] = title;
        if (type !== undefined) body["type"] = type;
        if (priority !== undefined) body["priority"] = priority;
        if (labels !== undefined) body["labels"] = labels;
        if (groupKey !== undefined) body["groupKey"] = groupKey;

        const issue = await client.promoteRoadmapItem(resolved.projectKey, itemId, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(issue, "issue"));
        return dataResult(formatEntity(issue, "issue-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── Dependency Tools ──────────────────────────────────────────────────

  server.tool(
    "add_dependency",
    "Add dependency: source blocks target. Errors if circular. Returns ack {ok,id,projectId}; format:'full' for entity.",
    AddDependencyInput.shape,
    async ({ projectKey, sourceItemId, targetItemId, type, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const body: Record<string, unknown> = { targetId: targetItemId };
        if (type !== undefined) body["type"] = type;

        const dep = await client.addDependency(resolved.projectKey, sourceItemId, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(dep, "issue-dependency"));
        return dataResult(dep);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "remove_dependency",
    "Remove dependency (projectKey,sourceItemId,dependencyId). Returns {ok,deleted,dependencyId}.",
    RemoveDependencyInput.shape,
    async ({ projectKey, sourceItemId, dependencyId }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        await client.removeDependency(resolved.projectKey, sourceItemId, dependencyId);
        return dataResult({ ok: true, deleted: true, dependencyId });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
