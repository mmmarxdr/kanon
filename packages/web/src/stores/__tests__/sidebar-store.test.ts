import { describe, it, expect, beforeEach, afterEach } from "vitest";

const PROJECTS_EXPANDED_KEY = "kanon-sidebar-projects-expanded";
const COLLAPSED_KEY = "kanon-sidebar-collapsed";

describe("useSidebarStore projectsExpanded", () => {
  beforeEach(() => {
    localStorage.removeItem(PROJECTS_EXPANDED_KEY);
    localStorage.removeItem(COLLAPSED_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(PROJECTS_EXPANDED_KEY);
    localStorage.removeItem(COLLAPSED_KEY);
  });

  it("defaults projectsExpanded to false", async () => {
    const { useSidebarStore } = await import("../sidebar-store");
    useSidebarStore.setState({ projectsExpanded: false, collapsed: false });
    expect(useSidebarStore.getState().projectsExpanded).toBe(false);
  });

  it("toggleProjectsExpanded flips and writes localStorage", async () => {
    const { useSidebarStore } = await import("../sidebar-store");
    useSidebarStore.setState({ projectsExpanded: false, collapsed: false });

    useSidebarStore.getState().toggleProjectsExpanded();
    expect(useSidebarStore.getState().projectsExpanded).toBe(true);
    expect(localStorage.getItem(PROJECTS_EXPANDED_KEY)).toBe("true");

    useSidebarStore.getState().toggleProjectsExpanded();
    expect(useSidebarStore.getState().projectsExpanded).toBe(false);
    expect(localStorage.getItem(PROJECTS_EXPANDED_KEY)).toBe("false");
  });

  it("setProjectsExpanded writes localStorage", async () => {
    const { useSidebarStore } = await import("../sidebar-store");
    useSidebarStore.setState({ projectsExpanded: false, collapsed: false });

    useSidebarStore.getState().setProjectsExpanded(true);
    expect(useSidebarStore.getState().projectsExpanded).toBe(true);
    expect(localStorage.getItem(PROJECTS_EXPANDED_KEY)).toBe("true");
  });

  it("loadProjectsExpanded reads true from localStorage", async () => {
    localStorage.setItem(PROJECTS_EXPANDED_KEY, "true");
    const { loadProjectsExpanded } = await import("../sidebar-store");
    expect(loadProjectsExpanded()).toBe(true);
  });

  it("loadProjectsExpanded returns false when missing", async () => {
    const { loadProjectsExpanded } = await import("../sidebar-store");
    expect(loadProjectsExpanded()).toBe(false);
  });
});
