import { create } from "zustand";

const STORAGE_KEY = "kanon-last-project-key";

function loadFromStorage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

interface LastProjectState {
  lastProjectKey: string;
  setLastProjectKey: (key: string) => void;
}

export const useLastProjectStore = create<LastProjectState>((set) => ({
  lastProjectKey: loadFromStorage(),

  setLastProjectKey: (key) =>
    set(() => {
      if (!key) {
        return {};
      }
      try {
        localStorage.setItem(STORAGE_KEY, key);
      } catch {
        // localStorage unavailable
      }
      return { lastProjectKey: key };
    }),
}));
