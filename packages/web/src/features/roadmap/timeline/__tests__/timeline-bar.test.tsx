import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TimelineBar } from "../timeline-bar";
import { STATUS_CHART_COLORS } from "../../analytics/chart-colors";

describe("TimelineBar", () => {
  const baseProps = {
    x: 10,
    y: 20,
    width: 100,
    height: 24,
  };

  it("renders a solid rect for items with targetDate (not open-ended)", () => {
    const { container } = render(
      <svg>
        <TimelineBar
          {...baseProps}
          payload={{ isOpenEnded: false, status: "planned" }}
        />
      </svg>,
    );

    const rect = container.querySelector("rect");
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute("fill")).toBe(STATUS_CHART_COLORS.planned);
    expect(rect?.getAttribute("fill-opacity")).toBe("1");
    expect(rect?.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("renders a dashed rect with reduced opacity for open-ended items", () => {
    const { container } = render(
      <svg>
        <TimelineBar
          {...baseProps}
          payload={{ isOpenEnded: true, status: "idea" }}
        />
      </svg>,
    );

    const rect = container.querySelector("rect");
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute("fill")).toBe(STATUS_CHART_COLORS.idea);
    expect(rect?.getAttribute("fill-opacity")).toBe("0.6");
    expect(rect?.getAttribute("stroke-dasharray")).toBe("4 3");
    expect(rect?.getAttribute("stroke")).toBe(STATUS_CHART_COLORS.idea);
  });

  it("maps status to correct color from STATUS_CHART_COLORS", () => {
    for (const status of ["idea", "planned", "in_progress", "done"] as const) {
      const { container } = render(
        <svg>
          <TimelineBar
            {...baseProps}
            payload={{ isOpenEnded: false, status }}
          />
        </svg>,
      );
      const rect = container.querySelector("rect");
      expect(rect?.getAttribute("fill")).toBe(STATUS_CHART_COLORS[status]);
    }
  });

  it("returns null when width is zero or negative", () => {
    const { container } = render(
      <svg>
        <TimelineBar {...baseProps} width={0} payload={{ isOpenEnded: false, status: "idea" }} />
      </svg>,
    );
    expect(container.querySelector("rect")).toBeNull();
  });

  it("returns null when height is zero or negative", () => {
    const { container } = render(
      <svg>
        <TimelineBar {...baseProps} height={-1} payload={{ isOpenEnded: false, status: "idea" }} />
      </svg>,
    );
    expect(container.querySelector("rect")).toBeNull();
  });

  it("applies rounded corners (rx/ry)", () => {
    const { container } = render(
      <svg>
        <TimelineBar
          {...baseProps}
          payload={{ isOpenEnded: false, status: "done" }}
        />
      </svg>,
    );
    const rect = container.querySelector("rect");
    expect(rect?.getAttribute("rx")).toBe("3");
    expect(rect?.getAttribute("ry")).toBe("3");
  });
});
