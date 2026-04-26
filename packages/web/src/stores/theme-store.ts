import { create } from "zustand";

export type Theme = "cobalt" | "teal" | "mono";
export type Appearance = "light" | "dark";

interface ThemeState {
  theme: Theme;
  appearance: Appearance;
  setTheme: (t: Theme) => void;
  setAppearance: (a: Appearance) => void;
  toggleAppearance: () => void;
}

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "mono";
  const v = window.localStorage.getItem("kanon:theme");
  if (v === "cobalt" || v === "teal" || v === "mono") return v;
  return "mono";
}
function readInitialAppearance(): Appearance {
  if (typeof window === "undefined") return "dark";
  const v = window.localStorage.getItem("kanon:appearance");
  return v === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme, appearance: Appearance) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme === "cobalt" ? "" : theme;
  document.documentElement.dataset.appearance = appearance;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  appearance: readInitialAppearance(),
  setTheme: (theme) => {
    window.localStorage.setItem("kanon:theme", theme);
    applyTheme(theme, get().appearance);
    set({ theme });
  },
  setAppearance: (appearance) => {
    window.localStorage.setItem("kanon:appearance", appearance);
    applyTheme(get().theme, appearance);
    set({ appearance });
  },
  toggleAppearance: () => {
    const next: Appearance = get().appearance === "dark" ? "light" : "dark";
    window.localStorage.setItem("kanon:appearance", next);
    applyTheme(get().theme, next);
    set({ appearance: next });
  },
}));

// Apply once on module load to ensure JS-driven changes match the inline script
if (typeof document !== "undefined") {
  const s = useThemeStore.getState();
  applyTheme(s.theme, s.appearance);
}
