import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SyncedToolsSummaryContent } from "../synced-tools-summary";
import type { TimelineItem } from "../timeline-types";

const oldest: TimelineItem = {
  id: "sync-oldest",
  kind: "human-comment",
  body: "Older sync",
  author: { username: "alice" },
  via: "claude-code",
  createdAt: "2026-08-12T10:00:00.000Z",
};
const latest: TimelineItem = {
  id: "sync-latest",
  kind: "agent-comment",
  body: "Latest sync",
  source: "mcp",
  author: { username: "codex" },
  via: "codex",
  createdAt: "2026-08-12T12:00:00.000Z",
};

describe("SyncedToolsSummaryContent", () => {
  it("renders the synced count and only the latest provenance row", () => {
    render(<SyncedToolsSummaryContent items={[oldest, latest]} isLoading={false} isError={false} />);

    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent("2 synced tool items");
    expect(screen.getByTestId("synced-tools-summary-latest")).toHaveTextContent("Codex");
    expect(screen.getByTestId("synced-tools-summary-latest")).toHaveTextContent("2026-08-12T12:00:00.000Z");
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("synced-tools-summary-latest")).toHaveLength(1);
  });

  it.each([
    ["loading", { items: [latest], isLoading: true, isError: false }, "Loading synced tools…"],
    ["unavailable", { items: [latest], isLoading: false, isError: true }, "Synced tools are unavailable."],
    ["empty", { items: [], isLoading: false, isError: false }, "No synced tool activity."],
  ] as const)("renders the %s state without a history row", (_state, result, expected) => {
    render(<SyncedToolsSummaryContent {...result} />);

    expect(screen.getByTestId("synced-tools-summary")).toHaveTextContent(expected);
    expect(screen.queryByTestId("synced-tools-summary-latest")).not.toBeInTheDocument();
  });
});
