import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueGeneralNotes } from "../issue-general-notes";
import { UnifiedTimeline } from "../unified-timeline";
import type { TimelineItem } from "../timeline-types";

const comment: TimelineItem = {
  id: "redmine-note",
  kind: "human-comment",
  body: "Imported Redmine note",
  author: { username: "marie", provider: "redmine" },
  via: "codex",
  createdAt: "2026-08-12T10:00:00.000Z",
};
const activity: TimelineItem = {
  id: "state-change",
  kind: "state-change",
  actor: { username: "marie", provider: "redmine" },
  from: "todo",
  to: "in_progress",
  via: "redmine",
  createdAt: "2026-08-12T11:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("IssueGeneralNotes", () => {
  it("renders only comment notes with author, provider, via and timestamp while Activity retains the full timeline", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
    render(<><IssueGeneralNotes items={[comment, activity]} isLoading={false} isError={false} /><section aria-label="Activity"><UnifiedTimeline items={[comment, activity]} isLoading={false} isError={false} /></section></>);

    const notes = screen.getByRole("region", { name: "Kanon / Redmine notes" });
    expect(within(notes).getByText("Imported Redmine note")).toBeInTheDocument();
    expect(within(notes).getByText("marie (redmine)")).toBeInTheDocument();
    expect(within(notes).getByText("Codex")).toBeInTheDocument();
    expect(within(notes).getByText("2h ago")).toBeInTheDocument();
    expect(within(notes).queryByText(/changed state/)).not.toBeInTheDocument();

    const activityRegion = screen.getByRole("region", { name: "Activity" });
    expect(within(activityRegion).getByText(/changed state/)).toBeInTheDocument();
  });

  it("keeps empty or unavailable notes safe without inventing private-note data", () => {
    const { rerender } = render(<IssueGeneralNotes items={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("timeline-empty")).toHaveTextContent("No activity yet.");

    rerender(<IssueGeneralNotes items={[]} isLoading={false} isError />);
    expect(screen.getByTestId("timeline-error")).toHaveTextContent("Failed to load timeline.");
  });
});
