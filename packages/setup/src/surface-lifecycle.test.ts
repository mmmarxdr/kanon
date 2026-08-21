import { describe, expect, it } from "vitest";
import {
  createSurfaceResult,
  deduplicateSurfaceMutationPlans,
  planSurfaceMutation,
  validateSurfaceMutationPlan,
} from "./surface-lifecycle.js";
import type {
  EvidenceState,
  SurfaceAuthorization,
  SurfaceEvidence,
  SurfaceOwnership,
} from "./types.js";
const executable: SurfaceEvidence["executable"] = {
  path: "/opt/cursor",
  command: "cursor",
  version: "1.0.0",
};
function evidence(overrides: Partial<SurfaceEvidence> = {}): SurfaceEvidence {
  return {
    tool: "cursor",
    surface: "Cursor CLI",
    host: "local",
    state: "executable-valid",
    targetKey: "cursor-cli",
    executable,
    ...overrides,
  };
}
function authorization(
  overrides: Partial<SurfaceAuthorization> = {},
): SurfaceAuthorization {
  return { source: "explicit", crossHost: "authorized", ...overrides };
}
function ownership(
  overrides: Partial<SurfaceOwnership> = {},
): SurfaceOwnership {
  return {
    targetKey: "cursor-cli",
    configPath: "/home/test/.cursor/mcp.json",
    state: "owned",
    ...overrides,
  };
}
describe("surface lifecycle contracts", () => {
  it("exposes the complete evidence state union", () => {
    const states: EvidenceState[] = [
      "executable-valid",
      "configured-only/stale",
      "wsl-only/bridge",
      "ambiguous",
      "absent",
    ];
    expect(states).toHaveLength(5);
  });
  it("fails closed for an unauthorized cross-host configure plan", () => {
    const plan = planSurfaceMutation({
      operation: "configure",
      evidence: evidence({ host: "windows", targetKey: "cursor-windows" }),
      authorization: authorization({ source: "autodetect", crossHost: "denied" }),
      ownership: ownership({ targetKey: "cursor-windows" }),
      mutations: ["remove-kanon"],
    });
    expect(plan.decision).toBe("skip");
    expect(plan.reason).toContain("not authorized");
  });
  it("allows explicit executable-valid targets and makes plan data immutable", () => {
    const mutations = ["write-mcp"];
    const plan = planSurfaceMutation({
      operation: "repair",
      evidence: evidence(),
      authorization: authorization(),
      ownership: ownership(),
      mutations,
    });
    mutations.push("unexpected");
    expect(plan.decision).toBe("write");
    expect(plan.mutations).toEqual(["write-mcp"]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.mutations)).toBe(true);
  });
  it("permits removal from owned inventory without executable evidence", () => {
    const plan = planSurfaceMutation({
      operation: "remove",
      evidence: evidence({ state: "absent", executable: undefined }),
      authorization: authorization({ crossHost: "denied" }),
      ownership: ownership(),
      mutations: ["remove-kanon"],
    });
    expect(plan.decision).toBe("write");
    expect(validateSurfaceMutationPlan(plan)).toEqual([]);
  });
  it("returns immutable lifecycle outcomes", () => {
    const paths = ["/home/test/.cursor/mcp.json"];
    const result = createSurfaceResult({
      surface: "Cursor CLI",
      host: "local",
      evidence: "executable-valid",
      outcome: "ready",
      paths,
      message: "Configured",
    });
    paths.push("unexpected");
    expect(result.paths).toEqual(["/home/test/.cursor/mcp.json"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.paths)).toBe(true);
  });
  it("deduplicates shared physical targets while retaining one canonical plan", () => {
    const first = planSurfaceMutation({
      operation: "configure",
      evidence: evidence({ surface: "Cursor IDE", targetKey: "shared-config" }),
      authorization: authorization(),
      ownership: ownership({ targetKey: "shared-config" }),
      mutations: ["write-mcp"],
    });
    const duplicate = planSurfaceMutation({
      operation: "configure",
      evidence: evidence({ surface: "Cursor CLI", targetKey: "shared-config" }),
      authorization: authorization(),
      ownership: ownership({ targetKey: "shared-config" }),
      mutations: ["write-mcp"],
    });
    expect(deduplicateSurfaceMutationPlans([first, duplicate])).toEqual([first]);
  });
  it("deduplicates equivalent executable values regardless of key insertion order", () => {
    const input = { operation: "configure" as const, authorization: authorization(), mutations: ["write-mcp"] };
    const first = planSurfaceMutation({ ...input,
      evidence: evidence({ targetKey: "shared", executable: { path: "/opt/cursor", command: "cursor", version: "1.0.0" } }),
      ownership: ownership({ targetKey: "shared" }),
    });
    const duplicate = planSurfaceMutation({ ...input,
      evidence: evidence({ targetKey: "shared", executable: { version: "1.0.0", command: "cursor", path: "/opt/cursor" } }),
      ownership: ownership({ targetKey: "shared" }),
    });
    expect(deduplicateSurfaceMutationPlans([first, duplicate])).toEqual([first]);
  });
});
describe("reliability regressions", () => {
  it("REL-PR1-001 denies unauthorized Windows removal", () => {
    expect(planSurfaceMutation({
      operation: "remove", evidence: evidence({ host: "windows", targetKey: "windows" }),
      authorization: authorization({ source: "all", crossHost: "denied" }),
      ownership: ownership({ targetKey: "windows" }), mutations: ["remove-kanon"],
    }).decision).toBe("skip");
  });
  it("REL-PR1-PUSH-002 requires an exact Windows bridge identity for removal", () => {
    const plan = planSurfaceMutation({
      operation: "remove",
      evidence: evidence({ host: "windows", targetKey: "windows", bridge: { distribution: "Ubuntu" } }),
      authorization: authorization({ bridge: { distribution: "Ubuntu" } }),
      ownership: ownership({ targetKey: "windows", bridge: { distribution: "Debian" } }),
      mutations: ["write-mcp"],
    });
    expect(plan.decision).toBe("skip");
    expect(validateSurfaceMutationPlan({ ...plan, decision: "write" })).toContain(
      "write plan must carry one exact cross-host bridge identity",
    );
  });
  it.each([
    ["configure", "unowned", "cursor-cli"],
    ["repair", "invalid", "cursor-cli"],
    ["configure", "owned", "cursor-other"],
  ] as const)("REL-PR1-PUSH-001 skips %s for %s ownership or a mismatched target", (operation, state, targetKey) => {
    expect(planSurfaceMutation({
      operation, evidence: evidence(), authorization: authorization(),
      ownership: ownership({ state, targetKey }), mutations: ["write-mcp"],
    }).decision).toBe("skip");
  });
  it("REL-PR1-004 rejects conflicting shared-target plans", () => {
    const input = { operation: "configure" as const, evidence: evidence({ targetKey: "shared" }),
      authorization: authorization(), ownership: ownership({ targetKey: "shared" }) };
    expect(() => deduplicateSurfaceMutationPlans([
      planSurfaceMutation({ ...input, mutations: ["write-mcp"] }),
      planSurfaceMutation({ ...input, mutations: ["remove-kanon"] }),
    ])).toThrow("conflicting");
  });
});
it.each([
  ["host", evidence(), evidence({ host: "windows" }), ownership({ state: "invalid" }), ownership({ state: "invalid" })],
  ["evidence bridge", evidence({ bridge: { distribution: "one" } }), evidence({ bridge: { distribution: "two" } }), ownership(), ownership()],
  ["ownership bridge", evidence(), evidence(), ownership({ bridge: { distribution: "one" } }), ownership({ bridge: { distribution: "two" } })],
])("REL-PR1-004 rejects shared targets with conflicting %s identity", (_, firstEvidence, secondEvidence, firstOwnership, secondOwnership) => {
  const input = { operation: "configure" as const, authorization: authorization(), mutations: ["write-mcp"] };
  expect(() => deduplicateSurfaceMutationPlans([
    planSurfaceMutation({ ...input, evidence: firstEvidence, ownership: firstOwnership }),
    planSurfaceMutation({ ...input, evidence: secondEvidence, ownership: secondOwnership }),
  ])).toThrow("conflicting");
});
