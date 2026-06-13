import { useState, useEffect } from "react";

/**
 * KAN-108 slice 5 — useMediaQuery
 *
 * Returns whether the given CSS media query string currently matches.
 * Subscribes to changes via addEventListener('change') with removeEventListener
 * cleanup; falls back to addListener/removeListener for older environments.
 *
 * jsdom safety: if window.matchMedia is undefined (SSR / jsdom without stub),
 * returns false (desktop default) and does NOT crash. This keeps all existing
 * tests — which do not stub matchMedia — on the safe desktop path.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(query);
    setMatches(mql.matches);

    const handler = (e: MediaQueryListEvent | { matches: boolean }) => {
      setMatches(e.matches);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler as (e: MediaQueryListEvent) => void);
      return () => {
        mql.removeEventListener("change", handler as (e: MediaQueryListEvent) => void);
      };
    } else {
      // Fallback for older environments (Safari < 14)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mql as any).addListener(handler);
      return () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mql as any).removeListener(handler);
      };
    }
  }, [query]);

  return matches;
}
