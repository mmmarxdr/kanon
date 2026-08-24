import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedmineReconciliationPreviewProgress } from "./redmine-reconciliation-flow";
import { RedmineReconciliationModal, type RedmineReconciliationQueueItem } from "./redmine-reconciliation-modal";

const preview = vi.hoisted(() => ({ mutate: vi.fn(), hook: vi.fn(), pending: false }));
vi.mock("focus-trap-react", () => ({ FocusTrap: ({ children }: { children: ReactNode }) => children }));
vi.mock("./use-redmine-reconciliation", () => ({ useRedmineReconciliationPreviewMutation: (...args: string[]) => { preview.hook(...args); return { mutate: preview.mutate, isPending: preview.pending }; } }));

const queue: readonly RedmineReconciliationQueueItem[] = [
  { bindingId: "11111111-1111-4111-8111-111111111111", projectId: "p1", remoteProjectId: "r1", projectName: "Kanon One", remoteProjectName: "Redmine One" },
  { bindingId: "22222222-2222-4222-8222-222222222222", projectId: "p2", remoteProjectId: "r2", projectName: "Kanon Two", remoteProjectName: "Redmine Two" },
];
const progress = (overrides: Partial<RedmineReconciliationPreviewProgress> = {}): RedmineReconciliationPreviewProgress => ({ previewIdentity: "33333333-3333-4333-8333-333333333333", mode: "full", cutoff: "2026-08-24T12:00:00.000Z", checkpoint: null, complete: false, scannedCount: 100, remainingCount: 1, eligibleUnlinkedCount: 4, excludedPrivateCount: 2, linkedCount: 3, mappingGaps: { statusIds: [], priorityIds: [], assigneeRemoteUserIds: [] }, ...overrides });
type Callbacks = { onSuccess: (value: RedmineReconciliationPreviewProgress) => void; onError: (error: { code: string; message: string }) => void };
const callbacks = () => preview.mutate.mock.calls.at(-1)?.[1] as Callbacks;
const renderModal = (onClose = vi.fn()) => ({ onClose, ...render(<RedmineReconciliationModal workspaceId="workspace" connectionId="connection" queue={queue} onClose={onClose} />) });

describe("RedmineReconciliationModal", () => {
  beforeEach(() => { vi.clearAllMocks(); preview.pending = false; });

  it("starts explicitly for the first binding and continues incomplete full previews", () => {
    renderModal();
    expect(preview.mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Project 1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Import existing issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    expect(preview.hook).toHaveBeenCalledWith("workspace", "connection", queue[0]!.bindingId);
    expect(preview.mutate.mock.calls[0]?.[0]).toEqual({ mode: "full" });
    act(() => callbacks().onSuccess(progress()));
    expect(screen.getByText("Scanned 100 · Remaining 1 · Eligible 4 · Private 2 · Linked 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue preview" }));
    expect(preview.mutate.mock.calls[1]?.[0]).toEqual({ mode: "full" });
  });

  it("supports future-only readiness without importing history", () => {
    renderModal();
    fireEvent.click(screen.getByRole("radio", { name: "Only sync future changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    act(() => callbacks().onSuccess(progress({ mode: "future_only", complete: true, remainingCount: 0, eligibleUnlinkedCount: 0 })));
    expect(screen.getByText("This project is ready for activation.")).toBeInTheDocument();
  });

  it("offers reducer-directed retry or restart and stops on mapping blockers", () => {
    renderModal();
    fireEvent.click(screen.getByRole("radio", { name: "Import existing issues" }));
    fireEvent.click(screen.getByRole("button", { name: "Start preview" }));
    act(() => callbacks().onError({ code: "REDMINE_CONNECTION_FAILED", message: "Temporary" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(preview.mutate).toHaveBeenCalledTimes(2);
    act(() => callbacks().onError({ code: "REDMINE_RECONCILIATION_SCOPE_STALE", message: "Changed" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart preview" }));
    expect(preview.mutate.mock.calls[2]?.[0]).toEqual({ mode: "full" });
    act(() => callbacks().onSuccess(progress({ complete: true, remainingCount: 0, mappingGaps: { statusIds: ["1"], priorityIds: [], assigneeRemoteUserIds: [] } })));
    expect(screen.getByRole("alert")).toHaveTextContent("Complete the missing status, priority, or assignee mappings");
    expect(screen.queryByRole("button", { name: "Continue preview" })).not.toBeInTheDocument();
  });

  it("guards every close path only while a preview is pending", () => {
    const view = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("redmine-reconciliation-backdrop"));
    expect(view.onClose).toHaveBeenCalledTimes(3);
    preview.pending = true;
    view.rerender(<RedmineReconciliationModal workspaceId="workspace" connectionId="connection" queue={queue} onClose={view.onClose} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("redmine-reconciliation-backdrop"));
    expect(view.onClose).toHaveBeenCalledTimes(3);
  });
});
