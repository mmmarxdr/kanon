/**
 * KAN-108 slice 5 — useMediaQuery hook tests
 *
 * MQ-1: Returns false when window.matchMedia is undefined (jsdom / SSR safety).
 * MQ-2: Returns true when the media query initially matches.
 * MQ-3: Returns false when the media query initially does not match.
 * MQ-4: Updates to true when a 'change' event fires with matches=true.
 * MQ-5: Updates to false when a 'change' event fires with matches=false.
 *
 * Stub strategy: scoped inside describe block's beforeEach/afterEach — does NOT
 * pollute other test files. Tests that do NOT stub matchMedia (all pre-existing
 * tests) run on the desktop default (returns false) path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── MQ-1: no matchMedia (jsdom default) ──────────────────────────────────────

describe("useMediaQuery — when window.matchMedia is undefined", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    // Simulate environments where matchMedia is not available
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("MQ-1: returns false when window.matchMedia is undefined", async () => {
    const { useMediaQuery } = await import("../use-media-query");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
  });
});

// ─── MQ-2 / MQ-3 / MQ-4 / MQ-5: with matchMedia stub ─────────────────────────

describe("useMediaQuery — with matchMedia stub", () => {
  // Per-listener tracking so we can fire change events
  let listeners: Array<(e: { matches: boolean }) => void> = [];
  let mockMatches = false;
  let originalMatchMedia: typeof window.matchMedia;

  function buildMockMQL(initialMatches: boolean) {
    mockMatches = initialMatches;
    listeners = [];
    return {
      get matches() {
        return mockMatches;
      },
      addEventListener: vi.fn(
        (_type: string, handler: (e: { matches: boolean }) => void) => {
          listeners.push(handler);
        },
      ),
      removeEventListener: vi.fn(
        (_type: string, handler: (e: { matches: boolean }) => void) => {
          listeners = listeners.filter((l) => l !== handler);
        },
      ),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      media: "(max-width: 1023px)",
      onchange: null,
    };
  }

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    listeners = [];
  });

  it("MQ-2: returns true when the query initially matches", async () => {
    const mql = buildMockMQL(true);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { useMediaQuery } = await import("../use-media-query");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(true);
  });

  it("MQ-3: returns false when the query initially does not match", async () => {
    const mql = buildMockMQL(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { useMediaQuery } = await import("../use-media-query");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));
    expect(result.current).toBe(false);
  });

  it("MQ-4: updates to true when a change event fires with matches=true", async () => {
    const mql = buildMockMQL(false);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { useMediaQuery } = await import("../use-media-query");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));

    // Initially false
    expect(result.current).toBe(false);

    // Simulate window resize → query now matches
    act(() => {
      mockMatches = true;
      listeners.forEach((l) => l({ matches: true }));
    });

    expect(result.current).toBe(true);
  });

  it("MQ-5: updates to false when a change event fires with matches=false", async () => {
    const mql = buildMockMQL(true);
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue(mql),
    });

    const { useMediaQuery } = await import("../use-media-query");
    const { result } = renderHook(() => useMediaQuery("(max-width: 1023px)"));

    // Initially true
    expect(result.current).toBe(true);

    // Simulate window resize → query no longer matches
    act(() => {
      mockMatches = false;
      listeners.forEach((l) => l({ matches: false }));
    });

    expect(result.current).toBe(false);
  });
});
