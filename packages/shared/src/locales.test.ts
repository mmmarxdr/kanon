import { describe, it, expect } from "vitest";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  isSupportedLocale,
} from "./locales.js";

describe("SUPPORTED_LOCALES", () => {
  it("includes en and es with display labels", () => {
    expect(SUPPORTED_LOCALES).toEqual([
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
    ]);
  });

  it("defaults to en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("isSupportedLocale accepts en/es only", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("es")).toBe(true);
    expect(isSupportedLocale("pt")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
  });
});
