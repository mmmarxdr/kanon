import { useState, useCallback } from "react";
import type { SectionId } from "./collapsible-section-ids";

/**
 * KAN-108 slice 3 — useCollapsedState
 *
 * Manages open/collapsed state for a section with sessionStorage persistence.
 * Key format: `kan108:collapsed:${issueKey}:${sectionId}`
 *
 * On mount: reads stored value (wins over defaultCollapsed); falls back to
 * defaultCollapsed when no stored value or when sessionStorage is unavailable
 * (private browsing, some test envs, sandboxed iframes).
 */
export function useCollapsedState(
  issueKey: string,
  sectionId: SectionId,
  defaultCollapsed: boolean,
): [collapsed: boolean, toggle: () => void] {
  const storageKey = `kan108:collapsed:${issueKey}:${sectionId}`;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored !== null) {
        return stored === "true";
      }
    } catch {
      // sessionStorage unavailable — fall through to default
    }
    return defaultCollapsed;
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(storageKey, String(next));
      } catch {
        // sessionStorage unavailable — state still flips in memory
      }
      return next;
    });
  }, [storageKey]);

  return [collapsed, toggle];
}
