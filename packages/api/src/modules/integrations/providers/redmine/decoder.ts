import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  PollPage,
  RemoteActor,
  RemoteChange,
} from "../../core/types.js";

const remoteIdSchema = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value > 0)
  .transform(String);
const validDateParts = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
};
const validTimestampParts = (value: string): boolean => {
  const match = /T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !validDateParts(value)) return false;
  const [, hour, minute, second] = match.map(Number);
  const offsetHour = Number(match[4] ?? 0);
  const offsetMinute = Number(match[5] ?? 0);
  return hour! <= 23 && minute! <= 59 && second! <= 59 && offsetHour <= 23 && offsetMinute <= 59;
};
const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/)
  .refine(validTimestampParts)
  .refine((value) => !Number.isNaN(Date.parse(value)))
  .transform((value) => new Date(value));
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(validDateParts);
const nullableDateOnlySchema = dateOnlySchema.nullish().transform((value) => value ?? null);
const nullableTimestampSchema = timestampSchema.nullish().transform((value) => value ?? null);
const remoteActorSchema = z.object({
  id: remoteIdSchema,
  name: z.string(),
  login: z.string().nullish(),
});
const remoteRefSchema = z.object({ id: remoteIdSchema, name: z.string() });
const issueSchema = z.object({
  id: remoteIdSchema,
  project: remoteRefSchema,
  tracker: remoteRefSchema,
  status: remoteRefSchema,
  priority: remoteRefSchema,
  author: remoteActorSchema,
  assigned_to: remoteActorSchema.nullish(),
  subject: z.string(),
  description: z.string().nullable(),
  start_date: nullableDateOnlySchema,
  due_date: nullableDateOnlySchema,
  done_ratio: z.number().int().min(0).max(100),
  is_private: z.boolean(),
  created_on: timestampSchema,
  updated_on: timestampSchema,
  closed_on: nullableTimestampSchema,
});
const journalSchema = z.object({
  id: remoteIdSchema,
  user: remoteActorSchema,
  notes: z.string(),
  private_notes: z.boolean(),
  created_on: timestampSchema,
  updated_on: nullableTimestampSchema,
  details: z.array(z.unknown()),
});
const issueListSchema = z.object({
  issues: z.array(issueSchema),
  total_count: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
});
const issueDetailSchema = z.object({
  issue: issueSchema.extend({ journals: z.array(journalSchema) }),
});

type RedmineIssue = z.infer<typeof issueSchema>;
type RedmineJournal = z.infer<typeof journalSchema>;

export interface RedmineIssueFields {
  readonly title: string;
  readonly description: string | null;
  readonly statusId: string;
  readonly priorityId: string;
  readonly assignee: RemoteActor | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly progress: number;
}

export interface RedminePrivateIssueFields {
  readonly reason: "private";
}

export interface RedmineCommentFields {
  readonly body: string;
}

export interface RedminePrivateCommentFields {
  readonly reason: "private";
}

export type RedmineIssueChange = RemoteChange<
  RedmineIssueFields | RedminePrivateIssueFields
>;
export type RedmineCommentChange = RemoteChange<
  RedmineCommentFields | RedminePrivateCommentFields
>;

export interface DecodedRedmineIssue {
  readonly issue: RedmineIssueChange;
  readonly comments: readonly RedmineCommentChange[];
}

function malformed(): never {
  throw new Error("Malformed Redmine issue response");
}

function sourceVersion(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function actor(value: z.infer<typeof remoteActorSchema>): RemoteActor {
  return {
    remoteId: value.id,
    displayName: value.name,
    ...(value.login == null ? {} : { username: value.login }),
  };
}

function issueChange(issue: RedmineIssue, expectedProjectId: string): RedmineIssueChange {
  if (issue.project.id !== expectedProjectId) {
    throw new Error("Redmine issue belongs to another project");
  }
  const identity = {
    type: "issue" as const,
    remoteId: issue.id,
    remoteProjectId: issue.project.id,
  };
  const common = {
    identity,
    changedAt: issue.updated_on,
    createdAt: issue.created_on,
    ...(issue.closed_on ? { closedAt: issue.closed_on } : {}),
  };

  if (issue.is_private) {
    const fields = { reason: "private" as const };
    return {
      ...common,
      operation: "tombstone",
      fields,
      sourceVersion: sourceVersion({
        identity,
        private: true,
        createdAt: issue.created_on.toISOString(),
        changedAt: issue.updated_on.toISOString(),
        closedAt: issue.closed_on?.toISOString() ?? null,
      }),
    };
  }

  const fields: RedmineIssueFields = {
    title: issue.subject,
    description: issue.description,
    statusId: issue.status.id,
    priorityId: issue.priority.id,
    assignee: issue.assigned_to ? actor(issue.assigned_to) : null,
    startDate: issue.start_date,
    dueDate: issue.due_date,
    progress: issue.done_ratio,
  };
  const remoteActor = actor(issue.author);
  return {
    ...common,
    operation: "upsert",
    actor: remoteActor,
    fields,
    sourceVersion: sourceVersion({
      identity,
      private: false,
      createdAt: issue.created_on.toISOString(),
      changedAt: issue.updated_on.toISOString(),
      closedAt: issue.closed_on?.toISOString() ?? null,
      actor: remoteActor,
      fields,
    }),
  };
}

function commentChange(
  journal: RedmineJournal,
  issue: RedmineIssue,
): RedmineCommentChange | null {
  if (!journal.notes.trim() && !journal.private_notes) return null;
  const identity = {
    type: "comment" as const,
    remoteId: journal.id,
    remoteProjectId: issue.project.id,
    parent: { type: "issue" as const, remoteId: issue.id },
  };
  const changedAt = journal.updated_on ?? journal.created_on;
  if (journal.private_notes) {
    const fields = { reason: "private" as const };
    return {
      identity,
      operation: "tombstone",
      changedAt,
      createdAt: journal.created_on,
      fields,
      sourceVersion: sourceVersion({
        identity,
        private: true,
        createdAt: journal.created_on.toISOString(),
        changedAt: changedAt.toISOString(),
      }),
    };
  }

  const fields = { body: journal.notes };
  const remoteActor = actor(journal.user);
  return {
    identity,
    operation: "upsert",
    changedAt,
    createdAt: journal.created_on,
    actor: remoteActor,
    fields,
    sourceVersion: sourceVersion({
      identity,
      private: false,
      createdAt: journal.created_on.toISOString(),
      changedAt: changedAt.toISOString(),
      actor: remoteActor,
      fields,
    }),
  };
}

export function decodeRedmineIssueListPage(
  value: unknown,
  expectedProjectId: string,
  expectedOffset: number,
  expectedLimit: number,
): PollPage<RedmineIssueChange> {
  const parsed = issueListSchema.safeParse(value);
  if (!parsed.success) malformed();
  const { issues, total_count: totalCount, offset, limit } = parsed.data;
  if (
    offset !== expectedOffset ||
    limit !== expectedLimit ||
    issues.length > limit ||
    offset > totalCount ||
    offset + issues.length > totalCount ||
    issues.length !== Math.min(limit, totalCount - offset)
  ) {
    malformed();
  }
  for (let index = 1; index < issues.length; index += 1) {
    const previous = issues[index - 1]!;
    const current = issues[index]!;
    const timestampOrder = current.updated_on.getTime() - previous.updated_on.getTime();
    if (timestampOrder < 0 || (timestampOrder === 0 && Number(current.id) <= Number(previous.id))) {
      malformed();
    }
  }
  const changes = issues.map((issue) => issueChange(issue, expectedProjectId));
  const last = changes.at(-1);
  return {
    changes,
    nextCheckpoint: last
      ? { updatedAt: last.changedAt, remoteId: last.identity.remoteId }
      : null,
    hasMore: offset + issues.length < totalCount,
  };
}

export function decodeRedmineIssueDetail(
  value: unknown,
  expectedProjectId: string,
): DecodedRedmineIssue {
  const parsed = issueDetailSchema.safeParse(value);
  if (!parsed.success) malformed();
  const issue = issueChange(parsed.data.issue, expectedProjectId);
  if (issue.operation === "tombstone") return { issue, comments: [] };

  return {
    issue,
    comments: parsed.data.issue.journals
      .map((journal) => commentChange(journal, parsed.data.issue))
      .filter((change): change is RedmineCommentChange => change !== null),
  };
}
