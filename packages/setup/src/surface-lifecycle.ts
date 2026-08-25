import type {
  SurfaceAuthorization,
  SurfaceEvidence,
  SurfaceMutationPlan,
  SurfaceOwnership,
  SurfaceResult,
  WslBridge,
} from "./types.js";
export type {
  SurfaceAuthorization,
  SurfaceEvidence,
  SurfaceMutationPlan,
  SurfaceOwnership,
  SurfaceResult,
  WslBridge,
} from "./types.js";
export interface SurfaceMutationInput {
  operation: SurfaceMutationPlan["operation"];
  evidence: SurfaceEvidence;
  authorization: SurfaceAuthorization;
  ownership: SurfaceOwnership;
  mutations: readonly string[];
}
function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}
function freezeBridge(bridge: WslBridge | undefined): WslBridge | undefined {
  return bridge === undefined ? undefined : Object.freeze({ ...bridge });
}
function sameBridge(left: WslBridge | undefined, right: WslBridge | undefined): boolean {
  return left?.distribution === right?.distribution;
}
function sameExecutable(
  left: SurfaceEvidence["executable"], right: SurfaceEvidence["executable"],
): boolean {
  return left?.path === right?.path && left?.command === right?.command && left?.version === right?.version;
}
function isAuthorizedWindowsTarget(input: SurfaceMutationInput): string | undefined {
  const { authorization, evidence } = input;
  if (evidence.host !== "windows") return undefined;
  if (
    authorization.crossHost !== "authorized" ||
    (authorization.source !== "explicit" && authorization.source !== "prompt")
  ) return "cross-host target is not authorized";
  return undefined;
}
function hasExactBridge(input: SurfaceMutationInput): boolean {
  const { authorization, evidence, ownership } = input;
  return evidence.bridge !== undefined &&
    sameBridge(evidence.bridge, authorization.bridge) &&
    sameBridge(evidence.bridge, ownership.bridge);
}
function canWrite(input: SurfaceMutationInput): string | undefined {
  const { evidence, operation, ownership } = input;
  const authorizationFailure = isAuthorizedWindowsTarget(input);
  if (authorizationFailure !== undefined) return authorizationFailure;
  if (evidence.targetKey !== ownership.targetKey) return "evidence and ownership must identify the same target";
  if (evidence.host === "windows" && !hasExactBridge(input)) return "cross-host bridge identity is not exact";
  if (operation === "remove") {
    return ownership.state === "owned" ? undefined : "target is not Kanon-owned";
  }
  if (evidence.state !== "executable-valid" || evidence.executable === undefined) {
    return "target is not executable-valid";
  }
  if (operation === "repair" && ownership.state !== "owned") {
    return "repair target is not Kanon-owned";
  }
  if (operation === "configure" && ownership.state !== "owned" && ownership.state !== "missing") {
    return "configure target ownership is unsafe";
  }
  return undefined;
}
export function planSurfaceMutation(input: SurfaceMutationInput): SurfaceMutationPlan {
  const reason = canWrite(input);
  const bridge = freezeBridge(input.evidence.bridge ?? input.authorization.bridge ?? input.ownership.bridge);
  const evidence = Object.freeze({
    ...input.evidence,
    bridge: freezeBridge(input.evidence.bridge),
    executable: input.evidence.executable === undefined
      ? undefined
      : Object.freeze({ ...input.evidence.executable }),
  });
  const authorization = Object.freeze({
    ...input.authorization,
    bridge: freezeBridge(input.authorization.bridge),
  });
  const ownership = Object.freeze({ ...input.ownership, bridge: freezeBridge(input.ownership.bridge) });
  return Object.freeze({
    operation: input.operation,
    evidence,
    authorization,
    ownership,
    decision: reason === undefined ? "write" : "skip",
    mutations: freezeArray(input.mutations),
    bridge,
    reason: reason ?? "authorized target is ready for lifecycle mutation",
  });
}
export function validateSurfaceMutationPlan(plan: SurfaceMutationPlan): readonly string[] {
  const issues: string[] = [];
  if (plan.evidence.targetKey !== plan.ownership.targetKey) {
    issues.push("evidence and ownership must identify the same target");
  }
  if (plan.decision === "write" && plan.mutations.length === 0) {
    issues.push("write plans must declare at least one mutation");
  }
  if (plan.decision === "write" && canWrite(plan) !== undefined) {
    issues.push("write plan is not authorized by its lifecycle evidence");
  }
  if (
    plan.decision === "write" &&
    plan.evidence.host === "windows" &&
    (!sameBridge(plan.bridge, plan.evidence.bridge) || !hasExactBridge(plan))
  ) {
    issues.push("write plan must carry one exact cross-host bridge identity");
  }
  return freezeArray(issues);
}
function equivalentPlans(left: SurfaceMutationPlan, right: SurfaceMutationPlan): boolean {
  return left.operation === right.operation && left.decision === right.decision &&
    left.mutations.length === right.mutations.length && left.mutations.every((mutation, index) => mutation === right.mutations[index]) &&
    left.ownership.configPath === right.ownership.configPath && left.ownership.state === right.ownership.state &&
    left.evidence.state === right.evidence.state && sameExecutable(left.evidence.executable, right.evidence.executable) &&
    left.evidence.host === right.evidence.host && sameBridge(left.evidence.bridge, right.evidence.bridge) &&
    left.authorization.source === right.authorization.source && left.authorization.crossHost === right.authorization.crossHost &&
    sameBridge(left.authorization.bridge, right.authorization.bridge) &&
    sameBridge(left.ownership.bridge, right.ownership.bridge) && sameBridge(left.bridge, right.bridge);
}
export function deduplicateSurfaceMutationPlans(
  plans: readonly SurfaceMutationPlan[],
): readonly SurfaceMutationPlan[] {
  const canonical = new Map<string, SurfaceMutationPlan>();
  for (const plan of plans) {
    const prior = canonical.get(plan.ownership.targetKey);
    if (prior === undefined) canonical.set(plan.ownership.targetKey, plan);
    else if (!equivalentPlans(prior, plan)) {
      throw new Error(`conflicting lifecycle plans for target ${plan.ownership.targetKey}`);
    }
  }
  return freezeArray([...canonical.values()]);
}
export function createSurfaceResult(result: SurfaceResult): SurfaceResult {
  return Object.freeze({ ...result, paths: freezeArray(result.paths) });
}
