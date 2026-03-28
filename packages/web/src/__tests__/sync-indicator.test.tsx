import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { SyncIndicator, type SyncIndicatorProps } from "@/components/sync-indicator";

function renderIndicator(overrides: Partial<SyncIndicatorProps> = {}) {
  const defaultProps: SyncIndicatorProps = {
    status: "connected",
    lastSyncAt: null,
    syncHistory: [],
    isManualSyncing: false,
    onTriggerSync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return render(<SyncIndicator {...defaultProps} />);
}

describe("SyncIndicator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when status is null", () => {
    const { container } = renderIndicator({ status: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders the indicator dot when status is connected", () => {
    renderIndicator({ status: "connected" });
    expect(screen.getByTestId("sync-indicator-button")).toBeInTheDocument();
  });

  it("opens popover on click", () => {
    renderIndicator({ status: "connected" });

    expect(screen.queryByTestId("sync-popover")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByTestId("sync-popover")).toBeInTheDocument();
  });

  it("closes popover on second click", () => {
    renderIndicator({ status: "connected" });

    const button = screen.getByTestId("sync-indicator-button");
    fireEvent.click(button);
    expect(screen.getByTestId("sync-popover")).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.queryByTestId("sync-popover")).not.toBeInTheDocument();
  });

  it("closes popover on outside click", () => {
    renderIndicator({ status: "connected" });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));
    expect(screen.getByTestId("sync-popover")).toBeInTheDocument();

    // Click outside the popover
    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId("sync-popover")).not.toBeInTheDocument();
  });

  it("shows 'No sync events yet' when syncHistory is empty", () => {
    renderIndicator({ status: "connected" });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByText("No sync events yet")).toBeInTheDocument();
  });

  it("renders sync history events", () => {
    renderIndicator({
      status: "connected",
      syncHistory: [
        { type: "sync_complete", timestamp: new Date().toISOString(), changedCount: 5 },
        { type: "sync_error", timestamp: new Date().toISOString(), message: "Network error" },
      ],
    });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByText("Synced 5 items")).toBeInTheDocument();
    expect(screen.getByText(/Error: Network error/)).toBeInTheDocument();
  });

  it("shows last sync time when available", () => {
    renderIndicator({
      status: "connected",
      lastSyncAt: new Date().toISOString(),
    });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByText(/Last sync:/)).toBeInTheDocument();
  });

  it("calls onTriggerSync when Sync Now button is clicked", () => {
    const onTriggerSync = vi.fn().mockResolvedValue(undefined);
    renderIndicator({ status: "connected", onTriggerSync });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));
    fireEvent.click(screen.getByTestId("sync-now-button"));

    expect(onTriggerSync).toHaveBeenCalledOnce();
  });

  it("disables Sync Now button when isManualSyncing is true", () => {
    renderIndicator({ status: "connected", isManualSyncing: true });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    const button = screen.getByTestId("sync-now-button");
    expect(button).toBeDisabled();
    expect(screen.getByText("Syncing...")).toBeInTheDocument();
  });

  it("disables Sync Now button when status is disconnected", () => {
    renderIndicator({ status: "disconnected" });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByTestId("sync-now-button")).toBeDisabled();
  });

  it("shows connection status text in popover", () => {
    renderIndicator({ status: "connected" });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByText("Sync connected")).toBeInTheDocument();
  });

  it("shows error status text in popover", () => {
    renderIndicator({ status: "error" });

    fireEvent.click(screen.getByTestId("sync-indicator-button"));

    expect(screen.getByText("Sync error")).toBeInTheDocument();
  });
});
