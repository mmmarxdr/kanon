import type {
  CanonicalIssueState,
  InboundCursor,
  InboundIssueStatusChange,
  InboundPage,
  InboundSource,
  StatusReadMap,
} from "../../core/types.js";
import type { RedmineHttpClient } from "./http-client.js";

const PAGE_SIZE = 100;
// ponytail: one bounded pass keeps cursor commit atomic; persist pageToken above 10k issues/binding.
const MAX_PAGES = 100;
const ISSUE_STATES = new Set<CanonicalIssueState>([
  "backlog",
  "analysis",
  "todo",
  "in_progress",
  "review",
  "done",
]);

type RemoteIssue = {
  id: unknown;
  status?: { id?: unknown };
  updated_on?: unknown;
};

type RemoteIssuePage = {
  issues?: unknown;
  total_count?: unknown;
  offset?: unknown;
  limit?: unknown;
};

export interface RedmineInboundSourceOptions {
  readonly remoteProjectId: string;
  readonly readMap: StatusReadMap;
}

function remoteId(value: unknown): number {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Malformed Redmine issue ID");
  return id;
}

function remoteUpdatedAt(value: unknown): Date {
  if (typeof value !== "string") throw new Error("Malformed Redmine issue updated_on");
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) throw new Error("Malformed Redmine issue updated_on");
  return updatedAt;
}

function compareTuple(
  left: Pick<InboundCursor, "updatedAt" | "entityId">,
  right: Pick<InboundCursor, "updatedAt" | "entityId">,
): number {
  const timestamp = left.updatedAt.getTime() - right.updatedAt.getTime();
  return timestamp || remoteId(left.entityId) - remoteId(right.entityId);
}

export class RedminePollingInboundSource
  implements InboundSource<InboundIssueStatusChange>
{
  constructor(
    private readonly client: Pick<RedmineHttpClient, "get">,
    private readonly options: RedmineInboundSourceOptions,
  ) {}

  async poll(
    cursor: InboundCursor | null,
  ): Promise<InboundPage<InboundIssueStatusChange>> {
    if (cursor) {
      remoteId(cursor.entityId);
      if (Number.isNaN(cursor.updatedAt.getTime())) throw new Error("Invalid inbound cursor");
    }

    const changes: InboundIssueStatusChange[] = [];
    let offset = 0;
    let totalCount: number | undefined;
    let lastSeen: InboundCursor | null = null;
    const seenIds = new Set<string>();

    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const query = new URLSearchParams({
        project_id: this.options.remoteProjectId,
        status_id: "*",
        sort: "updated_on:asc,id:asc",
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (cursor) {
        query.set("updated_on", `>=${cursor.updatedAt.toISOString().replace(/\.\d{3}Z$/, "Z")}`);
      }

      const page = await this.client.get<RemoteIssuePage>(`/issues.json?${query}`);
      if (
        !Array.isArray(page.issues) ||
        !Number.isSafeInteger(page.total_count) ||
        (page.total_count as number) < 0 ||
        !Number.isSafeInteger(page.offset) ||
        page.offset !== offset ||
        !Number.isSafeInteger(page.limit) ||
        (page.limit as number) < 1 ||
        (page.limit as number) > PAGE_SIZE ||
        (totalCount !== undefined && page.total_count !== totalCount)
      ) {
        throw new Error("Malformed or unstable Redmine issue pagination");
      }

      totalCount ??= page.total_count as number;
      const limit = page.limit as number;
      const expectedCount = Math.min(limit, totalCount - offset);
      if (page.issues.length !== expectedCount) {
        throw new Error("Malformed or unstable Redmine issue pagination");
      }

      for (const value of page.issues as RemoteIssue[]) {
        const id = String(remoteId(value.id));
        if (seenIds.has(id)) {
          throw new Error("Redmine issue pagination changed during polling");
        }
        seenIds.add(id);
        const updatedAt = remoteUpdatedAt(value.updated_on);
        const tuple = { updatedAt, entityId: id };
        if (lastSeen && compareTuple(tuple, lastSeen) <= 0) {
          throw new Error("Redmine issues are not in stable updated_on/id order");
        }
        lastSeen = tuple;
        if (cursor && compareTuple(tuple, cursor) <= 0) continue;

        const statusId = value.status?.id;
        if (typeof statusId !== "string" && typeof statusId !== "number") {
          throw new Error("Malformed Redmine issue status");
        }
        const state = this.options.readMap[String(statusId)] as
          | CanonicalIssueState
          | undefined;
        if (!state || !ISSUE_STATES.has(state)) {
          throw new Error(`Missing inbound status mapping for ${statusId}`);
        }
        changes.push({
          entityType: "issue",
          entityId: id,
          operation: state === "done" ? "close" : "update",
          changedAt: updatedAt,
          remoteVersion: value.updated_on as string,
          correlationId: null,
          state,
        });
      }

      const nextOffset = offset + limit;
      if (nextOffset >= totalCount) {
        const lastChange = changes.at(-1);
        return {
          changes,
          nextCursor: lastChange
            ? { updatedAt: lastChange.changedAt, entityId: lastChange.entityId }
            : cursor,
          hasMore: false,
        };
      }
      if (nextOffset <= offset) throw new Error("Redmine issue pagination did not advance");
      offset = nextOffset;
    }

    throw new Error(`Redmine issue poll exceeded ${MAX_PAGES * PAGE_SIZE} issues`);
  }
}
