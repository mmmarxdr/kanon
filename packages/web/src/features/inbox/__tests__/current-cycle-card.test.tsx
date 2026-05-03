/**
 * Tests para CurrentCycleCard y el subcomponente Sparkline (local).
 *
 * B2.1 — Sparkline renderiza SVG con path no vacío para values=[0,1,3,5,6]
 * B2.2 — Sparkline con values=[] no lanza y SVG existe
 * B3.1 — CurrentCycleCard normal: sparkline, donePct, avgLeadDays, velocity
 * B3.2 — CurrentCycleCard con avgLeadDays: null → muestra "—"
 * B3.3 — CurrentCycleCard con activeCycle: null → empty state, sin SVG
 * B4.1 — multipleActiveProjects=true incluye "(Phoenix)" en subtítulo
 * B4.2 — multipleActiveProjects=false NO incluye paréntesis en subtítulo
 *
 * Refs: REQ-INBOX-CYCLE-005, REQ-INBOX-CYCLE-006, design §4.1
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ActiveCycleKPIs } from "@kanon/bridge";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_CYCLE: ActiveCycleKPIs = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Sprint 1",
  projectName: "Phoenix",
  startDate: "2026-04-21T00:00:00.000Z",
  endDate: "2026-05-04T00:00:00.000Z",
  completed: 5,
  scope: 8,
  donePct: 62,
  velocity: 2,
  avgLeadDays: 3.4,
  burnup: [0, 1, 3, 5, 6],
};

// ─── B2 — Sparkline subcomponent ────────────────────────────────────────────

describe("Sparkline (B2)", () => {
  it("B2.1 — values=[0,1,3,5,6] renderiza SVG data-testid=sparkline con path no vacío", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    render(
      <CurrentCycleCard
        activeCycle={BASE_CYCLE}
        multipleActiveProjects={false}
        isLoading={false}
      />,
    );
    const svg = screen.getByTestId("sparkline");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    const path = svg.querySelector("path");
    expect(path).not.toBeNull();
    const d = path?.getAttribute("d") ?? "";
    expect(d.length).toBeGreaterThan(0);
  });

  it("B2.2 — values=[] renderiza SVG sin lanzar (empty state del Sparkline)", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    const cycleWithEmptyBurnup: ActiveCycleKPIs = {
      ...BASE_CYCLE,
      burnup: [],
    };
    expect(() =>
      render(
        <CurrentCycleCard
          activeCycle={cycleWithEmptyBurnup}
          multipleActiveProjects={false}
          isLoading={false}
        />,
      ),
    ).not.toThrow();
    const svg = screen.getByTestId("sparkline");
    expect(svg).toBeTruthy();
  });
});

// ─── B3 — CurrentCycleCard component ────────────────────────────────────────

describe("CurrentCycleCard (B3)", () => {
  it("B3.1 — estado normal: renderiza sparkline, donePct, avgLeadDays, velocity", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    render(
      <CurrentCycleCard
        activeCycle={BASE_CYCLE}
        multipleActiveProjects={false}
        isLoading={false}
      />,
    );
    // Sparkline presente
    expect(screen.getByTestId("sparkline")).toBeTruthy();
    // KPIs con testids correctos
    expect(screen.getByTestId("done-pct-value").textContent).toBe("62%");
    expect(screen.getByTestId("avg-lead-value").textContent).toBe("3.4d");
    expect(screen.getByTestId("velocity-value").textContent).toBe("+2");
  });

  it("B3.2 — avgLeadDays: null muestra '—' en avg-lead-value", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    const cycleNullLead: ActiveCycleKPIs = {
      ...BASE_CYCLE,
      avgLeadDays: null,
    };
    render(
      <CurrentCycleCard
        activeCycle={cycleNullLead}
        multipleActiveProjects={false}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId("avg-lead-value").textContent).toBe("—");
  });

  it("B3.3 — activeCycle=null renderiza current-cycle-empty, sin SVG", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    render(
      <CurrentCycleCard
        activeCycle={null}
        multipleActiveProjects={false}
        isLoading={false}
      />,
    );
    expect(screen.getByTestId("current-cycle-empty")).toBeTruthy();
    // Debe haber exactamente 0 elementos SVG
    const svgs = document.querySelectorAll("svg");
    expect(svgs.length).toBe(0);
  });
});

// ─── B4 — Subtitle with project name ────────────────────────────────────────

describe("CurrentCycleCard subtitle (B4)", () => {
  it("B4.1 — multipleActiveProjects=true incluye '(Phoenix)' en cycle-subtitle", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    render(
      <CurrentCycleCard
        activeCycle={BASE_CYCLE}
        multipleActiveProjects={true}
        isLoading={false}
      />,
    );
    const subtitle = screen.getByTestId("cycle-subtitle");
    expect(subtitle.textContent).toContain("(Phoenix)");
  });

  it("B4.2 — multipleActiveProjects=false NO incluye paréntesis en cycle-subtitle", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    render(
      <CurrentCycleCard
        activeCycle={BASE_CYCLE}
        multipleActiveProjects={false}
        isLoading={false}
      />,
    );
    const subtitle = screen.getByTestId("cycle-subtitle");
    expect(subtitle.textContent).not.toContain("(");
    expect(subtitle.textContent).not.toContain(")");
  });

  it("B4.3 extra — subtitle contiene cycleName y fechas formateadas", async () => {
    const { CurrentCycleCard } = await import("../current-cycle-card");
    render(
      <CurrentCycleCard
        activeCycle={BASE_CYCLE}
        multipleActiveProjects={false}
        isLoading={false}
      />,
    );
    const subtitle = screen.getByTestId("cycle-subtitle");
    // Debe incluir el nombre del ciclo
    expect(subtitle.textContent).toContain("Sprint 1");
    // Debe incluir el separador "–"
    expect(subtitle.textContent).toContain("–");
  });
});
