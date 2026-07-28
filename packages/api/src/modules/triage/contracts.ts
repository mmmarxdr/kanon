import { z } from "zod";
import { canonicalJson } from "./canonical.js";
export const ConfidenceBandSchema = z.enum(["low", "medium", "high"]);
export const CompletenessSchema = z.enum(["complete", "bounded", "timed_out", "degraded"]);
export const SemanticErrorCategorySchema = z.enum([
  "validation", "not_found_or_not_visible", "authorization", "source_conflict",
  "immutable_content_conflict", "terminal_lifecycle", "temporary_unavailability",
  "unsupported_non_executable", "degraded_success",
]);
const IdSchema = z.string().min(1).max(200);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const ScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("workspace"), workspaceId: IdSchema }).strict(),
]);
const EffectiveScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), workspaceId: IdSchema, projectId: IdSchema }).strict(),
  z.object({ kind: z.literal("workspace"), workspaceId: IdSchema }).strict(),
]);
export const IssueSearchInputSchema = z.object({
  q: z.string().superRefine((value, context) => {
    const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
    if (Buffer.byteLength(normalized, "utf8") > 256) context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 256, type: "string", inclusive: true });
    if ((normalized.match(/[\p{L}\p{N}]+/gu) ?? []).length > 12) context.addIssue({ code: z.ZodIssueCode.too_big, maximum: 12, type: "array", inclusive: true, message: "query has at most 12 tokens" });
    if ((normalized.match(/[\p{L}\p{N}]+/gu) ?? []).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "query must contain an alphanumeric token" });
  }).transform((value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")),
  filters: z.object({
    state: z.string().min(1).max(80).optional(), type: z.string().min(1).max(80).optional(),
    priority: z.string().min(1).max(80).optional(), label: z.string().min(1).max(80).optional(),
    group: IdSchema.optional(), assignee: IdSchema.optional(), cycle: IdSchema.optional(),
  }).strict().optional(),
  scope: ScopeSchema.optional(),
  projection: z.enum(["compact", "full"]).default("compact"),
  limit: z.number().int().min(1).max(10).default(10),
  targetIssueId: IdSchema.optional(),
  cursor: z.string().min(1).max(2048).optional(),
  deadlineMs: z.number().int().min(100).max(900).optional(),
}).strict();
export const IssueSearchRowSchema = z.object({
  issueId: IdSchema, issueKey: IdSchema, projectId: IdSchema, projectKey: IdSchema,
  title: z.string().max(500), state: z.string(), type: z.string().nullable(), priority: z.string().nullable(),
  labels: z.array(z.string()).max(8), groupKey: IdSchema.nullable(), assigneeId: IdSchema.nullable(), cycleId: IdSchema.nullable(), createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema, rank: z.number().int().positive(), sourceVersion: IdSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const IssueSearchResponseSchema = z.object({
  contractVersion: z.literal("issue-search.v1"), orderingVersion: z.literal("issue-search.v1"),
  completeness: CompletenessSchema, limit: z.number().int().min(1).max(10), returnedCount: z.number().int().nonnegative(),
  effectiveScope: EffectiveScopeSchema, correlationId: IdSchema, degradation: z.array(z.string()).max(8),
  rows: z.array(IssueSearchRowSchema).max(10), nextCursor: z.string().max(2048).optional(),
}).strict().superRefine((value, context) => {
  if (value.returnedCount !== value.rows.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["returnedCount"], message: "returnedCount must equal rows.length" });
  if (value.completeness === "complete" && value.nextCursor !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextCursor"], message: "complete responses cannot include nextCursor" });
  if (value.completeness === "bounded" && value.nextCursor === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["nextCursor"], message: "bounded responses require nextCursor" });
});
export const ProvenanceSchema = z.object({
  authorizationPolicyVersion: IdSchema.optional(), sourceVersion: IdSchema.optional(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  policyId: IdSchema.optional(), policyVersion: IdSchema.optional(), traceId: IdSchema.optional(),
  initiator: IdSchema.optional(), client: IdSchema.optional(),
}).strict();
export const SemanticErrorSchema = z.object({
  apiContractVersion: z.literal("triage-api.v1"), category: SemanticErrorCategorySchema, code: IdSchema,
  message: z.string().min(1).max(240), correlationId: IdSchema, retry: z.enum(["none", "retry", "rerun_preview", "restore_access"]),
  provenance: ProvenanceSchema.optional(),
}).strict();
const TargetSchema = z.object({
  issueId: IdSchema, issueKey: IdSchema, projectId: IdSchema, projectKey: IdSchema, workspaceId: IdSchema,
  sourceVersion: IdSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const PolicySchema = z.object({ id: IdSchema, version: IdSchema }).strict();
const ModelProvenanceSchema = z.object({ provider: IdSchema, model: IdSchema, modelVersion: IdSchema }).strict();
const EvidenceSchema = z.object({
  evidenceRefId: IdSchema, sourceClass: z.enum(["deterministic_fact", "untrusted_issue_text", "deterministic_policy", "host_ai"]),
  field: IdSchema, excerpt: z.string().max(240).optional(), fact: z.string().max(240).optional(), sourceVersion: IdSchema.optional(),
}).strict().refine((value) => value.excerpt !== undefined || value.fact !== undefined, { message: "evidence needs an excerpt or fact" });
const CanonicalConceptSchema = z.enum(["type", "priority", "labels", "group", "assignee", "cycle"]);
const MetadataConceptSchema = z.enum(["severity", "impact", "urgency", "sla"]);
const BoundedValueSchema = z.union([IdSchema, z.array(IdSchema).min(1).max(8)]);
const NormalizedRecommendationSchema = z.discriminatedUnion("operation", [
  z.object({ concept: CanonicalConceptSchema, operation: z.literal("set"), value: BoundedValueSchema, metadataOnly: z.literal(false) }).strict(),
  z.object({ concept: CanonicalConceptSchema, operation: z.literal("clear"), metadataOnly: z.literal(false) }).strict(),
  z.object({ concept: MetadataConceptSchema, operation: z.literal("recommend"), value: z.union([z.string().min(1).max(240), z.number().finite()]), metadataOnly: z.literal(true) }).strict(),
]).superRefine((value, context) => {
  if ("value" in value && value.concept === "labels" && !Array.isArray(value.value)) context.addIssue({ code: z.ZodIssueCode.custom, message: "labels require a bounded set" });
  if ("value" in value && value.concept !== "labels" && Array.isArray(value.value)) context.addIssue({ code: z.ZodIssueCode.custom, message: "canonical values are scalar" });
});
const RecommendationSchema = z.object({
  itemId: IdSchema, state: z.enum(["supported", "unknown", "conflict"]), normalized: NormalizedRecommendationSchema,
  source: z.enum(["deterministic_policy", "host_ai"]), reason: z.string().min(1).max(240), evidence: z.array(EvidenceSchema).min(1).max(3),
  confidence: ConfidenceBandSchema, confidenceBasis: z.string().min(1).max(240), ruleVersion: IdSchema.optional(), model: ModelProvenanceSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.source === "deterministic_policy" && !value.ruleVersion) context.addIssue({ code: z.ZodIssueCode.custom, path: ["ruleVersion"], message: "deterministic recommendations require rule provenance" });
  if (value.source === "deterministic_policy" && value.model) context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "deterministic recommendations cannot claim model provenance" });
  if (value.source === "host_ai" && !value.model) context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "host AI recommendations require model provenance" });
});
const CandidateSchema = z.object({
  rank: z.number().int().min(1).max(10), issueId: IdSchema, issueKey: IdSchema, sourceVersion: IdSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), sourceClass: z.enum(["deterministic_policy", "host_ai"]),
  reason: z.string().min(1).max(240), evidence: z.array(EvidenceSchema).min(1).max(3), confidence: ConfidenceBandSchema,
  confidenceBasis: z.string().min(1).max(240),
}).strict();
export const PreviewEnvelopeSchema = z.object({
  contractVersion: z.literal("triage-preview.v1"), previewIdentity: IdSchema, previewSeal: IdSchema,
  contextToken: IdSchema.optional(), target: TargetSchema, observedAt: IsoDateTimeSchema, generatedAt: IsoDateTimeSchema,
  authorizationPolicyVersion: IdSchema, effectiveScope: EffectiveScopeSchema, searchCompleteness: CompletenessSchema,
  correlationId: IdSchema, policy: PolicySchema, recommendations: z.array(RecommendationSchema).max(10),
  candidates: z.array(CandidateSchema).max(10), conflicts: z.array(IdSchema).max(20), unknowns: z.array(IdSchema).max(20),
  degradation: z.array(IdSchema).max(20), evidence: z.array(EvidenceSchema).max(60).optional(),
}).strict();
const GeneratorSchema = z.object({ kind: z.enum(["kanon_policy", "host_ai_hybrid"]), id: IdSchema, version: IdSchema, policy: PolicySchema.optional(), model: ModelProvenanceSchema.optional() }).strict().superRefine((value, context) => {
  if (value.kind === "kanon_policy" && !value.policy) context.addIssue({ code: z.ZodIssueCode.custom, path: ["policy"], message: "policy identity is required" });
  if (value.kind === "host_ai_hybrid" && !value.model) context.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "host model identity is required" });
});
const NormalizedPayloadSchema = z.object({ actions: z.array(NormalizedRecommendationSchema).max(10), candidateIds: z.array(IdSchema).max(10) }).strict().refine((value) => value.actions.length + value.candidateIds.length > 0, "normalized payload cannot be empty");
export const ProposalEnvelopeSchema = z.object({
  kind: z.literal("issue_triage_v1"), contractVersion: z.literal("triage-proposal.v1"), identityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  target: TargetSchema, sourceSeal: IdSchema, authorizationPolicyVersion: IdSchema, effectiveScope: EffectiveScopeSchema,
  normalizedPayload: NormalizedPayloadSchema, generator: GeneratorSchema, provenance: ProvenanceSchema,
  lifecycle: z.enum(["pending", "dismissed", "expired"]), createdAt: IsoDateTimeSchema, expiresAt: IsoDateTimeSchema,
  supersedesId: IdSchema.optional(), nonExecutable: z.literal(true),
}).strict();
export type ConfidenceBand = z.infer<typeof ConfidenceBandSchema>;
export type PreviewEnvelope = z.infer<typeof PreviewEnvelopeSchema>;
export interface PreviewSealValidationInput {
  readonly authenticated: boolean;
  readonly expiresAt: Date | string;
  readonly actualBinding: unknown;
  readonly expectedBinding: unknown;
  readonly now?: Date;
}
export interface PreviewSealValidation {
  readonly valid: boolean;
  readonly authenticated: boolean;
  readonly fresh: boolean;
  readonly bound: boolean;
  readonly reason?: "unauthenticated" | "expired" | "binding_mismatch";
}
export function validatePreviewSeal(input: PreviewSealValidationInput): PreviewSealValidation {
  const authenticated = input.authenticated;
  const fresh = new Date(input.expiresAt).getTime() > (input.now ?? new Date()).getTime();
  const bound = canonicalJson(input.actualBinding) === canonicalJson(input.expectedBinding);
  if (!authenticated) return { valid: false, authenticated, fresh, bound, reason: "unauthenticated" };
  if (!fresh) return { valid: false, authenticated, fresh, bound, reason: "expired" };
  if (!bound) return { valid: false, authenticated, fresh, bound, reason: "binding_mismatch" };
  return { valid: true, authenticated, fresh, bound };
}
