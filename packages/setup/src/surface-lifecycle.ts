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
  return left?.distribution === right?.distribution && left?.nodePath === right?.nodePath;
}
function sameExecutable(
  left: SurfaceEvidence["executable"], right: SurfaceEvidence["executable"],
): boolean {
  return left?.path === right?.path && left?.command === right?.command && left?.version === right?.version;
}
function isAuthorizedWindowsTarget(input: SurfaceMutationInput): string | undefined {
  const { authorization, evidence, operation } = input;
  if (evidence.host !== "windows") return undefined;
  if (authorization.crossHost !== "authorized") return "cross-host target is not authorized";
  if (operation === "remove" && authorization.source === "inventory") return undefined;
  if (authorization.source === "explicit" || authorization.source === "prompt") return undefined;
  return "cross-host target is not authorized";
}
function isInventoryOwnedWindowsRemoval(input: SurfaceMutationInput): boolean {
  const { authorization, evidence, operation, ownership } = input;
  return evidence.host === "windows" && operation === "remove" &&
    authorization.source === "inventory" && authorization.crossHost === "authorized" &&
    ownership.state === "owned" && evidence.targetKey === ownership.targetKey;
}
function hasNodePath(bridge: WslBridge | undefined): boolean {
  return (bridge?.nodePath?.trim().length ?? 0) > 0;
}
function hasDistribution(bridge: WslBridge | undefined): boolean {
  return (bridge?.distribution.trim().length ?? 0) > 0;
}
function hasBridgeIdentity(bridge: WslBridge | undefined): boolean {
  return hasNodePath(bridge) && hasDistribution(bridge);
}
function hasRequiredBridgeNodePaths(input: SurfaceMutationInput): boolean {
  const { authorization, evidence, ownership } = input;
  return hasBridgeIdentity(evidence.bridge) && hasBridgeIdentity(authorization.bridge) && hasBridgeIdentity(ownership.bridge);
}
function isMissingOwnershipWindowsConfigure(input: SurfaceMutationInput): boolean {
  const { evidence, operation, ownership } = input;
  return evidence.host === "windows" && operation === "configure" &&
    ownership.state === "missing" && evidence.targetKey === ownership.targetKey;
}
function hasRequiredBridgeNodePathsForMutation(input: SurfaceMutationInput): boolean {
  if (!isMissingOwnershipWindowsConfigure(input)) return hasRequiredBridgeNodePaths(input);
  const { authorization, evidence, ownership } = input;
  return hasBridgeIdentity(evidence.bridge) && hasBridgeIdentity(authorization.bridge) &&
    (ownership.bridge === undefined || hasBridgeIdentity(ownership.bridge));
}
function hasExactBridge(input: SurfaceMutationInput): boolean {
  const { authorization, evidence, ownership } = input;
  return hasRequiredBridgeNodePaths(input) &&
    sameBridge(evidence.bridge, authorization.bridge) &&
    sameBridge(evidence.bridge, ownership.bridge);
}
function hasExactBridgeForMutation(input: SurfaceMutationInput): boolean {
  if (!isMissingOwnershipWindowsConfigure(input)) return hasExactBridge(input);
  const { authorization, evidence, ownership } = input;
  return hasRequiredBridgeNodePathsForMutation(input) &&
    sameBridge(evidence.bridge, authorization.bridge) &&
    (ownership.bridge === undefined || sameBridge(evidence.bridge, ownership.bridge));
}
function canWrite(input: SurfaceMutationInput): string | undefined {
  const { evidence, operation, ownership } = input;
  const authorizationFailure = isAuthorizedWindowsTarget(input);
  if (authorizationFailure !== undefined) return authorizationFailure;
  if (evidence.targetKey !== ownership.targetKey) return "evidence and ownership must identify the same target";
  if (evidence.host === "windows" && !isInventoryOwnedWindowsRemoval(input)) {
    if (!hasRequiredBridgeNodePathsForMutation(input)) return "cross-host bridge Node path is not exact";
    if (!hasExactBridgeForMutation(input)) return "cross-host bridge identity is not exact";
  }
  if (operation === "remove") {
    return ownership.state === "owned" ? undefined : "target is not Kanon-owned";
  }
  if (
    evidence.state !== "executable-valid" || evidence.executable === undefined
  ) {
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
    !isInventoryOwnedWindowsRemoval(plan) &&
    (!sameBridge(plan.bridge, plan.evidence.bridge) || !hasExactBridgeForMutation(plan))
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
