/**
 * TDD tests for getProjectKeyFromPath (pure helper) and useActiveProjectKey (hook).
 *
 * getProjectKeyFromPath reuses the same pattern as app-topbar.tsx buildCrumbs:
 * matches /(board|roadmap|dependencies|cycles)/:projectKey and /issue/:issueKey.
 *
 * The hook wraps it with useLocation() — tested via mocking.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getProjectKeyFromPath } from "@/hooks/use-active-project-key";

describe("getProjectKeyFromPath", () => {
  it("returns projectKey from /board/:key path", () => {
    expect(getProjectKeyFromPath("/board/KAN")).toBe("KAN");
  });

  it("returns projectKey from /roadmap/:key path", () => {
    expect(getProjectKeyFromPath("/roadmap/PROJ")).toBe("PROJ");
  });

  it("returns projectKey from /dependencies/:key path", () => {
    expect(getProjectKeyFromPath("/dependencies/MYP")).toBe("MYP");
  });

  it("returns projectKey from /cycles/:key path", () => {
    expect(getProjectKeyFromPath("/cycles/ABC")).toBe("ABC");
  });

  it("returns the key prefix from /issue/KAN-42 path", () => {
    expect(getProjectKeyFromPath("/issue/KAN-42")).toBe("KAN");
  });

  it("returns the key prefix from /issue/MYPROJECT-1 path", () => {
    expect(getProjectKeyFromPath("/issue/MYPROJECT-1")).toBe("MYPROJECT");
  });

  it("returns null for workspace root path", () => {
    expect(getProjectKeyFromPath("/")).toBe(null);
  });

  it("returns null for /inbox", () => {
    expect(getProjectKeyFromPath("/inbox")).toBe(null);
  });

  it("returns null for /settings", () => {
    expect(getProjectKeyFromPath("/settings")).toBe(null);
  });

  it("returns null for /workspaces", () => {
    expect(getProjectKeyFromPath("/workspaces")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(getProjectKeyFromPath("")).toBe(null);
  });

  it("handles nested paths under board (ignores trailing segments)", () => {
    expect(getProjectKeyFromPath("/board/KAN/some-sub-path")).toBe("KAN");
  });

  it("handles mixed-case project keys", () => {
    expect(getProjectKeyFromPath("/board/kan-test")).toBe("kan-test");
  });
});

// Hook test: useActiveProjectKey uses useLocation and delegates to getProjectKeyFromPath
vi.mock("@tanstack/react-router", () => ({
  useLocation: vi.fn(),
}));

describe("useActiveProjectKey (hook)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the projectKey when on a board route", async () => {
    const { useLocation } = await import("@tanstack/react-router");
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/board/KAN",
    } as ReturnType<typeof useLocation>);

    const { renderHook } = await import("@testing-library/react");
    const { useActiveProjectKey } = await import(
      "@/hooks/use-active-project-key"
    );

    const { result } = renderHook(() => useActiveProjectKey());
    expect(result.current).toBe("KAN");
  });

  it("returns null when on workspace root", async () => {
    const { useLocation } = await import("@tanstack/react-router");
    vi.mocked(useLocation).mockReturnValue({
      pathname: "/",
    } as ReturnType<typeof useLocation>);

    const { renderHook } = await import("@testing-library/react");
    const { useActiveProjectKey } = await import(
      "@/hooks/use-active-project-key"
    );

    const { result } = renderHook(() => useActiveProjectKey());
    expect(result.current).toBe(null);
  });
});
