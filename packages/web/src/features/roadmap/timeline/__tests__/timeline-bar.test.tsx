import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { TimelineItem } from "../use-timeline-data";
import { TimelineBar } from "../timeline-bar";

function makeTimelineItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: "tl-1",
    title: "Default",
    start: 0,
    end: 4,
    status: "planned",
    horizon: "now",
    effort: 3,
    impact: 5,
    owner: null,
    ...overrides,
  };
}

describe("TimelineBar", () => {
  it("renders the item title and an E/I micro label", () => {
    const item = makeTimelineItem({ title: "Search v2", effort: 4, impact: 7 });
    render(<TimelineBar item={item} left={120} width={240} />);

    expect(screen.getByText("Search v2")).toBeInTheDocument();
    expect(screen.getByText(/E4\s*·\s*I7/)).toBeInTheDocument();
  });

  it("uses status='in_progress' styling (data-status attribute)", () => {
    const item = makeTimelineItem({ status: "in_progress" });
    const { container } = render(
      <TimelineBar item={item} left={0} width={200} />,
    );
    const bar = container.querySelector("[data-testid='timeline-bar']");
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute("data-status")).toBe("in_progress");
  });

  it("renders a progress fill for in_progress items", () => {
    const item = makeTimelineItem({ status: "in_progress" });
    const { container } = render(
      <TimelineBar item={item} left={0} width={200} />,
    );
    expect(
      container.querySelector("[data-testid='timeline-bar-progress']"),
    ).toBeTruthy();
  });

  it("does not render a progress fill for non-in_progress items", () => {
    for (const status of ["idea", "planned", "done"] as const) {
      const item = makeTimelineItem({ status });
      const { container } = render(
        <TimelineBar item={item} left={0} width={200} />,
      );
      expect(
        container.querySelector("[data-testid='timeline-bar-progress']"),
      ).toBeNull();
    }
  });

  it("uses dashed border for idea status", () => {
    const item = makeTimelineItem({ status: "idea" });
    const { container } = render(
      <TimelineBar item={item} left={0} width={200} />,
    );
    const bar = container.querySelector(
      "[data-testid='timeline-bar']",
    ) as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar?.style.borderStyle).toBe("dashed");
  });

  it("uses solid border for non-idea statuses", () => {
    for (const status of ["planned", "in_progress", "done"] as const) {
      const item = makeTimelineItem({ status });
      const { container } = render(
        <TimelineBar item={item} left={0} width={200} />,
      );
      const bar = container.querySelector(
        "[data-testid='timeline-bar']",
      ) as HTMLElement | null;
      expect(bar?.style.borderStyle).toBe("solid");
    }
  });

  it("absolutely positions itself using left/width pixels", () => {
    const item = makeTimelineItem();
    const { container } = render(
      <TimelineBar item={item} left={120} width={240} />,
    );
    const bar = container.querySelector(
      "[data-testid='timeline-bar']",
    ) as HTMLElement | null;
    expect(bar?.style.left).toBe("120px");
    expect(bar?.style.width).toBe("240px");
    expect(bar?.style.position).toBe("absolute");
  });

  it("falls back to dashes for missing effort/impact", () => {
    const item = makeTimelineItem({ effort: null, impact: null });
    render(<TimelineBar item={item} left={0} width={200} />);
    expect(screen.getByText(/E—\s*·\s*I—/)).toBeInTheDocument();
  });

  // ─── KAN-33 — hover glow ────────────────────────────────────────────

  it("applies the accent glow when hoveredItemId equals the item id", () => {
    const item = makeTimelineItem({ id: "tl-1" });
    const { container } = render(
      <TimelineBar item={item} left={0} width={200} hoveredItemId="tl-1" />,
    );
    const bar = container.querySelector(
      "[data-testid='timeline-bar']",
    ) as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.style.boxShadow).toMatch(/var\(--accent\)/);
  });

  it("dims to 0.4 opacity when another bar is hovered", () => {
    const item = makeTimelineItem({ id: "tl-1" });
    const { container } = render(
      <TimelineBar item={item} left={0} width={200} hoveredItemId="other" />,
    );
    const bar = container.querySelector(
      "[data-testid='timeline-bar']",
    ) as HTMLElement | null;
    expect(bar!.style.opacity).toBe("0.4");
  });

  it("does not dim or glow when no bar is hovered", () => {
    const item = makeTimelineItem({ id: "tl-1" });
    const { container } = render(
      <TimelineBar item={item} left={0} width={200} hoveredItemId={null} />,
    );
    const bar = container.querySelector(
      "[data-testid='timeline-bar']",
    ) as HTMLElement | null;
    expect(bar!.style.opacity === "" || bar!.style.opacity === "1").toBe(true);
    // boxShadow may be unset (empty string) when not hovered.
    expect(bar!.style.boxShadow === "" || bar!.style.boxShadow === "none").toBe(
      true,
    );
  });

  it("calls onHoverChange with id on mouseEnter and null on mouseLeave", () => {
    const item = makeTimelineItem({ id: "tl-1" });
    const onHoverChange = vi.fn();
    const { container } = render(
      <TimelineBar
        item={item}
        left={0}
        width={200}
        onHoverChange={onHoverChange}
      />,
    );
    const bar = container.querySelector(
      "[data-testid='timeline-bar']",
    ) as HTMLElement | null;
    fireEvent.mouseEnter(bar!);
    expect(onHoverChange).toHaveBeenCalledWith("tl-1");
    fireEvent.mouseLeave(bar!);
    expect(onHoverChange).toHaveBeenLastCalledWith(null);
  });
});
