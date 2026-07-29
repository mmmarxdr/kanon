import type {
  CanonicalCycle,
  CanonicalIssue,
  CanonicalIssuePatch,
  CanonicalProject,
  PmProviderAdapter,
  PushResult,
  StatusWriteMap,
} from "../../core/types.js";
import { RedmineHttpError, type RedmineHttpClient } from "./http-client.js";

type ExternalEntityType = "project" | "cycle" | "issue" | "user";
type HttpClient = Pick<RedmineHttpClient, "get" | "post" | "put">;

interface RedmineProviderOptions {
  writeMap: StatusWriteMap;
  resolveExternalId(type: ExternalEntityType, localId: string): Promise<string | null>;
  warn?(context: unknown, message: string): void;
}

type RemoteRef = { id: string | number; name?: string };
type RemoteIssue = { id: string | number; status?: RemoteRef; updated_on?: string };

const externalId = (value: string | number) => String(value);
const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const remoteDate = (value?: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null;
const result = (id: string, remoteVersion: string | null = null): PushResult => ({
  externalId: id,
  requestedStatusId: null,
  achievedStatusId: null,
  remoteVersion,
});

function identifier(name: string, fallbackId: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || `kanon-${fallbackId.slice(0, 20).toLowerCase()}`
  );
}

function issueDescription(description: string | null, issueId: string): string {
  const marker = `<!-- kanon-issue:${issueId} -->`;
  const text = (description ?? "").replaceAll(marker, "").trimEnd();
  return text ? `${text}\n\n${marker}` : marker;
}

export class RedmineProviderAdapter implements PmProviderAdapter {
  constructor(
    private readonly client: HttpClient,
    private readonly options: RedmineProviderOptions,
  ) {}

  async capabilities() {
    return { canCreateProjects: true, canCreateCycles: true, canCreateIssues: true } as const;
  }

  async listProjects() {
    // ponytail: one page covers the known 46-project instance; paginate if it exceeds 100.
    const response = await this.client.get<{ projects: RemoteRef[] }>("/projects.json?limit=100");
    return response.projects.map((project) => ({ id: externalId(project.id), name: project.name ?? "" }));
  }

  async listStatuses() {
    const response = await this.client.get<{ issue_statuses: RemoteRef[] }>("/issue_statuses.json");
    return response.issue_statuses.map((status) => ({
      id: externalId(status.id),
      name: status.name ?? "",
      writable: true,
    }));
  }

  async listCycles(projectId: string) {
    const response = await this.client.get<{
      versions: Array<RemoteRef & { due_date?: string | null }>;
    }>(`/projects/${encodeURIComponent(projectId)}/versions.json`);
    return response.versions.map((version) => ({
      id: externalId(version.id),
      name: version.name ?? "",
      startDate: null,
      endDate: remoteDate(version.due_date),
    }));
  }

  async listTrackers() {
    const response = await this.client.get<{ trackers: RemoteRef[] }>("/trackers.json");
    return response.trackers.map((tracker) => ({ id: externalId(tracker.id), name: tracker.name ?? "" }));
  }

  async whoAmI() {
    const response = await this.client.get<{
      user: RemoteRef & { firstname?: string; lastname?: string; login?: string | null };
    }>("/my/account.json");
    const displayName = [response.user.firstname, response.user.lastname].filter(Boolean).join(" ");
    return {
      id: externalId(response.user.id),
      displayName: displayName || response.user.name || response.user.login || "",
      login: response.user.login ?? null,
    };
  }

  async ensureProject(project: CanonicalProject): Promise<PushResult> {
    const existing = (await this.listProjects()).find((remote) => remote.name === project.name);
    if (existing) return result(existing.id);

    const response = await this.client.post<{
      project: RemoteRef & { updated_on?: string };
    }>("/projects.json", {
      project: {
        name: project.name,
        identifier: identifier(project.name, project.id),
        description: project.description ?? "",
        is_public: false,
      },
    });
    return result(externalId(response.project.id), response.project.updated_on ?? null);
  }

  async ensureCycle(cycle: CanonicalCycle): Promise<PushResult> {
    const projectId = await this.requireExternalId("project", cycle.projectId);
    const existing = (await this.listCycles(projectId)).find((remote) => remote.name === cycle.name);
    if (existing) return result(existing.id);

    const start = dateOnly(cycle.startDate);
    const response = await this.client.post<{
      version: RemoteRef & { updated_on?: string };
    }>(`/projects/${encodeURIComponent(projectId)}/versions.json`, {
      version: {
        name: cycle.name,
        due_date: dateOnly(cycle.endDate),
        description: [start && `Kanon start: ${start}`, `<!-- kanon-cycle:${cycle.id} -->`]
          .filter(Boolean)
          .join("\n"),
      },
    });
    return result(externalId(response.version.id), response.version.updated_on ?? null);
  }

  async pushIssue(issue: CanonicalIssue, patch: CanonicalIssuePatch): Promise<PushResult> {
    const currentId = await this.options.resolveExternalId("issue", issue.id);
    const creating = currentId === null;
    const payload = await this.issuePayload(issue, patch, creating);
    const requestedStatus = payload["status_id"];
    const requestedStatusId = requestedStatus == null ? null : String(requestedStatus);
    let id = currentId;

    try {
      if (creating) {
        const response = await this.client.post<{ issue: RemoteIssue }>("/issues.json", {
          issue: payload,
        });
        id = externalId(response.issue.id);
      } else {
        await this.client.put(`/issues/${encodeURIComponent(currentId)}.json`, { issue: payload });
      }
    } catch (error) {
      if (!(error instanceof RedmineHttpError) || error.statusCode !== 422 || !requestedStatusId) {
        throw error;
      }
      const { status_id: _rejected, ...withoutStatus } = payload;
      this.options.warn?.({ issueId: issue.id, requestedStatusId }, "Redmine rejected status transition");
      if (creating) {
        const response = await this.client.post<{ issue: RemoteIssue }>("/issues.json", {
          issue: withoutStatus,
        });
        id = externalId(response.issue.id);
      } else {
        await this.client.put(`/issues/${encodeURIComponent(currentId)}.json`, {
          issue: withoutStatus,
        });
      }
    }

    if (!id) throw new Error("Redmine issue response did not include an ID");
    const observed = await this.client.get<{ issue: RemoteIssue }>(
      `/issues/${encodeURIComponent(id)}.json`,
    );
    return {
      externalId: id,
      requestedStatusId,
      achievedStatusId: observed.issue.status ? externalId(observed.issue.status.id) : null,
      remoteVersion: observed.issue.updated_on ?? null,
    };
  }

  private async issuePayload(issue: CanonicalIssue, patch: CanonicalIssuePatch, creating: boolean) {
    const payload: Record<string, string | number | null> = {};
    const value = <T>(field: { kind: string; value?: T }, current: T | null) =>
      creating ? current : field.kind === "set" ? field.value : field.kind === "clear" ? null : undefined;
    const assign = (key: string, mapped: unknown) => {
      if (mapped !== undefined) payload[key] = mapped as string | number | null;
    };

    assign("subject", value(patch.title, issue.title));
    const description = value(patch.description, issue.description);
    if (description !== undefined) payload["description"] = issueDescription(description, issue.id);
    const status = value(patch.status, issue.status);
    if (status) {
      const mappedStatus = this.options.writeMap[status];
      if (mappedStatus === undefined) throw new Error(`Missing Redmine status mapping for ${status}`);
      assign("status_id", mappedStatus);
    }
    assign("estimated_hours", value(patch.estimateHours, issue.estimateHours));
    const startDate = value(patch.startDate, issue.startDate);
    if (startDate !== undefined) payload["start_date"] = dateOnly(startDate);
    const dueDate = value(patch.dueDate, issue.dueDate);
    if (dueDate !== undefined) payload["due_date"] = dateOnly(dueDate);
    assign("done_ratio", value(patch.progress, issue.progress));

    const assignee = value(patch.assignee, issue.assignee);
    if (assignee !== undefined) {
      payload["assigned_to_id"] = assignee
        ? await this.requireExternalId("user", assignee.id)
        : null;
    }
    const cycleId = value(patch.cycleId, issue.cycleId);
    if (cycleId !== undefined) {
      payload["fixed_version_id"] = cycleId
        ? await this.requireExternalId("cycle", cycleId)
        : null;
    }
    if (creating) payload["project_id"] = await this.requireExternalId("project", issue.projectId);
    return payload;
  }

  private async requireExternalId(type: ExternalEntityType, localId: string): Promise<string> {
    const id = await this.options.resolveExternalId(type, localId);
    if (!id) throw new Error(`Missing Redmine ${type} mapping`);
    return id;
  }
}
