/**
 * KAN-33 slice 1 — SyncedFromToolsSlot tests (Strict TDD — RED first).
 *
 * Scenarios from spec.md § 3:
 *   - empty state when no tool-attributed items exist
 *   - filters out web / null / unknown via
 *   - renders supported tool-via rows with correct labels
 *   - newest-first ordering
 *   - header & caption text present
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { TimelineItem } from "../timeline-types";
import { SyncedFromToolsSlot, filterAndReverse } from "../synced-from-tools-slot";
import { useUnifiedTimeline } from "../use-unified-timeline";
import { SUPPORTED_TOOL_VIAS } from "../via-badge";

vi.mock("../use-unified-timeline", () => ({ useUnifiedTimeline: vi.fn() }));
const mockedHook = vi.mocked(useUnifiedTimeline);
afterEach(() => vi.clearAllMocks());

type O = { id: string; createdAt: string; via: string | null; body?: string };

const base = (o: O) => ({ id: o.id, via: o.via, createdAt: o.createdAt });

const ag = (o: O): TimelineItem => ({
  ...base(o), kind: "agent-comment", body: o.body ?? "agent body",
  source: "mcp", author: { id: "a1", username: "claude" },
});
const hu = (o: O): TimelineItem => ({
  ...base(o), kind: "human-comment", body: o.body ?? "human body",
  author: { id: "u1", username: "alice" },
});
const sc = (o: O): TimelineItem => ({
  ...base(o), kind: "state-change", from: "backlog", to: "in_progress",
  actor: { id: "u1", username: "alice" },
});

const setup = (items: TimelineItem[] = []) => {
  mockedHook.mockReturnValue({ items, isLoading: false, isError: false } as ReturnType<typeof useUnifiedTimeline>);
  return render(<SyncedFromToolsSlot issueKey="KAN-1" />);
};

describe("SyncedFromToolsSlot", () => {
  it("renders header, caption, testid, and empty state", () => {
    setup();
    expect(screen.getByText("Synced from your tools")).toBeInTheDocument();
    expect(screen.getByText("attributed to you")).toBeInTheDocument();
    expect(screen.getByTestId("synced-from-tools")).toBeInTheDocument();
    expect(screen.getByText("Nothing synced yet from your tools.")).toBeInTheDocument();
  });

  it("does NOT render an Undo button (out of scope for slice 1)", () => {
    setup([ag({ id: "a1", createdAt: "2026-06-01T10:00:00Z", via: "claude-code" })]);
    expect(screen.queryByText(/^Undo$/)).not.toBeInTheDocument();
  });

  it.each([
    ["null via",    null,          "claude-code"],
    ["web via",     "web",         "cursor"],
    ["unknown via", "future-tool", "cli"],
  ] as const)("filters out %s and keeps the supported one", (_label, noiseVia, keptVia) => {
    setup([
      hu({ id: "h1", createdAt: "2026-06-01T10:00:00Z", via: noiseVia }),
      ag({ id: "a1", createdAt: "2026-06-01T11:00:00Z", via: keptVia }),
    ]);
    const rows = screen.getAllByTestId("synced-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-via")).toBe(keptVia);
  });

  it("excludes activity items with via=null (state-changes authored in web)", () => {
    setup([sc({ id: "s1", createdAt: "2026-06-01T10:00:00Z", via: null })]);
    expect(screen.getByText("Nothing synced yet from your tools.")).toBeInTheDocument();
  });

  it.each([
    ["claude-code", "Claude Code"],
    ["cursor",      "Cursor"],
    ["codex",       "Codex"],
    ["antigravity", "Antigravity"],
    ["cli",         "CLI"],
  ] as const)("renders via=%s with the label %s", (via, label) => {
    setup([ag({ id: "a1", createdAt: "2026-06-01T10:00:00Z", via, body: "hello tool" })]);
    const row = screen.getByTestId("synced-row");
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(row.getAttribute("data-via")).toBe(via);
  });

  it.each([
    "all-supported oldest-first",
    "interleaved noise (web/null/unknown)",
  ] as const)("renders %s newest-first", (label) => {
    const items = label === "all-supported oldest-first"
      ? [
          ag({ id: "a1", createdAt: "2026-06-01T10:00:00Z", via: "claude-code", body: "first" }),
          ag({ id: "a2", createdAt: "2026-06-01T11:00:00Z", via: "cursor",      body: "second" }),
          ag({ id: "a3", createdAt: "2026-06-01T12:00:00Z", via: "cli",         body: "third" }),
        ]
      : [
          ag({ id: "a1", createdAt: "2026-06-01T10:00:00Z", via: "claude-code" }),
          hu({ id: "h1", createdAt: "2026-06-01T10:30:00Z", via: "web" }),
          ag({ id: "a2", createdAt: "2026-06-01T11:00:00Z", via: "future-tool" }),
          ag({ id: "a3", createdAt: "2026-06-01T12:00:00Z", via: "cursor" }),
        ];
    const expected = label === "all-supported oldest-first"
      ? ["cli", "cursor", "claude-code"]
      : ["cursor", "claude-code"];
    setup(items);
    const rows = screen.getAllByTestId("synced-row");
    expect(rows.map((r) => r.getAttribute("data-via"))).toEqual(expected);
    if (label === "all-supported oldest-first") {
      expect(within(rows[0]!).getByText("third")).toBeInTheDocument();
      expect(within(rows[rows.length - 1]!).getByText("first")).toBeInTheDocument();
    }
  });
});

describe("filterAndReverse — pure helper", () => {
  it("returns an empty array when input is empty", () => {
    expect(filterAndReverse([], SUPPORTED_TOOL_VIAS)).toEqual([]);
  });

  it("returns a new array (does not mutate input)", () => {
    const items = [ag({ id: "a1", createdAt: "2026-06-01T10:00:00Z", via: "claude-code" })];
    const copy = items.slice();
    filterAndReverse(items, SUPPORTED_TOOL_VIAS);
    expect(items).toEqual(copy);
  });
});
