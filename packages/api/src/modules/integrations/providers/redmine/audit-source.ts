import type { PollCheckpoint, PollPage } from "../../core/types.js";
import {
  decodeRedmineIssueDetail,
  decodeRedmineIssueListPage,
  type DecodedRedmineIssue,
  type RedmineIssueChange,
} from "./decoder.js";
import { RedmineHttpError, type RedmineHttpResponse } from "./http-client.js";

export type RedmineAuditFailureCode =
  | "timeout"
  | "unauthorized"
  | "rate_limited"
  | "malformed_response"
  | "pagination_drift"
  | "detail_drift"
  | "provider_failure";

export type RedmineAuditRead<T> =
  | { readonly kind: "accepted"; readonly providerObservedAt: Date; readonly value: T }
  | { readonly kind: "unknown"; readonly reasonCode: RedmineAuditFailureCode };

export type RedmineAuditIdentityRead =
  | { readonly kind: "visible"; readonly providerObservedAt: Date; readonly issueId: string; readonly journalId?: string }
  | { readonly kind: "not_visible_in_scope" }
  | { readonly kind: "unknown"; readonly reasonCode: RedmineAuditFailureCode };

export interface RedmineAuditSourceOptions {
  readonly remoteProjectId: string;
}

type AuditClient = Pick<import("./http-client.js").RedmineHttpClient, "getWithResponse">;

function failureCode(error: unknown, detail = false): RedmineAuditFailureCode {
  if (error instanceof RedmineHttpError) {
    if (error.statusCode === 401 || error.statusCode === 403) return "unauthorized";
    if (error.statusCode === 429) return "rate_limited";
  }
  if (error instanceof Error && /timed out/i.test(error.message)) return "timeout";
  if (error instanceof Error && /pagination/i.test(error.message)) return "pagination_drift";
  if (detail && error instanceof Error && /detail does not match/i.test(error.message)) return "detail_drift";
  return "malformed_response";
}

const monthIndex = new Map([
  ["Jan", 0], ["Feb", 1], ["Mar", 2], ["Apr", 3], ["May", 4], ["Jun", 5],
  ["Jul", 6], ["Aug", 7], ["Sep", 8], ["Oct", 9], ["Nov", 10], ["Dec", 11],
]);
const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekdayLong = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function httpDate(year: number, month: string, day: number, hour: number, minute: number, second: number, dayName: string, names: readonly string[]): Date | null {
  const monthIndexValue = monthIndex.get(month);
  if (monthIndexValue === undefined || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, monthIndexValue, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndexValue || date.getUTCDate() !== day || names[date.getUTCDay()] !== dayName) return null;
  return date;
}

function parseHttpDate(value: RedmineHttpResponse<unknown>["httpDate"]): Date | null {
  if (typeof value !== "string") return null;
  const imf = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  if (imf) return httpDate(Number(imf[4]), imf[3]!, Number(imf[2]), Number(imf[5]), Number(imf[6]), Number(imf[7]), imf[1]!, weekday);
  const obsolete = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(value);
  if (obsolete) {
    let year = 2000 + Number(obsolete[4]);
    if (year > new Date().getUTCFullYear() + 50) year -= 100;
    return httpDate(year, obsolete[3]!, Number(obsolete[2]), Number(obsolete[5]), Number(obsolete[6]), Number(obsolete[7]), obsolete[1]!, weekdayLong);
  }
  const asctime = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: (\d)|((?:[12]\d)|3[01])) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(value);
  return asctime ? httpDate(Number(asctime[8]), asctime[2]!, Number(asctime[3] ?? asctime[4]), Number(asctime[5]), Number(asctime[6]), Number(asctime[7]), asctime[1]!, weekday) : null;
}

function positiveId(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

export class RedmineAuditSource {
  private providerObservedAt: Date | null = null;

  constructor(
    private readonly client: AuditClient,
    private readonly options: RedmineAuditSourceOptions,
  ) {}

  async readPage(
    offset: number,
    limit: number,
    checkpoint: PollCheckpoint | null,
  ): Promise<RedmineAuditRead<PollPage<RedmineIssueChange>>> {
    const query = new URLSearchParams({
      project_id: this.options.remoteProjectId,
      sort: "updated_on:asc,id:asc",
      status_id: "*",
      subproject_id: "!*",
      offset: String(offset),
      limit: String(limit),
    });
    try {
      const response = await this.client.getWithResponse<unknown>(`/issues.json?${query}`);
      const observedAt = this.observeDate(response);
      if (!observedAt) return { kind: "unknown", reasonCode: "malformed_response" };
      return {
        kind: "accepted",
        providerObservedAt: observedAt,
        value: decodeRedmineIssueListPage(response.value, this.options.remoteProjectId, offset, limit, checkpoint),
      };
    } catch (error) {
      return { kind: "unknown", reasonCode: failureCode(error) };
    }
  }

  async readIssueDetail(issueId: string): Promise<RedmineAuditRead<DecodedRedmineIssue> | { readonly kind: "not_visible_in_scope" }> {
    return this.readDetail(issueId);
  }

  async readIssue(issueId: string): Promise<RedmineAuditIdentityRead> {
    if (!positiveId(issueId)) return { kind: "unknown", reasonCode: "malformed_response" };
    const detail = await this.readDetail(issueId);
    if (detail.kind !== "accepted") return detail;
    return { kind: "visible", providerObservedAt: detail.providerObservedAt, issueId };
  }

  async readComment(issueId: string, journalId: string): Promise<RedmineAuditIdentityRead> {
    if (!positiveId(journalId)) return { kind: "unknown", reasonCode: "malformed_response" };
    const detail = await this.readDetail(issueId);
    if (detail.kind !== "accepted") return detail;
    if (!detail.value.journalIds.includes(journalId)) return { kind: "not_visible_in_scope" };
    return { kind: "visible", providerObservedAt: detail.providerObservedAt, issueId, journalId };
  }

  private async readDetail(issueId: string): Promise<RedmineAuditRead<DecodedRedmineIssue> | { readonly kind: "not_visible_in_scope" }> {
    try {
      const response = await this.client.getWithResponse<unknown>(`/issues/${issueId}.json?include=journals`);
      const observedAt = this.observeDate(response);
      if (!observedAt) return { kind: "unknown", reasonCode: "malformed_response" };
      return {
        kind: "accepted",
        providerObservedAt: observedAt,
        value: decodeRedmineIssueDetail(response.value, this.options.remoteProjectId, issueId),
      };
    } catch (error) {
      if (error instanceof RedmineHttpError && error.statusCode === 404) return { kind: "not_visible_in_scope" };
      return { kind: "unknown", reasonCode: failureCode(error, true) };
    }
  }

  private observeDate(response: RedmineHttpResponse<unknown>): Date | null {
    const observedAt = parseHttpDate(response.httpDate);
    if (!observedAt || (this.providerObservedAt && observedAt < this.providerObservedAt)) return null;
    this.providerObservedAt ??= observedAt;
    return this.providerObservedAt;
  }
}
