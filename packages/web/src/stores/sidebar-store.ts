import { create } from "zustand";

interface SidebarState {
  collapsed: boolean;
  toggleSidebar: () => void;
}

const STORAGE_KEY = "kanon-sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: loadCollapsed(),

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
}));
