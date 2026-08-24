import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedmineReconciliationPreviewProgress, RedmineReconciliationReviewItem, RedmineReconciliationReviewPage } from "./redmine-reconciliation-flow";
import { RedmineReconciliationModal, type RedmineReconciliationQueueItem } from "./redmine-reconciliation-modal";
import { RedmineReconciliationManualLink } from "./redmine-reconciliation-manual-link";

const commands = vi.hoisted(() => {
  const command = () => ({ mutate: vi.fn(), hook: vi.fn(), pending: false });
  return { preview: command(), review: command(), decision: command(), materialize: command() };
});
const issueSearch = vi.hoisted(() => ({ hook: vi.fn(), data: [] as Array<{ id: string; key: string; title: string }>, fetching: false }));
vi.mock("focus-trap-react", () => ({ FocusTrap: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/board/use-issue-search-query", () => ({ useIssueSearchQuery: (...args: unknown[]) => { issueSearch.hook(...args); return { data: issueSearch.data, isFetching: issueSearch.fetching }; } }));
vi.mock("./use-redmine-reconciliation", () => ({
  useRedmineReconciliationPreviewMutation: (...args: string[]) => { commands.preview.hook(...args); return { mutate: commands.preview.mutate, isPending: commands.preview.pending }; },
  useRedmineReconciliationReviewPageMutation: (...args: string[]) => { commands.review.hook(...args); return { mutate: commands.review.mutate, isPending: commands.review.pending }; },
  useRedmineReconciliationDecisionMutation: (...args: string[]) => { commands.decision.hook(...args); return { mutate: commands.decision.mutate, isPending: commands.decision.pending }; },
  useRedmineReconciliationMaterializeMutation: (...args: string[]) => { commands.materialize.hook(...args); return { mutate: commands.materialize.mutate, isPending: commands.materialize.pending }; },
}));

const queue: readonly RedmineReconciliationQueueItem[] = [
  { bindingId: "11111111-1111-4111-8111-111111111111", projectId: "p1", projectKey: "KAN", remoteProjectId: "r1", projectName: "Kanon One", remoteProjectName: "Redmine One" },
  { bindingId: "22222222-2222-4222-8222-222222222222", projectId: "p2", projectKey: null, remoteProjectId: "r2", projectName: "Kanon Two", remoteProjectName: "Redmine Two" },
];
const progress = (overrides: Partial<RedmineReconciliationPreviewProgress> = {}): RedmineReconciliationPreviewProgress => ({ previewIdentity: "33333333-3333-4333-8333-333333333333", mode: "full", cutoff: "2026-08-24T12:00:00.000Z", checkpoint: null, complete: false, scannedCount: 100, remainingCount: 1, eligibleUnlinkedCount: 4, excludedPrivateCount: 2, linkedCount: 3, mappingGaps: { statusIds: [], priorityIds: [], assigneeRemoteUserIds: [] }, ...overrides });
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const reviewItem = (remoteTitle = "Remote title", localTitle = "Local title", titleContribution = 40): RedmineReconciliationReviewItem => ({
  remote: { id: "42", title: remoteTitle, sourceVersion: hash("a") },
  recommendations: [{ id: "44444444-4444-4444-8444-444444444444", score: titleContribution + 33, factorEvidence: { scorerVersion: "redmine-reconciliation-score.v1", projectEligible: true, titleContribution, descriptionContribution: 20, dateComparable: true, dateContribution: 8, assigneeComparable: false, assigneeContribution: 0, stateComparable: true, stateContribution: 5, score: titleContribution + 33, localFingerprint: hash("b"), remoteFingerprint: hash("c") }, localIssue: { id: "55555555-5555-4555-8555-555555555555", key: "KAN-7", title: localTitle }, decisionState: "pending", decisionKind: null, decidedById: null, decidedAt: null, acceptedRefId: null }],
  manualCandidate: null,
});
const reviewPage = (items: RedmineReconciliationReviewItem[] = [reviewItem()], overrides: Partial<RedmineReconciliationReviewPage> = {}): RedmineReconciliationReviewPage => ({ previewIdentity: progress().previewIdentity, processedCandidateCount: items.length, remainingCandidateCount: 0, hiddenCount: 0, linkedCount: 0, items, nextCursor: null, ...overrides });
const manualCandidate = (title = "Manual title", titleContribution = 30, localHash = "d", remoteHash = "e"): NonNullable<RedmineReconciliationReviewItem["manualCandidate"]> => ({ score: titleContribution + 33, factorEvidence: { ...reviewItem().recommendations[0]!.factorEvidence, titleContribution, score: titleContribution + 33, localFingerprint: hash(localHash), remoteFingerprint: hash(remoteHash) }, localIssue: { id: "77777777-7777-4777-8777-777777777777", key: "KAN-9", title } });
const manualResult = (candidate = manualCandidate()): RedmineReconciliationReviewItem => ({ ...reviewItem(), manualCandidate: candidate });
type CommandName = keyof typeof commands;
type Callbacks = { onSuccess: (value: unknown) => void; onError: (error: { code: string; message: string }) => void };
const callbacks = (name: CommandName) => commands[name].mutate.mock.calls.at(-1)?.[1] as Callbacks;
const succeed = (name: CommandName, value: unknown) => act(() => callbacks(name).onSuccess(value));
const fail = (name: CommandName, code: string) => act(() => callbacks(name).onError({ code, message: code }));
const renderModal = (onClose = vi.fn(), modalQueue = queue) => ({ onClose, ...render(<RedmineReconciliationModal workspaceId="workspace" connectionId="connection" queue={modalQueue} onClose={onClose} />) });
const enterReview = (modalQueue = queue) => { const view = renderModal(vi.fn(), modalQueue); fireEvent.click(screen.getByRole("radio", { name: "Import existing issues" })); fireEvent.click(screen.getByRole("button", { name: "Start preview" })); succeed("preview", progress({ complete: true, remainingCount: 0, eligibleUnlinkedCount: 1 })); return view; };
const loadReview = (page = reviewPage(), modalQueue = queue) => { const view = enterReview(modalQueue); fireEvent.click(screen.getByRole("button", { name: "Load recommendations" })); succeed("review", page); return view; };
const selectManual = () => { const view = loadReview(); fireEvent.click(screen.getByRole("button", { name: "Search for another Kanon issue" })); fireEvent.change(screen.getByRole("textbox", { name: "Search Kanon issues" }), { target: { value: "manual" } }); fireEvent.click(screen.getByRole("button", { name: "KAN-9 — Manual result" })); return view; };

describe("RedmineReconciliationModal", () => {
  beforeEach(() => { vi.clearAllMocks(); Object.values(commands).forEach((command) => { command.pending = false; }); issueSearch.fetching = false; issueSearch.data = [{ id: "77777777-7777-4777-8777-777777777777", key: "KAN-9", title: "Manual result" }]; });

  it("starts explicitly for the first binding and continues incomplete full previews", () => {
    renderModal();
    expect(commands.preview.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Project 1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Import existing issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    expect(commands.preview.hook).toHaveBeenCalledWith("workspace", "connection", queue[0]!.bindingId);
    expect(commands.preview.mutate.mock.calls[0]?.[0]).toEqual({ mode: "full" });
    succeed("preview", progress());
    expect(screen.getByText("Scanned 100 · Remaining 1 · Eligible 4 · Private 2 · Linked 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue preview" }));
    expect(commands.preview.mutate.mock.calls[1]?.[0]).toEqual({ mode: "full" });
  });

  it("supports future-only readiness without importing history", () => {
    renderModal();
    fireEvent.click(screen.getByRole("radio", { name: "Only sync future changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    succeed("preview", progress({ mode: "future_only", complete: true, remainingCount: 0, eligibleUnlinkedCount: 0 }));
    expect(screen.getByText("This project is ready for activation.")).toBeInTheDocument();
  });

  it("offers reducer-directed retry or restart and stops on mapping blockers", () => {
    renderModal();
    fireEvent.click(screen.getByRole("radio", { name: "Import existing issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    fail("preview", "REDMINE_CONNECTION_FAILED");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(commands.preview.mutate).toHaveBeenCalledTimes(2);
    fail("preview", "REDMINE_RECONCILIATION_SCOPE_STALE");
    fireEvent.click(screen.getByRole("button", { name: "Restart preview" }));
    expect(commands.preview.mutate.mock.calls[2]?.[0]).toEqual({ mode: "full" });
    succeed("preview", progress({ complete: true, remainingCount: 0, mappingGaps: { statusIds: ["1"], priorityIds: [], assigneeRemoteUserIds: [] } }));
    expect(screen.getByRole("alert")).toHaveTextContent("Complete the missing status, priority, or assignee mappings");
    expect(screen.queryByRole("button", { name: "Continue preview" })).not.toBeInTheDocument();
  });

  it("guards every close path only while a preview is pending", () => {
    const view = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("redmine-reconciliation-backdrop"));
    expect(view.onClose).toHaveBeenCalledTimes(3);
    commands.preview.pending = true;
    view.rerender(<RedmineReconciliationModal workspaceId="workspace" connectionId="connection" queue={queue} onClose={view.onClose} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("redmine-reconciliation-backdrop"));
    expect(view.onClose).toHaveBeenCalledTimes(3);
  });

  it("loads a bounded page explicitly and explains additive recommendation evidence", () => {
    enterReview();
    expect(commands.review.mutate).not.toHaveBeenCalled();
    const load = screen.getByRole("button", { name: "Load recommendations" });
    fireEvent.click(load); fireEvent.click(load);
    expect(commands.review.mutate).toHaveBeenCalledTimes(1);
    expect(commands.review.mutate.mock.calls[0]?.[0]).toEqual({ limit: 5 });
    succeed("review", reviewPage());
    expect(screen.getByText("Redmine #42")).toBeInTheDocument();
    expect(screen.getByText("1 issues require review before activation.")).toBeInTheDocument();
    expect(screen.getByText("Remote title")).toBeInTheDocument();
    expect(screen.getByText("KAN-7 — Local title")).toBeInTheDocument();
    for (const text of ["Heuristic score: 73 points", "Title: 40/50", "Description: 20/25", "Date: 8/10", "Assignee: Not compared", "State: 5/5"]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/%|confidence/i);
    expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
  });

  it("accepts a suggestion exactly and resolves replayed decisions terminally", () => {
    loadReview();
    fireEvent.click(screen.getByRole("button", { name: "Link Redmine #42 to KAN-7" }));
    expect(commands.decision.mutate.mock.calls[0]?.[0]).toEqual({ remoteIssueId: "42", decision: { kind: "accept", recommendationId: "44444444-4444-4444-8444-444444444444" } });
    succeed("decision", { remoteIssueId: "42", candidateIssueId: "55555555-5555-4555-8555-555555555555", recommendationId: "44444444-4444-4444-8444-444444444444", refId: "66666666-6666-4666-8666-666666666666", replayed: true });
    expect(screen.queryByText("Redmine #42")).not.toBeInTheDocument();
    expect(screen.getByText("This project is ready for activation.")).toBeInTheDocument();
  });

  it("keeps the no-match terminal action available with zero suggestions", () => {
    loadReview(reviewPage([{ ...reviewItem(), recommendations: [] }]));
    expect(screen.getByRole("button", { name: "None of these suggestions match" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Link Redmine/ })).not.toBeInTheDocument();
  });

  it("resolves no-match and preserves the opaque cursor until the explicit next page", () => {
    loadReview(reviewPage([reviewItem()], { remainingCandidateCount: 1, nextCursor: "Opaque_cursor_2" }));
    expect(screen.getByRole("button", { name: "Load next recommendations" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "None of these suggestions match" }));
    expect(commands.decision.mutate.mock.calls[0]?.[0]).toEqual({ remoteIssueId: "42", decision: { kind: "reject-all" } });
    succeed("decision", { remoteIssueId: "42", rejectedCount: 1, replayed: false });
    const next = screen.getByRole("button", { name: "Load next recommendations" });
    expect(next).toBeEnabled(); fireEvent.click(next);
    expect(commands.review.mutate.mock.calls[1]?.[0]).toEqual({ limit: 5, cursor: "Opaque_cursor_2" });
    succeed("review", reviewPage([], { processedCandidateCount: 1, hiddenCount: 1 }));
    expect(screen.getByText("This project is ready for activation.")).toBeInTheDocument();
  });

  it("retries the exact page cursor and exact decision, then refreshes a stale item", () => {
    enterReview();
    fireEvent.click(screen.getByRole("button", { name: "Load recommendations" }));
    succeed("review", reviewPage([], { processedCandidateCount: 1, hiddenCount: 1, remainingCandidateCount: 1, nextCursor: "Opaque_retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Load next recommendations" }));
    fail("review", "REDMINE_CONNECTION_FAILED"); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(commands.review.mutate).toHaveBeenCalledTimes(3);
    expect(commands.review.mutate.mock.calls.at(-1)?.[0]).toEqual({ limit: 5, cursor: "Opaque_retry" });
    succeed("review", reviewPage());
    fireEvent.click(screen.getByRole("button", { name: "Link Redmine #42 to KAN-7" }));
    const decision = commands.decision.mutate.mock.calls[0]?.[0];
    fail("decision", "REDMINE_CONNECTION_FAILED"); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(commands.decision.mutate.mock.calls[1]?.[0]).toEqual(decision);
    fail("decision", "REDMINE_RECONCILIATION_LOCAL_STALE");
    expect(commands.materialize.mutate.mock.calls[0]?.[0]).toEqual({ remoteIssueId: "42" });
    fail("materialize", "REDMINE_CONNECTION_FAILED"); fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(commands.materialize.mutate.mock.calls[1]?.[0]).toEqual({ remoteIssueId: "42" });
    succeed("materialize", reviewItem("Updated remote", "Updated local", 35));
    expect(screen.getByText("Updated remote")).toBeInTheDocument();
    expect(screen.getByText("Heuristic score: 68 points")).toBeInTheDocument();
  });

  it("treats every command as one busy boundary for controls and closing", () => {
    const view = loadReview(reviewPage([reviewItem()], { remainingCandidateCount: 1, nextCursor: "Opaque_busy" }));
    for (const name of Object.keys(commands) as CommandName[]) {
      commands[name].pending = true; view.rerender(<RedmineReconciliationModal workspaceId="workspace" connectionId="connection" queue={queue} onClose={view.onClose} />);
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Link Redmine #42 to KAN-7" })).toBeDisabled();
      expect(screen.getByRole("radio", { name: "Import existing issues" })).toBeDisabled();
      commands[name].pending = false;
    }
    commands.review.pending = true; view.rerender(<RedmineReconciliationModal workspaceId="workspace" connectionId="connection" queue={queue} onClose={view.onClose} />);
    fireEvent.keyDown(document, { key: "Escape" }); fireEvent.click(screen.getByTestId("redmine-reconciliation-backdrop"));
    expect(view.onClose).not.toHaveBeenCalled();
  });

  it("mounts scoped search only after three trimmed characters and hides stale results while fetching", () => {
    const onSelect = vi.fn();
    const props = { remoteIssueId: "42", projectKey: "KAN", excludedIssueIds: ["excluded"], candidate: null, disabled: false, failure: null, onSelect, onConfirm: vi.fn(), onCancel: vi.fn(), onQueryChange: vi.fn(), onRetry: vi.fn() };
    issueSearch.data = [{ id: "excluded", key: "KAN-1", title: "Suggested" }, ...Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, key: `KAN-${index + 2}`, title: `Issue ${index}` }))];
    const view = render(<RedmineReconciliationManualLink {...props} />);
    const input = screen.getByRole("textbox", { name: "Search Kanon issues" });
    fireEvent.change(input, { target: { value: "  ab  " } }); expect(issueSearch.hook).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " raw " } }); expect(issueSearch.hook).toHaveBeenLastCalledWith("KAN", " raw ", {});
    const results = within(screen.getByRole("list")).getAllByRole("button");
    expect(results).toHaveLength(10); expect(screen.queryByText("Suggested")).not.toBeInTheDocument();
    issueSearch.fetching = true; view.rerender(<RedmineReconciliationManualLink {...props} />);
    expect(screen.getByText("Searching…")).toBeInTheDocument(); expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("materializes a selected candidate and confirms only with server fingerprints", () => {
    selectManual();
    expect(commands.materialize.mutate.mock.calls[0]?.[0]).toEqual({ remoteIssueId: "42", candidateIssueId: "77777777-7777-4777-8777-777777777777" });
    expect(screen.queryByRole("button", { name: "Confirm link to KAN-9" })).not.toBeInTheDocument();
    succeed("materialize", manualResult());
    expect(screen.getByText("Heuristic score: 63 points")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm link to KAN-9" }));
    expect(commands.decision.mutate.mock.calls[0]?.[0]).toEqual({ remoteIssueId: "42", decision: { kind: "manual-link", candidateIssueId: "77777777-7777-4777-8777-777777777777", localFingerprint: hash("d"), remoteFingerprint: hash("e") } });
    succeed("decision", { remoteIssueId: "42", candidateIssueId: "77777777-7777-4777-8777-777777777777", recommendationId: "88888888-8888-4888-8888-888888888888", refId: "99999999-9999-4999-8999-999999999999", replayed: true });
    expect(screen.getByText("This project is ready for activation.")).toBeInTheDocument();
  });

  it("retries exact manual inputs and refreshes stale evidence without auto-linking", () => {
    selectManual(); const target = commands.materialize.mutate.mock.calls[0]?.[0];
    fail("materialize", "REDMINE_CONNECTION_FAILED"); fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(commands.materialize.mutate.mock.calls[1]?.[0]).toEqual(target);
    succeed("materialize", manualResult()); fireEvent.click(screen.getByRole("button", { name: "Confirm link to KAN-9" }));
    const decision = commands.decision.mutate.mock.calls[0]?.[0]; fail("decision", "REDMINE_CONNECTION_FAILED"); fireEvent.click(screen.getByRole("button", { name: "Retry" })); expect(commands.decision.mutate.mock.calls[1]?.[0]).toEqual(decision);
    fail("decision", "REDMINE_RECONCILIATION_LOCAL_STALE"); expect(commands.materialize.mutate.mock.calls.at(-1)?.[0]).toEqual(target);
    succeed("materialize", manualResult(manualCandidate("Updated manual", 25, "f", "0")));
    expect(commands.decision.mutate).toHaveBeenCalledTimes(2); expect(screen.getByText("KAN-9 — Updated manual")).toBeInTheDocument(); expect(screen.getByText("Heuristic score: 58 points")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm link to KAN-9" }));
    expect(commands.decision.mutate.mock.calls[2]?.[0]).toEqual({ remoteIssueId: "42", decision: { kind: "manual-link", candidateIssueId: "77777777-7777-4777-8777-777777777777", localFingerprint: hash("f"), remoteFingerprint: hash("0") } });
  });

  it.each(["REDMINE_RECONCILIATION_CANDIDATE_INVALID", "REDMINE_RECONCILIATION_ALREADY_LINKED"])("clears unavailable manual candidates for %s", (code) => {
    selectManual(); fail("materialize", code);
    expect(screen.queryByRole("button", { name: "Confirm link to KAN-9" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(code);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Kanon issues" }), { target: { value: "changed" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps suggested decisions available when the project key is unavailable", () => {
    loadReview(reviewPage(), [{ ...queue[0]!, projectKey: null }]);
    expect(issueSearch.hook).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Search for another Kanon issue" })).toBeDisabled();
    expect(screen.getByText("Manual search is unavailable because this project key could not be resolved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link Redmine #42 to KAN-7" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "None of these suggestions match" })).toBeEnabled();
  });
});
