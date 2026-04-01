import { create } from "zustand";

export type AppLocale = "en" | "es";

const STORAGE_KEY = "kanon-locale";

function detectBrowserLocale(): AppLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function readStoredLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return detectBrowserLocale();
}

function persistLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // localStorage unavailable
  }
}

function applyDocumentLang(locale: AppLocale): void {
  document.documentElement.lang = locale === "es" ? "es" : "en";
}

interface LocaleState {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
}

export function initializeLocale(): void {
  if (typeof window === "undefined") {
    return;
  }
  applyDocumentLang(readStoredLocale());
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: typeof window !== "undefined" ? readStoredLocale() : "en",

  setLocale: (locale) =>
    set(() => {
      persistLocale(locale);
      applyDocumentLang(locale);
      return { locale };
    }),
}));
