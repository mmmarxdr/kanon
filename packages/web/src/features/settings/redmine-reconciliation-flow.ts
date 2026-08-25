import type {
  redmineReconciliationActivationProgressSchema,
  redmineReconciliationMaterializeResultSchema,
  redmineReconciliationPreviewModeSchema,
  redmineReconciliationPreviewProgressSchema,
  redmineReconciliationReviewPageResultSchema,
} from "@kanon/shared";
import type { z } from "zod";

export type RedmineReconciliationPreviewMode = z.output<typeof redmineReconciliationPreviewModeSchema>;
export type RedmineReconciliationPreviewProgress = z.output<typeof redmineReconciliationPreviewProgressSchema>;
export type RedmineReconciliationReviewPage = z.output<typeof redmineReconciliationReviewPageResultSchema>;
export type RedmineReconciliationReviewItem = z.output<typeof redmineReconciliationMaterializeResultSchema>;
export type RedmineReconciliationActivationProgress = z.output<typeof redmineReconciliationActivationProgressSchema>;
export type RedmineReconciliationPhase = "choose-mode" | "preview" | "mapping-blocked" | "review" | "activation-ready" | "activation" | "complete" | "blocked" | "error";
export type RedmineReconciliationRecovery = "restart-preview" | "retry" | "refresh-item" | "blocked" | "fatal";
export type RedmineReconciliationFailureStage = "preview" | "review" | "decision" | "activation";

export interface RedmineReconciliationFailure {
  readonly stage: RedmineReconciliationFailureStage;
  readonly code: string;
  readonly message: string;
  readonly recovery: RedmineReconciliationRecovery;
}

export interface RedmineReconciliationFlowState {
  readonly bindingId: string;
  readonly phase: RedmineReconciliationPhase;
  readonly selectedMode?: RedmineReconciliationPreviewMode;
  readonly previewProgress: RedmineReconciliationPreviewProgress | null;
  readonly unresolvedItems: readonly RedmineReconciliationReviewItem[];
  readonly expectedNextCursor: string | undefined | null;
  readonly remainingCandidateCount: number;
  readonly hiddenCount: number;
  readonly linkedCount: number;
  readonly activationProgress: RedmineReconciliationActivationProgress | null;
  readonly failure: RedmineReconciliationFailure | null;
  readonly acceptedPageKeys: readonly string[];
}

export type RedmineReconciliationFlowAction =
  | { readonly type: "mode-selected"; readonly mode: RedmineReconciliationPreviewMode }
  | { readonly type: "preview-succeeded"; readonly progress: RedmineReconciliationPreviewProgress }
  | { readonly type: "review-succeeded"; readonly requestedCursor?: string; readonly page: RedmineReconciliationReviewPage }
  | { readonly type: "remote-resolved"; readonly remoteIssueId: string }
  | { readonly type: "item-refreshed"; readonly item: RedmineReconciliationReviewItem }
  | { readonly type: "activation-started" }
  | { readonly type: "activation-succeeded"; readonly progress: RedmineReconciliationActivationProgress }
  | { readonly type: "failed"; readonly stage: RedmineReconciliationFailureStage; readonly code: string; readonly message: string }
  | { readonly type: "reset" };

const CODE_GROUPS: Record<Exclude<RedmineReconciliationRecovery, "fatal">, readonly string[]> = {
  "restart-preview": ["REDMINE_PREVIEW_INVALID", "REDMINE_PREVIEW_STALE", "REDMINE_PREVIEW_REQUIRED", "REDMINE_RECONCILIATION_PREVIEW_REQUIRED", "REDMINE_RECONCILIATION_CURSOR_STALE", "REDMINE_RECONCILIATION_SCOPE_STALE", "REDMINE_RECONCILIATION_SOURCE_STALE", "REDMINE_RECONCILIATION_UNLISTED", "REDMINE_RECONCILIATION_PROJECT_MISMATCH", "REDMINE_RECONCILIATION_NOT_VISIBLE"],
  retry: ["REDMINE_CONNECTION_FAILED", "REDMINE_PREVIEW_IN_PROGRESS", "REDMINE_IMPORT_IN_PROGRESS", "REDMINE_IMPORT_RACE", "REDMINE_IMPORT_LIMIT"],
  "refresh-item": ["REDMINE_RECONCILIATION_LOCAL_STALE", "REDMINE_RECONCILIATION_REMOTE_STALE", "REDMINE_RECONCILIATION_RECOMMENDATION_STALE", "REDMINE_RECONCILIATION_CANDIDATE_LINKED", "REDMINE_RECONCILIATION_ALREADY_LINKED", "REDMINE_RECONCILIATION_CANDIDATE_INVALID", "REDMINE_RECONCILIATION_LINK_CONFLICT", "REDMINE_RECONCILIATION_RECOMMENDATION_NOT_FOUND", "REDMINE_RECONCILIATION_WRITE_CONFLICT"],
  blocked: ["REDMINE_RECONCILIATION_MAPPING_GAPS", "REDMINE_RECONCILIATION_MAPPING_INCOMPLETE", "REDMINE_STATUS_UNMAPPED", "REDMINE_PRIORITY_UNMAPPED", "REDMINE_ASSIGNEE_UNMAPPED", "PROVIDER_MAPS_REQUIRED", "REDMINE_RECONCILIATION_LIFECYCLE", "REDMINE_PREVIEW_LIFECYCLE", "INTEGRATION_NOT_ACTIVE", "INTEGRATION_NOT_READY", "REDMINE_RECONCILIATION_OUTBOUND_PENDING", "REDMINE_OUTBOUND_UNSETTLED", "REDMINE_RECONCILIATION_OUTBOUND_CREATE_UNCERTAIN", "REDMINE_NOT_CONFIGURED", "SERVICE_CREDENTIAL_REQUIRES_REPLACEMENT", "REDMINE_RECONCILIATION_PENDING", "REDMINE_IMPORT_ACTIVE"],
};

export function classifyRedmineReconciliationFailure(code: string): RedmineReconciliationRecovery {
  for (const [recovery, codes] of Object.entries(CODE_GROUPS)) if (codes.includes(code)) return recovery as RedmineReconciliationRecovery;
  return "fatal";
}

export function createRedmineReconciliationFlowState(bindingId: string): RedmineReconciliationFlowState {
  return { bindingId, phase: "choose-mode", previewProgress: null, unresolvedItems: [], expectedNextCursor: undefined, remainingCandidateCount: 0, hiddenCount: 0, linkedCount: 0, activationProgress: null, failure: null, acceptedPageKeys: [] };
}

function hasMappingGaps(progress: RedmineReconciliationPreviewProgress) {
  return Object.values(progress.mappingGaps).some((ids) => ids.length > 0);
}

function reviewComplete(state: Pick<RedmineReconciliationFlowState, "expectedNextCursor" | "remainingCandidateCount" | "unresolvedItems">) {
  return state.expectedNextCursor === null && state.remainingCandidateCount === 0 && state.unresolvedItems.length === 0;
}

function invalidPage(state: RedmineReconciliationFlowState): RedmineReconciliationFlowState {
  return { ...state, phase: "error", failure: { stage: "review", code: "REDMINE_RECONCILIATION_PAGE_INVALID", message: "Review page does not match the expected preview cursor", recovery: "fatal" } };
}

export function redmineReconciliationFlowReducer(state: RedmineReconciliationFlowState, action: RedmineReconciliationFlowAction): RedmineReconciliationFlowState {
  if (action.type === "reset") return createRedmineReconciliationFlowState(state.bindingId);
  if (action.type === "mode-selected") return { ...createRedmineReconciliationFlowState(state.bindingId), phase: "preview", selectedMode: action.mode };
  if (action.type === "preview-succeeded") {
    const progress = action.progress;
    const phase: RedmineReconciliationPhase = !progress.complete ? "preview" : progress.mode === "future_only" ? "activation-ready" : hasMappingGaps(progress) ? "mapping-blocked" : progress.eligibleUnlinkedCount > 0 ? "review" : "activation-ready";
    return { ...state, phase, selectedMode: progress.mode, previewProgress: progress, remainingCandidateCount: progress.eligibleUnlinkedCount, failure: null };
  }
  if (action.type === "review-succeeded") {
    const key = JSON.stringify([action.requestedCursor ?? null, action.page]);
    if (state.acceptedPageKeys.includes(key)) return state;
    if (state.previewProgress?.previewIdentity !== action.page.previewIdentity || state.expectedNextCursor !== action.requestedCursor) return invalidPage(state);
    const ids = new Set(state.unresolvedItems.map((item) => item.remote.id));
    const appended = action.page.items.filter((item) => !ids.has(item.remote.id) && Boolean(ids.add(item.remote.id)));
    const next = { ...state, phase: "review" as const, unresolvedItems: [...state.unresolvedItems, ...appended], expectedNextCursor: action.page.nextCursor, remainingCandidateCount: action.page.remainingCandidateCount, hiddenCount: state.hiddenCount + action.page.hiddenCount, linkedCount: state.linkedCount + action.page.linkedCount, failure: null, acceptedPageKeys: [...state.acceptedPageKeys, key] };
    return reviewComplete(next) ? { ...next, phase: "activation-ready" } : next;
  }
  if (action.type === "remote-resolved") {
    const unresolvedItems = state.unresolvedItems.filter((item) => item.remote.id !== action.remoteIssueId);
    if (unresolvedItems.length === state.unresolvedItems.length) return state;
    const next = { ...state, phase: "review" as const, unresolvedItems, failure: null };
    return reviewComplete(next) ? { ...next, phase: "activation-ready" } : next;
  }
  if (action.type === "item-refreshed") {
    if (state.phase !== "error" || state.failure?.recovery !== "refresh-item" || !["review", "decision"].includes(state.failure.stage) || !state.unresolvedItems.some((item) => item.remote.id === action.item.remote.id)) return state;
    return { ...state, phase: "review", unresolvedItems: state.unresolvedItems.map((item) => item.remote.id === action.item.remote.id ? action.item : item), failure: null };
  }
  const activationRetry = state.phase === "error" && state.failure?.stage === "activation" && state.failure.recovery === "retry";
  if (action.type === "activation-started") return state.phase === "activation-ready" || activationRetry ? { ...state, phase: "activation", failure: null } : state;
  if (action.type === "activation-succeeded") return state.phase === "activation" || state.phase === "complete" || activationRetry ? { ...state, phase: action.progress.complete ? "complete" : "activation", activationProgress: action.progress, failure: null } : state;
  if (action.stage === "preview" && ["REDMINE_IMPORT_IN_PROGRESS", "REDMINE_IMPORT_ACTIVE"].includes(action.code)) return { ...state, phase: action.code === "REDMINE_IMPORT_ACTIVE" ? "complete" : "activation", activationProgress: null, failure: null };
  const recovery = classifyRedmineReconciliationFailure(action.code);
  const failure = { stage: action.stage, code: action.code, message: action.message, recovery };
  if (recovery === "restart-preview") return { ...createRedmineReconciliationFlowState(state.bindingId), selectedMode: state.selectedMode, phase: "error", failure };
  return { ...state, phase: recovery === "blocked" ? "blocked" : "error", failure };
}
