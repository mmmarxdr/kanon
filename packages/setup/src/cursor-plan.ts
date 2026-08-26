import path from "node:path";
import type { PlatformContext, PlatformPaths, ToolDefinition, WslBridge } from "./types.js";
import { resolveCursorInventoryTargets, resolveCursorWritableTargets } from "./registry.js";
import { discoverCursorSurfaces, resolveCursorAuthorization, validateWslBridge } from "./cursor-surfaces.js";
export interface CursorExecutionPlan {
  targets: readonly PlatformPaths[];
  bridge?: WslBridge;
  diagnostics: readonly string[];
  invalidSelection?: string;
  /** Immutable discovery snapshot consumed by lifecycle execution. */
  surfaces?: readonly SurfaceEvidence[];
}
/**
 * Produces the only writable target list for Cursor. Discovery is deliberately
 * not enough: a Windows target requires a user authorization signal and one
 * exact WSL distribution that has been validated by the caller.
 */
export function createCursorExecutionPlan(input: {
  tool: ToolDefinition;
  ctx: PlatformContext;
  operation: "configure" | "repair" | "remove";
  flags: { tool?: string; all?: boolean };
  isInteractive: boolean;
  /** Set only when the interactive checkbox actually selected Cursor. */
  promptAccepted?: boolean;
  bridge?: WslBridge;
  bridgeExecutableValid: boolean;
  hasUsableLocal?: boolean;
}): CursorExecutionPlan {
  const authorization = resolveCursorAuthorization(input.flags, input.isInteractive, input.bridge, input.promptAccepted);
  const invalidSelection = (input.flags.tool === "cursor" || input.promptAccepted) && input.operation !== "remove" &&
    input.hasUsableLocal === false && !input.bridgeExecutableValid
    ? "Cursor has no executable-valid surface. Start Cursor CLI or repair WSL, then re-run kanon-setup --tool cursor."
    : undefined;
  const isWindowsCandidate = input.tool.name === "cursor" && input.ctx.platform === "wsl" && input.ctx.winHome !== undefined;
  // Owned-entry removal is deliberately independent from executable, Node and
  // distro discovery. Inventory is the authority, including --all recovery.
  if (input.operation === "remove") {
    return { targets: resolveCursorInventoryTargets(input.tool, input.ctx), diagnostics: [] };
  }
  if (!isWindowsCandidate) {
    if (input.tool.name === "cursor" && input.hasUsableLocal === false) {
      return { targets: [], diagnostics: [], ...(invalidSelection ? { invalidSelection } : {}) };
    }
    return { targets: resolveCursorWritableTargets(input.tool, input.ctx), diagnostics: [], ...(invalidSelection ? { invalidSelection } : {}) };
  }
  const canWriteWindows = authorization.crossHost === "authorized" &&
    input.bridgeExecutableValid && input.bridge !== undefined;
  if (canWriteWindows) {
    const targets = resolveCursorWritableTargets(input.tool, input.ctx, {
      decision: "write",
      bridge: input.bridge,
    });
    return {
      targets: input.hasUsableLocal === false ? targets.filter((target) => target.mcpMode === "wsl-bridge") : targets,
      bridge: input.bridge,
      diagnostics: [],
      ...(invalidSelection ? { invalidSelection } : {}),
    };
  }
  const diagnostics = authorization.crossHost === "denied"
    ? ["Windows Cursor was discovered but was not changed. Use --tool cursor or accept the interactive Cursor prompt to authorize cross-host setup."]
    : ["Windows Cursor was discovered but its WSL bridge could not be validated; configure the local Cursor surface manually or repair WSL first."];
  return {
    targets: input.hasUsableLocal === false ? [] : resolveCursorWritableTargets(input.tool, input.ctx),
    diagnostics,
    ...(invalidSelection ? { invalidSelection } : {}),
  };
}
/** Create an execution plan from current host evidence. This is the boundary
 * used by setup and onboarding before any config write begins. */
export function discoverCursorExecutionPlan(input: {
  tool: ToolDefinition;
  ctx: PlatformContext;
  operation: "configure" | "repair" | "remove";
  flags: { tool?: string; all?: boolean };
  isInteractive: boolean;
  promptAccepted?: boolean;
  surfaces?: readonly SurfaceEvidence[];
}): CursorExecutionPlan {
  if (input.tool.name !== "cursor") return { targets: resolveCursorWritableTargets(input.tool, input.ctx), diagnostics: [] };
  if (input.ctx.platform !== "wsl") {
    const surfaces = input.surfaces ?? discoverCursorSurfaces(input.ctx);
    return { ...createCursorExecutionPlan({ ...input, bridgeExecutableValid: false, hasUsableLocal: surfaces.some((surface) => surface.host === "local" && surface.state === "executable-valid") }), surfaces };
  }
  const surfaces = input.surfaces ?? discoverCursorSurfaces(input.ctx);
  // Node bridge validity alone does not prove Cursor is installed. Only a
  // successfully probed Windows Cursor.exe can authorize cross-host writes.
  const bridge = surfaces.find((surface) =>
    surface.host === "windows" && surface.state === "executable-valid"
  )?.bridge;
  return {
    ...createCursorExecutionPlan({
      ...input,
      bridge,
      hasUsableLocal: surfaces.some((surface) => surface.host === "local" && surface.state === "executable-valid"),
      bridgeExecutableValid: bridge === undefined ? false : validateWslBridge(bridge),
    }),
    surfaces,
  };
}
import { createSurfaceResult, planSurfaceMutation, validateSurfaceMutationPlan } from "./surface-lifecycle.js";
import type { SurfaceAuthorization, SurfaceEvidence, SurfaceOwnership, SurfaceResult } from "./types.js";
/** Plan independent Cursor lifecycle outcomes from evidence and read-only
 * ownership inventory. */
export function planCursorSurfaceOutcomes(input: {
  operation: "configure" | "repair" | "remove";
  ctx: PlatformContext;
  flags: { tool?: string; all?: boolean };
  promptAccepted?: boolean;
  surfaces: readonly SurfaceEvidence[];
  /** Read-only ownership inventory keyed by physical config target. */
  ownershipByTarget?: Readonly<Record<string, SurfaceOwnership>>;
  /** Bridge identity independently validated for the exact persisted WSL invocation. */
  validatedBridge?: WslBridge;
}): { results: readonly SurfaceResult[]; diagnostics: readonly string[] } {
  const selectedAuthorization = resolveCursorAuthorization(input.flags, false, input.validatedBridge, input.promptAccepted);
  const plans = input.surfaces.flatMap((surface) => {
    const configPath = surface.host === "windows"
      ? input.ctx.winHome && path.join(input.ctx.winHome, ".cursor", "mcp.json")
      : path.join(input.ctx.homedir, ".cursor", "mcp.json");
    if (configPath === undefined) return [];
    const targetKey = surface.targetKey ?? `${surface.host}:${surface.surface}`;
    const evidence = { ...surface, targetKey };
    const unknownOwnership = { targetKey, configPath, state: "invalid" } satisfies SurfaceOwnership;
    const ownership = input.ownershipByTarget?.[targetKey] ?? unknownOwnership;
    const authorization: SurfaceAuthorization = input.operation === "remove" && ownership.state === "owned"
      ? { source: "inventory", crossHost: "authorized" }
      : selectedAuthorization;
    return [planSurfaceMutation({
    operation: input.operation,
    evidence,
    authorization,
    ownership,
    mutations: [input.operation === "remove" ? "remove-kanon" : "write-mcp"],
    })];
  });
  const diagnostics: string[] = [];
  const results = plans.map((plan) => {
    const issues = validateSurfaceMutationPlan(plan);
    const outcome = plan.decision === "write" && issues.length === 0
      ? input.operation === "remove" ? "removed" : "ready"
      : "skipped";
    const message = issues[0] ?? plan.reason;
    if (outcome === "skipped") diagnostics.push(`${plan.evidence.surface}: ${message}`);
    return createSurfaceResult({
      surface: plan.evidence.surface, host: plan.evidence.host, evidence: plan.evidence.state,
      outcome, paths: [plan.ownership.configPath], message,
    });
  });
  return { results, diagnostics };
}
/** Convert planned per-surface lifecycle outcomes into actual mutation results.
 * A shared physical target is mutated once, then each independent surface gets
 * its own truthful result. */
export function finalizeCursorSurfaceResults(
  results: readonly SurfaceResult[],
  mutatedTargets: ReadonlySet<string>,
  operation: "configure" | "repair" | "remove",
): readonly SurfaceResult[] {
  return results.map((result) => {
    if (result.outcome === "skipped") return result;
    const mutated = result.paths.some((path) => mutatedTargets.has(path));
    if (!mutated) return createSurfaceResult({ ...result, outcome: "failed", message: "planned Cursor target was not mutated" });
    return createSurfaceResult({
      ...result,
      outcome: operation === "remove" ? "removed" : "configured",
      message: operation === "remove" ? "Kanon entry removed" : "Kanon MCP configured",
    });
  });
}
