import { describe, it, expect } from "vitest";
import { I18N_NAMESPACES } from "../index";

function flattenKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return flattenKeys(v, path);
    }
    return [path];
  });
}

describe("i18n key parity en/es", () => {
  for (const ns of I18N_NAMESPACES) {
    it(`${ns}: en and es have identical key sets`, async () => {
      const en = (await import(`../locales/en/${ns}.json`)).default as Record<
        string,
        unknown
      >;
      const es = (await import(`../locales/es/${ns}.json`)).default as Record<
        string,
        unknown
      >;
      const enKeys = flattenKeys(en).sort();
      const esKeys = flattenKeys(es).sort();
      expect(esKeys).toEqual(enKeys);
    });
  }
});
