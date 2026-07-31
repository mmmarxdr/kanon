import { describe, it, expect } from "vitest";
import {
  PROJECTS_SOFT_LIMIT,
  selectVisibleProjects,
  type SoftProject,
} from "../select-visible-projects";

function p(key: string, name: string): SoftProject {
  return { id: `id-${key}`, key, name };
}

function keys(projects: SoftProject[]): string[] {
  return projects.map((x) => x.key);
}

describe("selectVisibleProjects", () => {
  it("returns empty for empty input", () => {
    const result = selectVisibleProjects({
      projects: [],
      activeKey: "",
      expanded: false,
    });
    expect(result).toEqual({ visible: [], hiddenCount: 0, total: 0 });
  });

  it("sorts alphabetically by name when no active key", () => {
    const result = selectVisibleProjects({
      projects: [p("ZEB", "Zebra"), p("ALP", "Alpha"), p("MID", "Mid")],
      activeKey: "",
      expanded: true,
    });
    expect(keys(result.visible)).toEqual(["ALP", "MID", "ZEB"]);
    expect(result.hiddenCount).toBe(0);
    expect(result.total).toBe(3);
  });

  it("sorts active key first, then alphabetical remainder", () => {
    const result = selectVisibleProjects({
      projects: [p("ZEB", "Zebra"), p("ALP", "Alpha"), p("MID", "Mid")],
      activeKey: "ZEB",
      expanded: true,
    });
    expect(keys(result.visible)).toEqual(["ZEB", "ALP", "MID"]);
  });

  it("returns all when total <= softLimit regardless of expanded", () => {
    const projects = Array.from({ length: 5 }, (_, i) =>
      p(`P${i}`, `Project ${i}`),
    );
    for (const expanded of [false, true]) {
      const result = selectVisibleProjects({
        projects,
        activeKey: "",
        expanded,
      });
      expect(result.visible).toHaveLength(5);
      expect(result.hiddenCount).toBe(0);
      expect(result.total).toBe(5);
    }
  });

  it("collapses to softLimit with hiddenCount when not expanded", () => {
    const projects = Array.from({ length: 18 }, (_, i) =>
      p(`P${String(i).padStart(2, "0")}`, `Project ${String(i).padStart(2, "0")}`),
    );
    const result = selectVisibleProjects({
      projects,
      activeKey: "",
      expanded: false,
    });
    expect(result.visible).toHaveLength(PROJECTS_SOFT_LIMIT);
    expect(result.hiddenCount).toBe(10);
    expect(result.total).toBe(18);
  });

  it("returns all when expanded even if total > softLimit", () => {
    const projects = Array.from({ length: 18 }, (_, i) =>
      p(`P${String(i).padStart(2, "0")}`, `Project ${String(i).padStart(2, "0")}`),
    );
    const result = selectVisibleProjects({
      projects,
      activeKey: "",
      expanded: true,
    });
    expect(result.visible).toHaveLength(18);
    expect(result.hiddenCount).toBe(0);
  });

  it("pins active project into collapsed window when outside natural first-8", () => {
    // Names A01..A18 → alphabetical; active A18 would be last without pin
    const projects = Array.from({ length: 18 }, (_, i) => {
      const n = String(i + 1).padStart(2, "0");
      return p(`K${n}`, `A${n}`);
    });
    const result = selectVisibleProjects({
      projects,
      activeKey: "K18",
      expanded: false,
    });
    expect(result.visible).toHaveLength(PROJECTS_SOFT_LIMIT);
    expect(keys(result.visible)).toContain("K18");
    expect(result.visible[0]?.key).toBe("K18");
    expect(result.hiddenCount).toBe(10);
  });

  it("respects custom softLimit", () => {
    const projects = Array.from({ length: 5 }, (_, i) =>
      p(`P${i}`, `Project ${i}`),
    );
    const result = selectVisibleProjects({
      projects,
      activeKey: "",
      softLimit: 2,
      expanded: false,
    });
    expect(result.visible).toHaveLength(2);
    expect(result.hiddenCount).toBe(3);
  });
});
