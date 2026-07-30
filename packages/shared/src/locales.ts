export interface SupportedLocale {
  code: string;
  label: string;
}

/** Allowlist of UI locales. Single source of truth for web (and future API/email). */
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
] as const;

export const DEFAULT_LOCALE = "en";

export function isSupportedLocale(code: string): boolean {
  return SUPPORTED_LOCALES.some((l) => l.code === code);
}
