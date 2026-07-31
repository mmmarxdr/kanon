import { create } from "zustand";

interface SidebarState {
  collapsed: boolean;
  toggleSidebar: () => void;
  projectsExpanded: boolean;
  toggleProjectsExpanded: () => void;
  setProjectsExpanded: (expanded: boolean) => void;
}

const STORAGE_KEY = "kanon-sidebar-collapsed";
const PROJECTS_EXPANDED_KEY = "kanon-sidebar-projects-expanded";

function loadCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

export function loadProjectsExpanded(): boolean {
  try {
    const stored = localStorage.getItem(PROJECTS_EXPANDED_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

function persistProjectsExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(PROJECTS_EXPANDED_KEY, String(expanded));
  } catch {
    // localStorage unavailable
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: loadCollapsed(),
  projectsExpanded: loadProjectsExpanded(),

  toggleSidebar: () =>
    set((prev) => {
      const next = !prev.collapsed;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable
      }
      return { collapsed: next };
    }),

  toggleProjectsExpanded: () =>
    set((prev) => {
      const next = !prev.projectsExpanded;
      persistProjectsExpanded(next);
      return { projectsExpanded: next };
    }),

  setProjectsExpanded: (expanded: boolean) =>
    set(() => {
      persistProjectsExpanded(expanded);
      return { projectsExpanded: expanded };
    }),
}));
