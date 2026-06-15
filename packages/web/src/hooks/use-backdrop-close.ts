import { useCallback } from "react";
import type { MouseEvent } from "react";

/**
 * Returns an onClick handler that calls `onClose` only when the click lands on
 * the backdrop element itself (`e.target === e.currentTarget`), not a child.
 */
export function useBackdropClose(onClose: () => void) {
  return useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );
}
