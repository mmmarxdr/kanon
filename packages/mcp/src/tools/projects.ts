// ─── Project & Workspace Tools ──────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import {
  ListProjectsInput,
  GetProjectInput,
  ListWorkspacesInput,
  CreateProjectInput,
  UpdateProjectInput,
} from "../types.js";
import { errorResult, dataResult } from "../errors.js";
import { formatList, formatEntity, formatAck } from "../transforms.js";
import type { Format } from "../transforms.js";
import { resolveProjectKey } from "../binding-resolver.js";
import type { InvalidBinding } from "../binding-resolver.js";
import type { KanonBinding } from "../kanon-binding.js";

export function registerProjectTools(server: McpServer, client: KanonClient, binding: KanonBinding | InvalidBinding | null = null): void {
  // ─── Workspace Tools ────────────────────────────────────────────────────

  server.tool(
    "kanon_list_workspaces",
    "List workspaces visible to the authenticated user. Returns compact list.",
    ListWorkspacesInput.shape,
    async ({ format }) => {
      try {
        const workspaces = await client.listWorkspaces();
        return dataResult(formatList(
          workspaces as unknown[],
          "workspace",
          (format ?? "compact") as Format,
        ));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ─── Project Tools ──────────────────────────────────────────────────────

  server.tool(
    "kanon_list_projects",
    "List projects by workspaceId. Returns compact list.",
    ListProjectsInput.shape,
    async ({ workspaceId, format, limit, offset }) => {
      try {
        const projects = await client.listProjects(workspaceId);
        return dataResult(formatList(projects, "project", (format ?? "compact") as Format, limit, offset));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_get_project",
    "Get project details by projectKey. Returns entity.",
    GetProjectInput.shape,
    async ({ projectKey, format }) => {
      try {
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const project = await client.getProject(resolved.projectKey);
        return dataResult(formatEntity(project, "project", format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_create_project",
    "Create project (workspaceId,key,name,description). Returns ack {ok,id,key,name}; format:'full' for entity.",
    CreateProjectInput.shape,
    async ({ workspaceId, key, name, description, format }) => {
      try {
        const body: { key: string; name: string; description?: string } = { key, name };
        if (description !== undefined) body.description = description;
        const project = await client.createProject(workspaceId, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(project, "project"));
        return dataResult(formatEntity(project, "project-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_update_project",
    "Update project (projectKey,name,description). Returns ack {ok,id,key,name}; format:'full' for entity.",
    UpdateProjectInput.shape,
    async (args) => {
      try {
        const { projectKey, format, ...rest } = args;
        const resolved = resolveProjectKey(projectKey, binding);
        if (!resolved.ok) return errorResult(new Error(resolved.error));
        const body: Record<string, unknown> = {};
        if (rest["name"] !== undefined) body["name"] = rest["name"];
        if (rest["description"] !== undefined) body["description"] = rest["description"];
        const project = await client.updateProject(resolved.projectKey, body);
        const fmt = format ?? "ack";
        if (fmt === "ack") return dataResult(formatAck(project, "project"));
        return dataResult(formatEntity(project, "project-write", fmt as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
