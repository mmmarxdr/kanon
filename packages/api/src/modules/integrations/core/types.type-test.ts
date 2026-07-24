import type {
  CanonicalChange,
  CanonicalIssue,
  CanonicalIssuePatch,
  PmProviderAdapter,
} from "./types.js";

declare const issue: CanonicalIssue;
declare const noChangePatch: CanonicalIssuePatch;
declare const adapter: PmProviderAdapter;
declare const issueChange: Extract<CanonicalChange, { entityType: "issue"; value: CanonicalIssue }>;
const issueEntity: "issue" = issueChange.entityType;

// @ts-expect-error An explicit field operation is required; undefined is not no-change.
const undefinedField: CanonicalIssuePatch = { ...noChangePatch, title: undefined };
// @ts-expect-error No-change must be expressed by an explicit all-omit patch.
adapter.pushIssue(issue);
// @ts-expect-error The entity tag must agree with the payload type.
const mismatchedEntity: CanonicalChange = { ...issueChange, entityType: "project" };
// @ts-expect-error Delete changes carry null rather than an entity payload.
const deleteWithValue: CanonicalChange = { ...issueChange, operation: "delete" };
// @ts-expect-error Non-delete changes must carry the matching entity payload.
const updateWithoutValue: CanonicalChange = { ...issueChange, value: null };
