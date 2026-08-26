import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCursorExecutionPlan, discoverCursorExecutionPlan, finalizeCursorSurfaceResults, planCursorSurfaceOutcomes } from "./cursor-plan.js";
import { getToolByName } from "./registry.js";
import type { PlatformContext, SurfaceOwnership } from "./types.js";
const cursor = getToolByName("cursor")!;
const ctx: PlatformContext = {
  platform: "wsl", homedir: "/home/dev", winHome: "/mnt/c/Users/dev",
};
describe("Cursor execution plan", () => {
  it("RED: only explicit selection with an exact validated bridge makes the Windows IDE writable", () => {
    const plan = createCursorExecutionPlan({
      tool: cursor, ctx, operation: "configure", flags: { tool: "cursor" }, isInteractive: false,
      bridge: { distribution: "Ubuntu-24.04" }, bridgeExecutableValid: true,
    });
    expect(plan.targets.map((target) => target.config(ctx))).toEqual([
      path.join(ctx.homedir, ".cursor", "mcp.json"),
      path.join(ctx.winHome!, ".cursor", "mcp.json"),
    ]);
    expect(plan.bridge).toEqual({ distribution: "Ubuntu-24.04" });
    expect(plan.diagnostics).toEqual([]);
  });
  it("RED: --all and non-interactive autodetect fail closed for Windows mutation", () => {
    for (const flags of [{ all: true }, {}]) {
      const plan = createCursorExecutionPlan({
        tool: cursor, ctx, operation: "configure", flags, isInteractive: false,
        bridge: { distribution: "Ubuntu-24.04" }, bridgeExecutableValid: true,
      });
      expect(plan.targets).toHaveLength(1);
      expect(plan.diagnostics.join(" ")).toMatch(/explicit.*cursor|interactive/i);
    }
  });
  it("RED: removal remains executable-independent and inventory-driven", () => {
    const denied = createCursorExecutionPlan({
      tool: cursor, ctx, operation: "remove", flags: { all: true }, isInteractive: false,
      bridge: { distribution: "Ubuntu-24.04" }, bridgeExecutableValid: false,
    });
    const authorized = createCursorExecutionPlan({
      tool: cursor, ctx, operation: "remove", flags: { tool: "cursor" }, isInteractive: false,
      bridge: { distribution: "Ubuntu-24.04" }, bridgeExecutableValid: false,
    });
    expect(denied.targets).toHaveLength(2);
    expect(authorized.targets).toHaveLength(2);
  });
});
it("RED: explicit Cursor selection reports a non-success plan when no surface is usable", () => {
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx, operation: "configure", flags: { tool: "cursor" }, isInteractive: false,
    bridgeExecutableValid: false, hasUsableLocal: false,
  });
  expect(plan.invalidSelection).toMatch(/cursor.*executable|repair/i);
});
it("RED: explicit native Cursor requires executable evidence", () => {
  const native: PlatformContext = { platform: "win32", homedir: "C:/Users/dev" };
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx: native, operation: "configure", flags: { tool: "cursor" }, isInteractive: false,
    bridgeExecutableValid: false, hasUsableLocal: false,
  });
  expect(plan.targets).toEqual([]);
  expect(plan.invalidSelection).toMatch(/executable-valid/i);
});
it("RED: explicit WSL removal inventories owned Windows config without bridge runtime evidence", () => {
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx, operation: "remove", flags: { tool: "cursor" }, isInteractive: false,
    bridgeExecutableValid: false,
  });
  expect(plan.targets.map((target) => target.config(ctx))).toContain(path.join(ctx.winHome!, ".cursor", "mcp.json"));
});
it("RES-001: executable evidence without inventory fails closed", () => {
  const outcomes = planCursorSurfaceOutcomes({
    operation: "configure", ctx: linuxContext(), flags: { tool: "cursor" },
    surfaces: [
      { tool: "cursor", surface: "ide", host: "local", state: "configured-only/stale", targetKey: "ide" },
      { tool: "cursor", surface: "cli", host: "local", state: "executable-valid", targetKey: "cli", executable: { path: "/bin/cursor", command: "cursor", version: "1" } },
    ],
  });
  expect(outcomes.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ surface: "ide", outcome: "skipped" }),
    expect.objectContaining({ surface: "cli", outcome: "skipped", message: "configure target ownership is unsafe" }),
  ]));
});
function linuxContext(): PlatformContext { return { platform: "linux", homedir: "/home/dev" }; }
it("RED remediation: Windows-only inventory never creates a Linux Cursor target", () => {
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx, operation: "configure", flags: {}, isInteractive: false,
    bridge: { distribution: "Ubuntu-24.04" }, bridgeExecutableValid: true,
    hasUsableLocal: false,
  });
  expect(plan.targets).toEqual([]);
});
it("RED remediation: an affirmative prompt authorizes the exact validated Windows bridge", () => {
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx, operation: "configure", flags: {}, isInteractive: true,
    promptAccepted: true,
    bridge: { distribution: "Ubuntu-24.04" }, bridgeExecutableValid: true,
    hasUsableLocal: false,
  });
  expect(plan.bridge).toEqual({ distribution: "Ubuntu-24.04" });
  expect(plan.targets.map((target) => target.config(ctx))).toEqual([
    path.join(ctx.winHome!, ".cursor", "mcp.json"),
  ]);
});
it("RES-001: inventoried missing canonical target becomes ready then configured", () => {
  const configPath = path.join(linuxContext().homedir, ".cursor", "mcp.json");
  const { results } = planCursorSurfaceOutcomes({
    operation: "configure", ctx: linuxContext(), flags: { tool: "cursor" },
    surfaces: [validLocalCliWithoutTargetKey()],
    ownershipByTarget: { "local:cli": { targetKey: "local:cli", configPath, state: "missing" } },
  });
  expect(results).toEqual([expect.objectContaining({ outcome: "ready", paths: [configPath] })]);
  expect(finalizeCursorSurfaceResults(results, new Set([configPath]), "configure"))
    .toEqual([expect.objectContaining({ outcome: "configured", paths: [configPath] })]);
});
it("RED KAN-256: removal targets the owned Windows mcp.json even when discovery has no runtime surfaces", async () => {
  const plan = discoverCursorExecutionPlan({
    tool: cursor, ctx, operation: "remove", flags: { tool: "cursor" }, isInteractive: false, surfaces: [],
  });
  expect(plan.targets.map((target) => target.config(ctx))).toContain(path.join(ctx.winHome!, ".cursor", "mcp.json"));
});
it("RED KAN-256 reporting: independent results retain shared-target dedupe and actionable states", async () => {
  const path = "/home/dev/.cursor/mcp.json";
  const results = finalizeCursorSurfaceResults([
    { surface: "ide", host: "local", evidence: "executable-valid", outcome: "ready", paths: [path], message: "ready" },
    { surface: "cli", host: "local", evidence: "configured-only/stale", outcome: "skipped", paths: [path], message: "target is not executable-valid" },
  ], new Set([path]), "configure");
  expect(results).toEqual([
    expect.objectContaining({ surface: "ide", outcome: "configured", paths: [path] }),
    expect.objectContaining({ surface: "cli", outcome: "skipped", message: "target is not executable-valid" }),
  ]);
});
it("RED KAN-256 reporting: failed and removed target outcomes are independent", async () => {
  const path = "/home/dev/.cursor/mcp.json";
  expect(finalizeCursorSurfaceResults([
    { surface: "ide", host: "local", evidence: "executable-valid", outcome: "ready", paths: [path], message: "ready" },
    { surface: "cli", host: "local", evidence: "executable-valid", outcome: "ready", paths: [path], message: "ready" },
  ], new Set(), "configure")).toEqual(expect.arrayContaining([
    expect.objectContaining({ surface: "ide", outcome: "failed" }),
    expect.objectContaining({ surface: "cli", outcome: "failed" }),
  ]));
  expect(finalizeCursorSurfaceResults([
    { surface: "ide", host: "local", evidence: "absent", outcome: "removed", paths: [path], message: "ready" },
  ], new Set([path]), "remove")[0]).toEqual(expect.objectContaining({ outcome: "removed" }));
});
it("RED REL-PR3-002: repair plans an independently inventoried owned target as ready", async () => {
  const outcomes = planCursorSurfaceOutcomes({
    operation: "repair", ctx: linuxContext(), flags: { tool: "cursor" },
    surfaces: [validLocalCli("cli")],
    ownershipByTarget: { cli: ownedTarget("cli") },
  });
  expect(outcomes.results).toEqual([expect.objectContaining({ surface: "cli", outcome: "ready" })]);
});
it("RED REL-PR3-003: --all removes an inventoried owned Windows target without bridge runtime authorization", async () => {
  const targetKey = "windows-ide";
  const outcomes = planCursorSurfaceOutcomes({
    operation: "remove", ctx, flags: { all: true },
    surfaces: [{ tool: "cursor", surface: "ide", host: "windows", state: "configured-only/stale", targetKey }],
    ownershipByTarget: { [targetKey]: ownedTarget(targetKey) },
  });
  expect(outcomes.results).toEqual([expect.objectContaining({ surface: "ide", outcome: "removed" })]);
});
it.each([
  ["distribution", { distribution: "Ubuntu-22.04", nodePath: "/usr/bin/node" }],
  ["Node path", { distribution: "Ubuntu-24.04", nodePath: "/opt/node/bin/node" }],
])("REL-PR3-004: Windows readiness skips a mismatched independently validated bridge %s", async (_, validatedBridge) => {
  const targetKey = "windows-ide";
  const outcomes = planCursorSurfaceOutcomes({
    operation: "configure", ctx, flags: { tool: "cursor" },
    surfaces: [{
      tool: "cursor", surface: "ide", host: "windows", state: "executable-valid", targetKey,
      executable: { path: "C:/Cursor.exe", command: "Cursor.exe", version: "1" },
      bridge: { distribution: "Ubuntu-24.04", nodePath: "/usr/bin/node" },
    }],
    ownershipByTarget: { [targetKey]: { ...ownedTarget(targetKey), state: "missing" } },
    validatedBridge,
  });
  expect(outcomes.results).toEqual([expect.objectContaining({ surface: "ide", outcome: "skipped" })]);
  expect(outcomes.diagnostics.join(" ")).toMatch(/bridge.*identity|exact/i);
});
function validLocalCli(targetKey: string) {
  return {
    tool: "cursor", surface: "cli", host: "local" as const, state: "executable-valid" as const, targetKey,
    executable: { path: "/bin/cursor", command: "cursor", version: "1" },
  };
}
function validLocalCliWithoutTargetKey() {
  const { targetKey: _, ...surface } = validLocalCli("ignored");
  return surface;
}
function ownedTarget(targetKey: string): SurfaceOwnership {
  return { targetKey, configPath: `/tmp/${targetKey}/mcp.json`, state: "owned" };
}
it("JD-S004: a stale Windows config plus a valid Node bridge is invalid without Cursor.exe evidence", async () => {
  const plan = discoverCursorExecutionPlan({
    tool: cursor, ctx, operation: "configure", flags: { tool: "cursor" }, isInteractive: false,
    surfaces: [{ tool: "cursor", surface: "ide", host: "windows", state: "wsl-only/bridge", targetKey: path.join(ctx.winHome!, ".cursor", "mcp.json"), bridge: { distribution: "Ubuntu", nodePath: process.execPath } }],
  });
  expect(plan.targets).toEqual([]);
  expect(plan.invalidSelection).toMatch(/no executable-valid surface/i);
});
it("JD-001 round 2: WSL --remove --all retains stale owned local and Windows inventory targets", () => {
  const plan = createCursorExecutionPlan({ tool: cursor, ctx, operation: "remove", flags: { all: true }, isInteractive: false, bridgeExecutableValid: false, hasUsableLocal: false });
  expect(plan.targets.map((target) => target.config(ctx))).toEqual(expect.arrayContaining([
    path.join(ctx.homedir, ".cursor", "mcp.json"), path.join(ctx.winHome!, ".cursor", "mcp.json"),
  ]));
});
it("JD2-S003: an affirmative Cursor prompt with no writable target is an actionable invalid selection", () => {
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx, operation: "configure", flags: {}, isInteractive: true, promptAccepted: true,
    bridgeExecutableValid: false, hasUsableLocal: false,
  });
  expect(plan.targets).toEqual([]);
  expect(plan.invalidSelection).toMatch(/no executable-valid surface/i);
});
it.each<PlatformContext>([
  { platform: "win32", homedir: "C:/Users/dev" },
  { platform: "wsl", homedir: "/home/dev" },
  ctx,
])("RES-002: unselected absence has no invalid selection", (absentCtx) => {
  const plan = createCursorExecutionPlan({
    tool: cursor, ctx: absentCtx, operation: "configure", flags: {}, isInteractive: false,
    bridgeExecutableValid: false, hasUsableLocal: false,
  });
  expect(plan.targets).toEqual([]);
  expect(plan.invalidSelection).toBeUndefined();
});
