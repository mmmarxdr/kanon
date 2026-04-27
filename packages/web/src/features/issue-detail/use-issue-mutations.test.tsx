/**
 * Tests for useUpdateIssueMutation — F4 cycle invalidation (estimate gate).
 *
 * STATUS: All F4 test cases are pending (`it.todo`) because `estimate` is NOT
 * yet on `IssueUpdatePayload`. The payload currently only accepts:
 *   title | description | type | priority | labels | assigneeId
 *
 * These stubs document the required contract so that when estimate-edit lands
 * and `estimate` is added to `IssueUpdatePayload`, the implementation and tests
 * can be activated together in one atomic PR.
 *
 * Design reference: SDD Design #1234, section F4 / interface contract.
 * Spec reference: SDD Spec #1233, section F4.
 *
 * TODO(estimate-edit): Activate all tests below when estimate is added to
 * IssueUpdatePayload and the F4 conditional invalidation logic is uncommented
 * in onSettled (see use-issue-mutations.ts TODO block).
 */

import { describe, it } from "vitest";

describe("useUpdateIssueMutation — F4 cycle invalidation (estimate gate)", () => {
  // ── Pending tests — activate when estimate lands on IssueUpdatePayload ────

  it.todo(
    "estimate change + cycle in previousDetail → invalidates cycleKeys.detail(cycleId)",
  );

  it.todo(
    "estimate change + no previousDetail (cache empty at mutation time) → invalidates cycleKeys.all",
  );

  it.todo(
    "estimate change + issue has no cycle (previousDetail.cycle is null) → invalidates cycleKeys.all",
  );

  it.todo(
    "title-only change (no estimate in payload) → does NOT invalidate any cycle key",
  );

  it.todo(
    "error on estimate update → cycleKeys still invalidated (onSettled semantics — fires on both success and error)",
  );
});
