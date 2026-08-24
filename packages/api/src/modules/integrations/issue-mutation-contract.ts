import type { Prisma } from "@prisma/client";

export const ISSUE_CAPTURE_FIELDS = [
  "title",
  "description",
  "state",
  "priority",
  "assigneeId",
  "cycleId",
  "estimate",
] as const;
export const ISSUE_SCHEDULE_CAPTURE_FIELDS = [
  "estimateHours",
  "startDate",
  "dueDate",
  "progress",
] as const;
export type IssueMutationRow = Prisma.IssueGetPayload<{}>;
export type IssueCaptureField = (typeof ISSUE_CAPTURE_FIELDS)[number];
export type IssueCaptureFields = Readonly<Partial<Pick<IssueMutationRow, IssueCaptureField>>>;
export type IssueCaptureIntent = Readonly<
  Record<"bindingId" | "actorKey" | "correlationId", string> &
    Record<"direction", "outbound" | "inbound"> &
    Record<"operation", "create" | "update" | "delete" | "close"> &
    Record<"actorKind", "user" | "system" | "ai" | "remote"> &
    Record<"fields", IssueCaptureFields> &
    Partial<
      Record<"refId" | "authCredentialId" | "marker", string | null> & Record<"availableAt", Date>
    >
>;
export interface IssueMutationDraft {
  readonly result: IssueMutationRow;
  readonly capture: IssueCaptureIntent;
}
export interface IssueMutationPayload {
  readonly version: 1;
  readonly fields: IssueCaptureFields;
  readonly issue: Readonly<
    Pick<
      IssueMutationRow,
      | "key"
      | "title"
      | "description"
      | "state"
      | "priority"
      | "assigneeId"
      | "cycleId"
      | "estimate"
    > & { completedAt: string | null; updatedAt: string }
  >;
}
export interface CanonicalIssueMutationDraft {
  readonly result: IssueMutationRow;
  readonly capture: IssueCaptureIntent;
  readonly payload: IssueMutationPayload;
}
const ROW =
  "id key sequenceNum title description type priority state labels completedAt timeConfirmedAt privacyHeldAt privacyHoldGeneration createdAt updatedAt groupKey engramContext specArtifacts projectId assigneeId estimate cycleId parentId roadmapItemId".split(
    " "
  );
const CAPTURE =
  "bindingId direction operation actorKey actorKind correlationId fields refId authCredentialId availableAt marker".split(
    " "
  );
const STATES = "backlog analysis todo in_progress review done".split(" ");
const ROW_CHOICES: Record<string, string[]> = {
  type: "feature bug task spike incident".split(" "),
  priority: "critical high medium low".split(" "),
  state: STATES,
};
const NULLABLE_STRINGS = "description groupKey assigneeId cycleId parentId roadmapItemId".split(
  " "
);
const JSON_FIELDS = ["engramContext", "specArtifacts"];
const MAX_JSON_DEPTH = 100;
const CAPTURE_CHOICES: Record<string, string[]> = {
  direction: ["outbound", "inbound"],
  operation: ["create", "update", "delete", "close"],
  actorKind: ["user", "system", "ai", "remote"],
};

type Descriptors = Record<string, PropertyDescriptor>;
type JsonValue = Prisma.JsonValue;
function bad(reason: string): never {
  throw new TypeError(reason);
}
function rejectThenable(value: object): void {
  let prototype: object | null = value;
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "then");
    if (descriptor && (!("value" in descriptor) || typeof descriptor.value === "function")) {
      bad("must not be a thenable");
    }
    if (descriptor) return;
    prototype = Object.getPrototypeOf(prototype);
  }
}
function properties(
  value: unknown,
  isArray: boolean,
  allowed: readonly string[] | null = null,
  required: readonly string[] = []
): Descriptors {
  const arrayValue = Array.isArray(value);
  if (value === null || typeof value !== "object" || arrayValue !== isArray)
    bad(isArray ? "must be an array" : "must be a plain object");
  rejectThenable(value);
  if (Object.getPrototypeOf(value) !== (arrayValue ? Array.prototype : Object.prototype))
    bad("has an unsupported prototype");
  const descriptors = Object.getOwnPropertyDescriptors(value) as Descriptors;
  if (
    Reflect.ownKeys(value).some((key) => {
      if (isArray && key === "length") return false;
      if (typeof key !== "string") return true;
      const index = /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
      const descriptor = descriptors[key];
      return !(
        (isArray
          ? index >= 0 && index < (arrayValue ? (value as unknown[]).length : -1)
          : allowed === null || allowed.includes(key)) &&
        !!descriptor &&
        "value" in descriptor &&
        descriptor.enumerable
      );
    })
  )
    bad("has an unsupported descriptor");
  if (arrayValue && Object.keys(value).length !== (value as unknown[]).length)
    bad("contains a sparse element");
  for (const key of required) read(descriptors, key);
  return descriptors;
}
function read(descriptors: Descriptors, key: string): unknown {
  const descriptor = descriptors[key];
  return descriptor && "value" in descriptor && descriptor.value !== undefined
    ? descriptor.value
    : bad("must be a defined data value");
}
function dateValue(value: unknown): Date {
  const valid =
    value instanceof Date &&
    Object.getPrototypeOf(value) === Date.prototype &&
    Reflect.ownKeys(value).length === 0;
  if (!valid) bad("must be a valid Date data value");
  const time = Date.prototype.getTime.call(value);
  return Number.isFinite(time)
    ? Object.freeze(new Date(time))
    : bad("must be a valid Date data value");
}
function scalar(
  value: unknown,
  kind: "string" | "required" | "integer" | "choice" | "date",
  values?: readonly string[]
): unknown {
  if (kind === "date") return dateValue(value);
  const valid =
    kind === "integer"
      ? typeof value === "number" && Number.isSafeInteger(value)
      : kind === "choice"
        ? typeof value === "string" && values?.includes(value)
        : typeof value === "string" && (kind === "string" || value.length > 0);
  if (!valid) bad(kind === "integer" ? "must be a finite integer" : "has an unsupported value");
  return value;
}
const nullable = (value: unknown, kind: "string" | "required"): unknown =>
  value === null ? null : scalar(value, kind);
function jsonValue(value: unknown, seen: WeakSet<object>, depth = 0): JsonValue {
  if (depth > MAX_JSON_DEPTH) bad("exceeds maximum JSON depth");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) bad("contains a non-finite number");
    return value;
  }
  if (typeof value !== "object") bad("contains an unsupported value");
  if (seen.has(value)) bad("contains a cycle");
  seen.add(value);
  const arrayValue = Array.isArray(value);
  const descriptors = properties(value, arrayValue);
  const keys = Object.keys(descriptors).filter((key) => !arrayValue || key !== "length");
  const result = arrayValue
    ? keys.map((key) => jsonValue(read(descriptors, key), seen, depth + 1))
    : Object.fromEntries(
        keys.map((key) => [key, jsonValue(read(descriptors, key), seen, depth + 1)])
      );
  seen.delete(value);
  return Object.freeze(result) as JsonValue;
}
const parseRecord = (
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  convert: (key: string, value: unknown) => unknown
): Record<string, unknown> => {
  const descriptors = properties(value, false, allowed, required);
  return Object.fromEntries(
    allowed
      .filter((key) => descriptors[key])
      .map((key) => [key, convert(key, read(descriptors, key))])
  );
};
function rowValue(key: string, value: unknown): unknown {
  if (key === "labels") {
    const descriptors = properties(value, true);
    const labels = Object.keys(descriptors)
      .filter((key) => key !== "length")
      .map((key) => scalar(read(descriptors, key), "string"));
    return Object.freeze(labels) as unknown as string[];
  }
  if (ROW_CHOICES[key]) return scalar(value, "choice", ROW_CHOICES[key]);
  if (key === "sequenceNum" || key === "privacyHoldGeneration") return scalar(value, "integer");
  if (key === "estimate") return value === null ? null : scalar(value, "integer");
  if (JSON_FIELDS.includes(key)) return jsonValue(value, new WeakSet());
  if (["completedAt", "timeConfirmedAt", "privacyHeldAt"].includes(key)) {
    return value === null ? null : scalar(value, "date");
  }
  if (["createdAt", "updatedAt"].includes(key)) return scalar(value, "date");
  if (NULLABLE_STRINGS.includes(key)) return nullable(value, "string");
  return scalar(
    value,
    key === "id" || key === "key" || key === "projectId" ? "required" : "string"
  );
}
const issueRow = (value: unknown): IssueMutationRow =>
  Object.freeze(parseRecord(value, ROW, ROW, rowValue)) as IssueMutationRow;
function captureField(field: string, value: unknown): unknown {
  if (field === "estimate") return value === null ? null : scalar(value, "integer");
  if (field === "state") return scalar(value, "choice", STATES);
  if (field === "priority") return scalar(value, "choice", ROW_CHOICES["priority"]);
  return field === "title" ? scalar(value, "string") : nullable(value, "string");
}
function captureValue(key: string, value: unknown): unknown {
  if (key === "fields")
    return Object.freeze(parseRecord(value, ISSUE_CAPTURE_FIELDS, [], captureField));
  if (CAPTURE_CHOICES[key]) return scalar(value, "choice", CAPTURE_CHOICES[key]);
  if (key === "availableAt") return scalar(value, "date");
  if (key === "refId" || key === "authCredentialId") return nullable(value, "required");
  if (key === "marker") return nullable(value, "string");
  return scalar(
    value,
    ["bindingId", "actorKey", "correlationId"].includes(key) ? "required" : "string"
  );
}
const capture = (value: unknown): IssueCaptureIntent =>
  Object.freeze(
    parseRecord(value, CAPTURE, CAPTURE.slice(0, 7), captureValue)
  ) as unknown as IssueCaptureIntent;
export function canonicalizeIssueMutationDraft(value: unknown): CanonicalIssueMutationDraft {
  const descriptors = properties(value, false, ["result", "capture"], ["result", "capture"]);
  const result = issueRow(read(descriptors, "result"));
  const captureIntent = capture(read(descriptors, "capture"));
  const issue = Object.freeze({
    key: result.key,
    title: result.title,
    description: result.description,
    state: result.state,
    priority: result.priority,
    assigneeId: result.assigneeId,
    cycleId: result.cycleId,
    estimate: result.estimate,
    completedAt: result.completedAt?.toISOString() ?? null,
    updatedAt: result.updatedAt.toISOString(),
  });
  const payload = Object.freeze({ version: 1 as const, fields: captureIntent.fields, issue });
  return Object.freeze({ result, capture: captureIntent, payload });
}
