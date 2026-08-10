/**
 * KAN-32 — UnifiedTimeline component tests (Strict TDD — RED first).
 *
 * Scenarios 1, 7, 8 from spec.md § 4.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnifiedTimeline } from "../unified-timeline";
import type { TimelineItem } from "../timeline-types";

function makeStateChangeItem(id: string, createdAt: string): TimelineItem {
  return {
    kind: "state-change",
    id,
    via: null,
    createdAt,
    from: "backlog",
    to: "in_progress",
    actor: { id: "u1", username: "alice" },
  };
}

function makeHumanCommentItem(id: string, createdAt: string, body = "hello"): TimelineItem {
  return {
    kind: "human-comment",
    id,
    via: null,
    createdAt,
    body,
    author: { id: "u1", username: "alice" },
  };
}

describe("UnifiedTimeline — Scenario 1: mixed feed renders all items oldest-first", () => {
  it("renders the correct number of items", () => {
    const items: TimelineItem[] = [
      makeStateChangeItem("a1", "2026-06-01T09:00:00Z"),
      makeHumanCommentItem("c1", "2026-06-01T10:00:00Z"),
      makeStateChangeItem("a2", "2026-06-01T11:00:00Z"),
    ];

    render(<UnifiedTimeline items={items} isLoading={false} isError={false} />);

    // All 3 items rendered (find by username or content)
    expect(screen.getAllByTestId("timeline-item")).toHaveLength(3);
  });
});

describe("UnifiedTimeline — Scenario 7: empty state", () => {
  it("shows an empty-state indicator when items is empty", () => {
    render(<UnifiedTimeline items={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("timeline-empty")).toBeDefined();
  });
});

describe("UnifiedTimeline — Scenario 8: loading state", () => {
  it("shows a loading indicator when isLoading=true", () => {
    render(<UnifiedTimeline items={[]} isLoading={true} isError={false} />);
    expect(screen.getByTestId("timeline-loading")).toBeDefined();
  });
});

describe("UnifiedTimeline — remote authors", () => {
  it("renders the provider beside the remote display name", () => {
    const item: TimelineItem = {
      kind: "human-comment",
      id: "remote-comment",
      via: "redmine-inbound",
      createdAt: "2026-06-01T10:00:00Z",
      body: "Remote body",
      author: {
        username: "Remote author",
        provider: "redmine",
      },
    };

    render(<UnifiedTimeline items={[item]} isLoading={false} isError={false} />);

    expect(screen.getByText("Remote author (redmine)")).toBeDefined();
  });
});
