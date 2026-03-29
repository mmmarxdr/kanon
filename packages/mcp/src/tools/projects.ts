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
import { formatList, formatEntity } from "../transforms.js";
import type { Format } from "../transforms.js";

export function registerProjectTools(server: McpServer, client: KanonClient): void {
  // ─── Workspace Tools ────────────────────────────────────────────────────

  server.tool(
    "kanon_list_workspaces",
    "List all workspaces visible to the authenticated user",
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
    "List all projects in a Kanon workspace",
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
    "Get details of a Kanon project by its key",
    GetProjectInput.shape,
    async ({ projectKey, format }) => {
      try {
        const project = await client.getProject(projectKey);
        return dataResult(formatEntity(project, "project", format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_create_project",
    "Create a new project in a Kanon workspace",
    CreateProjectInput.shape,
    async ({ workspaceId, key, name, description, format }) => {
      try {
        const body: { key: string; name: string; description?: string } = { key, name };
        if (description !== undefined) body.description = description;
        const project = await client.createProject(workspaceId, body);
        return dataResult(formatEntity(project, "project-write", (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "kanon_update_project",
    "Update a Kanon project (name, description, engram namespace)",
    UpdateProjectInput.shape,
    async (args) => {
      try {
        const { projectKey, format, ...rest } = args;
        const body: Record<string, unknown> = {};
        if (rest["name"] !== undefined) body["name"] = rest["name"];
        if (rest["description"] !== undefined) body["description"] = rest["description"];
        if (rest["engramNamespace"] !== undefined) body["engramNamespace"] = rest["engramNamespace"];
        const project = await client.updateProject(projectKey, body);
        return dataResult(formatEntity(project, "project-write", (format ?? "slim") as Format));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
