import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { ThroughputChart } from "../throughput-chart";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function makeItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    id: "item-1",
    title: "Default item",
    horizon: "now",
    status: "idea",
    labels: [],
    sortOrder: 0,
    promoted: false,
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ThroughputChart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-26T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders empty state when nothing has shipped recently", () => {
    render(<ThroughputChart items={[makeItem({ status: "idea" })]} />);
    expect(
      screen.getByText("No items shipped in the last 12 weeks."),
    ).toBeInTheDocument();
  });

  it("counts done items only and computes a positive avg/wk", () => {
    const recent = new Date(Date.now() - 2 * MS_PER_WEEK).toISOString();
    const items: RoadmapItem[] = [
      makeItem({ id: "1", status: "done", updatedAt: recent }),
      makeItem({ id: "2", status: "done", updatedAt: recent }),
      makeItem({ id: "3", status: "done", updatedAt: recent }),
      makeItem({ id: "4", status: "in_progress", updatedAt: recent }),
    ];
    render(<ThroughputChart items={items} />);
    expect(screen.getByText("Avg / wk")).toBeInTheDocument();
    expect(screen.getByText(/0\.[1-9]/)).toBeInTheDocument(); // some non-zero average
  });

  it("renders ETA cells with weeks units when avg > 0", () => {
    const recent = new Date(Date.now() - 1 * MS_PER_WEEK).toISOString();
    const items: RoadmapItem[] = [
      ...Array.from({ length: 12 }, (_, i) =>
        makeItem({ id: `d${i}`, status: "done", updatedAt: recent }),
      ),
      makeItem({ id: "n1", horizon: "now", status: "in_progress" }),
    ];
    render(<ThroughputChart items={items} />);
    expect(screen.getByText("ETA · all Now")).toBeInTheDocument();
    expect(screen.getByText("ETA · Now+Next")).toBeInTheDocument();
  });
});
