import type { IssueState } from "@prisma/client";
import { ORDERED_STATES } from "../../shared/constants.js";

/**
 * Result of a state transition validation.
 */
export type TransitionResult =
  | { allowed: true; isRegression: boolean }
  | { allowed: false; reason: string };

/**
 * Validate an issue state transition.
 *
 * Rules:
 * - Forward transitions (higher index): always allowed, isRegression = false
 * - Backward transitions (lower index): always allowed, isRegression = true
 * - Same state: not allowed
 * - From done to any state: allowed (reopen), isRegression = true
 * - To same state: not allowed
 */
export function validateTransition(
  from: IssueState,
  to: IssueState,
): TransitionResult {
  if (from === to) {
    return {
      allowed: false,
      reason: `Issue is already in state "${from}"`,
    };
  }

  const fromIndex = ORDERED_STATES.indexOf(from);
  const toIndex = ORDERED_STATES.indexOf(to);

  if (fromIndex === -1 || toIndex === -1) {
    return {
      allowed: false,
      reason: `Invalid state: "${fromIndex === -1 ? from : to}"`,
    };
  }

  // Forward transition (or from archived to non-archived which is always regression)
  const isRegression = toIndex < fromIndex;

  return {
    allowed: true,
    isRegression,
  };
}
