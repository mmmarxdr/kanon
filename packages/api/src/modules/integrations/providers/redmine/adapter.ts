import {
  ProviderDispatchError,
  isRetryableProviderError,
  type CanonicalCycle,
  type CanonicalIssue,
  type CanonicalIssuePatch,
  type CanonicalProject,
  type CanonicalTimeEntry,
  type PmProviderAdapter,
  type ProviderCreateReconciliationRequest,
  type PushResult,
  type StatusWriteMap,
} from "../../core/types.js";
import { RedmineHttpError, type RedmineHttpClient } from "./http-client.js";

type ExternalEntityType = "project" | "cycle" | "issue" | "time_entry" | "user";
type HttpClient = Pick<RedmineHttpClient, "delete" | "get" | "post" | "put">;

interface RedmineProviderOptions {
  writeMap: StatusWriteMap;
  resolveExternalId(type: ExternalEntityType, localId: string): Promise<string | null>;
  warn?(context: unknown, message: string): void;
}

type RemoteRef = { id: string | number; name?: string };
type RemoteIssue = {
  id: string | number;
  description?: string | null;
  status?: RemoteRef;
  updated_on?: string;
};
type RemoteVersion = RemoteRef & {
  description?: string | null;
  status?: string;
  updated_on?: string;
};
type RemoteTimeEntry = {
  id: string | number;
  comments?: string | null;
  updated_on?: string;
};

const ISSUE_PAGE_SIZE = 100;
const MAX_ISSUE_PAGES = 3;
const MAX_RECONCILIATION_ISSUES = ISSUE_PAGE_SIZE * MAX_ISSUE_PAGES;
const TIME_ENTRY_MARKER = (id: string) => `[kanon-time-entry:${id}]`;

const externalId = (value: string | number) => String(value);
const positiveNumericId = (value: unknown): number | null => {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const dateOnly = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
const remoteDate = (value?: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : null;
const result = (id: string, remoteVersion: string | null = null): PushResult => ({
  externalId: id,
  requestedStatusId: null,
  achievedStatusId: null,
  remoteVersion,
});
const byExternalId = (left: PushResult, right: PushResult) =>
  Number(left.externalId) - Number(right.externalId);

function reconciliationResult(remote: RemoteIssue | RemoteVersion): PushResult {
  const status = remote.status;
  return {
    externalId: externalId(remote.id),
    requestedStatusId: null,
    achievedStatusId: typeof status === "object" && status ? externalId(status.id) : null,
    remoteVersion: remote.updated_on ?? null,
  };
}

function retryableFailure(error: unknown): never {
  if (error instanceof ProviderDispatchError) throw error;
  if (isRetryableProviderError(error)) throw new ProviderDispatchError("retry", error);
  throw error;
}

function writeFailure(error: unknown, creating: boolean): never {
  if (!creating) retryableFailure(error);
  if (error instanceof ProviderDispatchError) throw error;
  if (error instanceof RedmineHttpError) {
    if (error.statusCode === 429) throw new ProviderDispatchError("retry", error);
    if (error.statusCode < 500) throw error;
  }
  throw new ProviderDispatchError("ambiguous", error);
}

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
    private readonly options: RedmineProviderOptions
  ) {}

  async capabilities() {
    return { canCreateProjects: true, canCreateCycles: true, canCreateIssues: true } as const;
  }

  async listProjects() {
    // ponytail: one page covers the known 46-project instance; paginate if it exceeds 100.
    const response = await this.client.get<{ projects: RemoteRef[] }>("/projects.json?limit=100");
    return response.projects.map((project) => ({
      id: externalId(project.id),
      name: project.name ?? "",
    }));
  }

  async listStatuses() {
    const response = await this.client.get<{ issue_statuses: RemoteRef[] }>("/issue_statuses.json");
    return response.issue_statuses.map((status) => ({
      id: externalId(status.id),
      name: status.name ?? "",
      writable: true,
    }));
  }

  async listTimeEntryActivities() {
    const response = await this.client.get<{
      time_entry_activities: Array<RemoteRef & { is_default?: boolean }>;
    }>("/enumerations/time_entry_activities.json");
    return response.time_entry_activities.map((activity) => ({
      id: externalId(activity.id),
      name: activity.name ?? "",
      isDefault: activity.is_default === true,
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
    return response.trackers.map((tracker) => ({
      id: externalId(tracker.id),
      name: tracker.name ?? "",
    }));
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

  async reconcileCreate(
    request: ProviderCreateReconciliationRequest,
  ): Promise<readonly PushResult[]> {
    const marker = `<!-- kanon-${request.entityType}:${request.entityId} -->`;
    const matches = new Map<string, PushResult>();

    if (request.entityType === "time_entry") {
      const query = new URLSearchParams({
        issue_id: request.remoteIssueId,
        from: request.spentOn,
        to: request.spentOn,
        limit: String(ISSUE_PAGE_SIZE),
      });
      let offset = 0;
      for (let pageNumber = 0; pageNumber < MAX_ISSUE_PAGES; pageNumber += 1) {
        query.set("offset", String(offset));
        const page = await this.client.get<{
          time_entries: RemoteTimeEntry[];
          total_count: number;
          offset: number;
          limit: number;
        }>(`/time_entries.json?${query}`);
        if (
          !Array.isArray(page.time_entries) ||
          !Number.isSafeInteger(page.total_count) ||
          page.total_count < 0 ||
          page.total_count > MAX_RECONCILIATION_ISSUES ||
          page.offset !== offset ||
          !Number.isSafeInteger(page.limit) ||
          page.limit < 1 ||
          page.limit > ISSUE_PAGE_SIZE
        ) {
          throw new Error("Malformed Redmine time-entry pagination");
        }
        for (const entry of page.time_entries) {
          if (positiveNumericId(entry.id) === null) {
            throw new Error("Malformed Redmine time-entry response");
          }
          if (entry.comments === TIME_ENTRY_MARKER(request.entityId)) {
            matches.set(
              externalId(entry.id),
              result(externalId(entry.id), entry.updated_on ?? null),
            );
          }
        }
        offset = page.offset + page.limit;
        if (offset >= page.total_count) return [...matches.values()].sort(byExternalId);
      }
      throw new Error("Malformed Redmine time-entry pagination");
    }

    if (request.entityType === "cycle") {
      const response = await this.client.get<{ versions: RemoteVersion[] }>(
        `/projects/${encodeURIComponent(request.remoteProjectId)}/versions.json`,
      );
      if (!Array.isArray(response.versions)) throw new Error("Malformed Redmine versions response");
      for (const version of response.versions) {
        if (typeof version.description !== "string" || !version.description.includes(marker)) {
          continue;
        }
        if (positiveNumericId(version.id) === null) {
          throw new Error("Malformed Redmine version response");
        }
        const match = reconciliationResult(version);
        matches.set(match.externalId, matches.get(match.externalId) ?? match);
      }
      return [...matches.values()].sort(byExternalId);
    }

    let offset = 0;
    let totalCount: number | undefined;
    let pageLimit: number | undefined;
    let lastIssueId = 0;
    for (let pageNumber = 0; pageNumber < MAX_ISSUE_PAGES; pageNumber += 1) {
      const query = new URLSearchParams({
        project_id: request.remoteProjectId,
        status_id: "*",
        sort: "id:asc",
        limit: String(ISSUE_PAGE_SIZE),
        offset: String(offset),
      });
      const page = await this.client.get<{
        issues: RemoteIssue[];
        total_count: number;
        offset: number;
        limit: number;
      }>(`/issues.json?${query}`);
      if (
        !Array.isArray(page.issues) ||
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        !Number.isSafeInteger(page.offset) ||
        page.offset !== offset ||
        !Number.isSafeInteger(page.limit) ||
        page.limit < 1 ||
        page.limit > ISSUE_PAGE_SIZE ||
        page.total_count > MAX_RECONCILIATION_ISSUES ||
        (totalCount !== undefined && page.total_count !== totalCount) ||
        (pageLimit !== undefined && page.limit !== pageLimit)
      ) {
        throw new Error("Malformed or non-advancing Redmine issue pagination");
      }
      totalCount ??= page.total_count;
      pageLimit ??= page.limit;
      if (totalCount > pageLimit * MAX_ISSUE_PAGES) {
        throw new Error("Malformed or non-advancing Redmine issue pagination");
      }
      const expectedCount = Math.min(pageLimit, totalCount - offset);
      if (page.issues.length !== expectedCount) {
        throw new Error("Malformed or non-advancing Redmine issue pagination");
      }
      for (const issue of page.issues) {
        const id = positiveNumericId(issue.id);
        if (id === null || id <= lastIssueId) {
          throw new Error("Malformed or non-advancing Redmine issue pagination");
        }
        lastIssueId = id;
        if (typeof issue.description !== "string" || !issue.description.includes(marker)) continue;
        const match = reconciliationResult(issue);
        matches.set(match.externalId, matches.get(match.externalId) ?? match);
      }
      const nextOffset = page.offset + pageLimit;
      if (nextOffset >= totalCount) return [...matches.values()].sort(byExternalId);
      if (nextOffset <= offset) {
        throw new Error("Malformed or non-advancing Redmine issue pagination");
      }
      offset = nextOffset;
    }
    throw new Error("Malformed or non-advancing Redmine issue pagination");
  }

  async ensureProject(project: CanonicalProject): Promise<PushResult> {
    const knownId = await this.options.resolveExternalId("project", project.id);
    if (knownId) return result(knownId);
    const projects = await this.listProjects().catch((error: unknown) => retryableFailure(error));
    const existing = projects.find((remote) => remote.name === project.name);
    if (existing) return result(existing.id);

    try {
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
    } catch (error) {
      writeFailure(error, true);
    }
  }

  async ensureCycle(cycle: CanonicalCycle): Promise<PushResult> {
    const knownId = await this.options.resolveExternalId("cycle", cycle.id);
    if (knownId) return result(knownId);
    const projectId = await this.requireExternalId("project", cycle.projectId);

    const start = dateOnly(cycle.startDate);
    try {
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
    } catch (error) {
      writeFailure(error, true);
    }
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
        writeFailure(error, creating);
      }
      const { status_id: _rejected, ...withoutStatus } = payload;
      this.options.warn?.(
        { issueId: issue.id, requestedStatusId },
        "Redmine rejected status transition"
      );
      try {
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
      } catch (fallbackError) {
        writeFailure(fallbackError, creating);
      }
    }

    if (!id) throw new Error("Redmine issue response did not include an ID");
    let observed: { issue: RemoteIssue };
    try {
      observed = await this.client.get<{ issue: RemoteIssue }>(
        `/issues/${encodeURIComponent(id)}.json`
      );
    } catch (error) {
      if (creating) throw new ProviderDispatchError("ambiguous", error);
      retryableFailure(error);
    }
    return {
      externalId: id,
      requestedStatusId,
      achievedStatusId: observed.issue.status ? externalId(observed.issue.status.id) : null,
      remoteVersion: observed.issue.updated_on ?? null,
    };
  }

  async pushTimeEntry(entry: CanonicalTimeEntry, activityId: string): Promise<PushResult> {
    const currentId = await this.options.resolveExternalId("time_entry", entry.id);
    if (Number(entry.hours) === 0) {
      if (currentId) {
        try {
          await this.client.delete(`/time_entries/${encodeURIComponent(currentId)}.json`);
        } catch (error) {
          if (!(error instanceof RedmineHttpError) || error.statusCode !== 404) retryableFailure(error);
        }
      }
      return { ...result(currentId ?? ""), deleted: true };
    }

    const remoteIssueId = await this.requireExternalId("issue", entry.issueId);
    const payload = {
      issue_id: remoteIssueId,
      hours: entry.hours,
      activity_id: activityId,
      spent_on: dateOnly(entry.workedOn),
      comments: TIME_ENTRY_MARKER(entry.id),
    };
    try {
      if (currentId) {
        await this.client.put(`/time_entries/${encodeURIComponent(currentId)}.json`, {
          time_entry: payload,
        });
        return result(currentId);
      }
      const response = await this.client.post<{ time_entry: RemoteTimeEntry }>("/time_entries.json", {
        time_entry: payload,
      });
      const id = positiveNumericId(response.time_entry?.id);
      if (id === null) throw new Error("Malformed Redmine time-entry response");
      return result(externalId(id), response.time_entry.updated_on ?? null);
    } catch (error) {
      writeFailure(error, currentId === null);
    }
  }

  private async issuePayload(issue: CanonicalIssue, patch: CanonicalIssuePatch, creating: boolean) {
    const payload: Record<string, string | number | null> = {};
    const value = <T>(field: { kind: string; value?: T }, current: T | null) =>
      creating
        ? current
        : field.kind === "set"
          ? field.value
          : field.kind === "clear"
            ? null
            : undefined;
    const assign = (key: string, mapped: unknown) => {
      if (mapped !== undefined) payload[key] = mapped as string | number | null;
    };

    assign("subject", value(patch.title, issue.title));
    const description = value(patch.description, issue.description);
    if (description !== undefined) payload["description"] = issueDescription(description, issue.id);
    const status = value(patch.status, issue.status);
    if (status) {
      const mappedStatus = this.options.writeMap[status];
      if (mappedStatus === undefined)
        throw new Error(`Missing Redmine status mapping for ${status}`);
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
        : "";
    }
    const cycleId = value(patch.cycleId, issue.cycleId);
    if (cycleId !== undefined) {
      payload["fixed_version_id"] = cycleId ? await this.requireExternalId("cycle", cycleId) : "";
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
