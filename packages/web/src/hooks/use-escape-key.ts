import { useEffect } from "react";

/**
 * Invoke `onEscape` when the user presses Escape (document-level keydown).
 * Pass `enabled = false` to suspend the listener — e.g. while a modal is closed.
 */
export function useEscapeKey(onEscape: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onEscape, enabled]);
}
