import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const STORAGE_KEY = "kanon-theme-preference";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let mediaListenerAttached = false;

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return "system";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function applyThemeClass(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

function savePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // localStorage unavailable
  }
}

function attachSystemThemeListener(): void {
  if (mediaListenerAttached || typeof window === "undefined") return;
  mediaListenerAttached = true;

  const media = window.matchMedia(MEDIA_QUERY);
  media.addEventListener("change", () => {
    const current = readStoredPreference();
    if (current === "system") {
      applyThemeClass("system");
    }
  });
}

export function initializeTheme(): void {
  if (typeof window === "undefined") return;
  const preference = readStoredPreference();
  applyThemeClass(preference);
  attachSystemThemeListener();
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),

  setPreference: (preference) =>
    set(() => {
      savePreference(preference);
      applyThemeClass(preference);
      return { preference };
    }),
}));

