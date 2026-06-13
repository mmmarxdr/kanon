/**
 * KAN-108 slice 3 — useCollapsedState hook tests
 *
 * UC-1: Returns defaultCollapsed when no stored value exists.
 * UC-2: Restores a stored `true` value on mount.
 * UC-3: Restores a stored `false` value on mount.
 * UC-4: toggle() flips the state and writes to sessionStorage.
 * UC-5: Two different (issueKey, sectionId) pairs don't collide.
 * UC-6: Two different sectionIds for the same issueKey don't collide.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { SECTION_IDS } from "../collapsible-section-ids";

// Ensure sessionStorage is clean between tests
beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  sessionStorage.clear();
});

describe("useCollapsedState (KAN-108 slice 3)", () => {
  it("UC-1: returns defaultCollapsed=false when no stored value exists", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");

    const { result } = renderHook(() =>
      useCollapsedState("KAN-1", SECTION_IDS.DESIGN_RECORDS, false),
    );

    const [collapsed] = result.current;
    expect(collapsed).toBe(false);
  });

  it("UC-1b: returns defaultCollapsed=true when no stored value exists", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");

    const { result } = renderHook(() =>
      useCollapsedState("KAN-1", SECTION_IDS.SUB_ISSUES, true),
    );

    const [collapsed] = result.current;
    expect(collapsed).toBe(true);
  });

  it("UC-2: restores stored 'true' value from sessionStorage on mount", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");
    // Pre-seed sessionStorage
    sessionStorage.setItem("kan108:collapsed:KAN-42:design-records", "true");

    const { result } = renderHook(() =>
      useCollapsedState("KAN-42", SECTION_IDS.DESIGN_RECORDS, false),
    );

    const [collapsed] = result.current;
    // defaultCollapsed is false, but stored value is true — stored wins
    expect(collapsed).toBe(true);
  });

  it("UC-3: restores stored 'false' value from sessionStorage on mount", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");
    sessionStorage.setItem("kan108:collapsed:KAN-7:sub-issues", "false");

    const { result } = renderHook(() =>
      useCollapsedState("KAN-7", SECTION_IDS.SUB_ISSUES, true),
    );

    const [collapsed] = result.current;
    // defaultCollapsed is true, but stored value is false — stored wins
    expect(collapsed).toBe(false);
  });

  it("UC-4: toggle() flips state and persists to sessionStorage", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");

    const { result } = renderHook(() =>
      useCollapsedState("KAN-5", SECTION_IDS.DEPENDENCIES, false),
    );

    // Initially false
    expect(result.current[0]).toBe(false);

    // Toggle → true
    act(() => {
      result.current[1]();
    });

    expect(result.current[0]).toBe(true);
    expect(sessionStorage.getItem("kan108:collapsed:KAN-5:dependencies")).toBe(
      "true",
    );

    // Toggle again → false
    act(() => {
      result.current[1]();
    });

    expect(result.current[0]).toBe(false);
    expect(sessionStorage.getItem("kan108:collapsed:KAN-5:dependencies")).toBe(
      "false",
    );
  });

  it("UC-5: different issueKeys don't collide (KAN-1 vs KAN-2 same sectionId)", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");
    sessionStorage.setItem("kan108:collapsed:KAN-1:sub-issues", "true");
    sessionStorage.setItem("kan108:collapsed:KAN-2:sub-issues", "false");

    const { result: r1 } = renderHook(() =>
      useCollapsedState("KAN-1", SECTION_IDS.SUB_ISSUES, false),
    );
    const { result: r2 } = renderHook(() =>
      useCollapsedState("KAN-2", SECTION_IDS.SUB_ISSUES, true),
    );

    expect(r1.current[0]).toBe(true);
    expect(r2.current[0]).toBe(false);
  });

  it("UC-6: different sectionIds for the same issueKey don't collide", async () => {
    const { useCollapsedState } = await import("../use-collapsed-state");
    sessionStorage.setItem("kan108:collapsed:KAN-10:design-records", "false");
    sessionStorage.setItem("kan108:collapsed:KAN-10:sub-issues", "true");

    const { result: r1 } = renderHook(() =>
      useCollapsedState("KAN-10", SECTION_IDS.DESIGN_RECORDS, true),
    );
    const { result: r2 } = renderHook(() =>
      useCollapsedState("KAN-10", SECTION_IDS.SUB_ISSUES, false),
    );

    expect(r1.current[0]).toBe(false); // stored false wins over default true
    expect(r2.current[0]).toBe(true);  // stored true wins over default false
  });
});
