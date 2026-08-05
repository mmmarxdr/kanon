/**
 * inventory.test.ts — KAN-193 PR11 inventory, budgets, docs agreement
 *
 * Exact 49/26/23 counts, fixed ceilings, deferred triage discovery,
 * firing-pin wording, and documentation checks for mcp.mdx / kanon.md.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseAllToolDescriptions } from "./tools/descriptions-parser.js";
import {
  DESCRIPTION_BASELINE_BYTES,
  PRE_TRIAGE_VERBOSE_DESCRIPTION_BYTES,
  VERBOSE_DESCRIPTION_TRIM_MIN_BYTES,
} from "./tools/__tests__/baseline.fixture.js";
import {
  SERVER_INSTRUCTIONS,
  DEFERRED_TOOLS,
  MCP_TOOL_COUNT,
  MCP_CORE_TOOL_COUNT,
  MCP_DEFERRED_TOOL_COUNT,
  INSTRUCTION_CEILING_BYTES,
  DESCRIPTION_TOPLINE_CEILING_BYTES,
} from "./instructions.js";
import { TRIAGE_DEFERRED_TOOLS } from "./tools/triage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "tools");
const REPO_ROOT = join(__dirname, "../../..");

const LEGACY_44_TOOL_NAMES = [
  "add_dependency",
  "adjust_time_entry",
  "apply_proposal",
  "approve_time_entry",
  "close_cycle",
  "create_cycle",
  "create_design_record",
  "create_issue",
  "create_issue_comment",
  "create_project",
  "create_roadmap_item",
  "delete_cycle",
  "delete_roadmap_item",
  "get_cycle",
  "get_design_record",
  "get_issue",
  "get_project",
  "list_active_workers",
  "list_cycles",
  "list_design_records",
  "list_groups",
  "list_issues",
  "list_members",
  "list_my_worklogs",
  "list_projects",
  "list_roadmap",
  "list_workspaces",
  "promote_roadmap_item",
  "promote_worklog",
  "propose_estimate",
  "reconcile_time",
  "reject_time_entry",
  "remove_dependency",
  "report_incident",
  "start_work",
  "stop_work",
  "submit_time_entry",
  "transition_issue",
  "transition_issues",
  "update_cycle_scope",
  "update_issue",
  "update_project",
  "update_roadmap_item",
  "update_time_entry",
] as const;

function collectDescriptions() {
  const files = readdirSync(TOOLS_DIR)
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        f !== "descriptions-parser.ts",
    )
    .map((f) => join(TOOLS_DIR, f));
  return parseAllToolDescriptions(files);
}

describe("KAN-193 inventory counts", () => {
  it("constants agree: 49 total = 26 core + 23 deferred", () => {
    expect(MCP_TOOL_COUNT).toBe(49);
    expect(MCP_CORE_TOOL_COUNT).toBe(26);
    expect(MCP_DEFERRED_TOOL_COUNT).toBe(23);
    expect(MCP_CORE_TOOL_COUNT + MCP_DEFERRED_TOOL_COUNT).toBe(MCP_TOOL_COUNT);
    expect(DEFERRED_TOOLS).toHaveLength(MCP_DEFERRED_TOOL_COUNT);
  });

  it("runtime registrations match 49/26/23", () => {
    const tools = collectDescriptions();
    expect(tools).toHaveLength(MCP_TOOL_COUNT);
    const deferred = new Set<string>(DEFERRED_TOOLS);
    const deferredCount = tools.filter((t) => deferred.has(t.toolName)).length;
    expect(deferredCount).toBe(MCP_DEFERRED_TOOL_COUNT);
    expect(tools.length - deferredCount).toBe(MCP_CORE_TOOL_COUNT);
  });

  it("five triage names are deferred and discoverable in instructions", () => {
    for (const name of TRIAGE_DEFERRED_TOOLS) {
      expect(DEFERRED_TOOLS).toContain(name);
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
  });

  it("preserves all 44 pre-triage tool names", () => {
    const names = new Set(collectDescriptions().map((t) => t.toolName));
    for (const name of LEGACY_44_TOOL_NAMES) {
      expect(names.has(name)).toBe(true);
    }
  });
});

describe("KAN-193 fixed ceilings", () => {
  it("does not re-anchor DESCRIPTION_BASELINE_BYTES or topline ceiling", () => {
    expect(DESCRIPTION_BASELINE_BYTES).toBe(5650);
    expect(DESCRIPTION_TOPLINE_CEILING_BYTES).toBe(5350);
    expect(DESCRIPTION_TOPLINE_CEILING_BYTES).toBe(DESCRIPTION_BASELINE_BYTES - 300);
  });

  it("instruction ceiling remains 1950; actual ≤ 1900 target preferred", () => {
    expect(INSTRUCTION_CEILING_BYTES).toBe(1950);
    const bytes = Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8");
    expect(bytes).toBeLessThanOrEqual(INSTRUCTION_CEILING_BYTES);
    expect(bytes).toBeLessThanOrEqual(1900);
  });

  it("topline descriptions stay under fixed ceiling with 50-byte floor", () => {
    const tools = collectDescriptions();
    const total = tools.reduce((s, t) => s + t.byteLength, 0);
    expect(total).toBeLessThanOrEqual(DESCRIPTION_TOPLINE_CEILING_BYTES);
    expect(tools.every((t) => t.byteLength >= 50)).toBe(true);
  });

  it("trims ≥445 bytes from capture/groups/cycles/timesheet vs pre-triage", () => {
    const verboseFiles = ["capture.ts", "groups.ts", "cycles.ts", "timesheet.ts"].map((f) =>
      join(TOOLS_DIR, f),
    );
    const current = parseAllToolDescriptions(verboseFiles).reduce(
      (s, t) => s + t.byteLength,
      0,
    );
    const trimmed = PRE_TRIAGE_VERBOSE_DESCRIPTION_BYTES - current;
    expect(PRE_TRIAGE_VERBOSE_DESCRIPTION_BYTES).toBe(2478);
    expect(trimmed).toBeGreaterThanOrEqual(VERBOSE_DESCRIPTION_TRIM_MIN_BYTES);
  });
});

describe("KAN-193 instructions firing pins", () => {
  it("documents triage enablement order and project-only list", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/preview\/search/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/get\/list/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/persist\/dismiss/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/retention/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/project-only/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/no workspace-wide queue/i);
  });

  it("states triage is non-executable and legacy apply is not triage", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/non-executable/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/apply_proposal is not triage/i);
    expect(SERVER_INSTRUCTIONS).not.toMatch(/autonomous triage/i);
    // Negation must be explicit — do not advertise a positive workspace-wide queue.
    expect(SERVER_INSTRUCTIONS).toMatch(/no workspace-wide queue/i);
    expect(SERVER_INSTRUCTIONS).not.toMatch(
      /(?:offers|provides|supports)\s+workspace-wide/i,
    );
  });

  it("keeps persona / format / reconcile pins", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/PM Persona/i);
    expect(SERVER_INSTRUCTIONS).toContain("[Area]");
    expect(SERVER_INSTRUCTIONS).toContain("list_groups");
    expect(SERVER_INSTRUCTIONS).toContain("format: ack");
    expect(SERVER_INSTRUCTIONS).toContain("reconcile_time");
    expect(SERVER_INSTRUCTIONS).toMatch(/## Context/);
  });
});

describe("KAN-193 documentation", () => {
  const mcpDoc = readFileSync(join(REPO_ROOT, "docs/modules/mcp.mdx"), "utf8");
  const agentDoc = readFileSync(join(REPO_ROOT, "packages/mcp/agents/kanon.md"), "utf8");

  it("docs/modules/mcp.mdx states 49/26/23 and triage protocol", () => {
    expect(mcpDoc).toMatch(/49 tools/);
    expect(mcpDoc).toMatch(/26 core/);
    expect(mcpDoc).toMatch(/23 deferred/);
    expect(mcpDoc).toContain("preview_issue_triage");
    expect(mcpDoc).toContain("persist_triage_proposal");
    expect(mcpDoc).toContain("list_triage_proposals");
    expect(mcpDoc).toContain("dismiss_triage_proposal");
    expect(mcpDoc).toMatch(/projectKey/);
    expect(mcpDoc).toMatch(/no workspace-wide MCP queue/i);
    expect(mcpDoc).toMatch(/non-executable/i);
    expect(mcpDoc).toMatch(/apply_proposal/);
    expect(mcpDoc).not.toMatch(/workspace-wide proposal list/i);
    expect(mcpDoc).toMatch(/preview\/search → get\/list → persist\/dismiss → retention/);
  });

  it("docs include rollout/rollback runbook and 44-tool rollback", () => {
    expect(mcpDoc).toMatch(/Rollout and rollback/i);
    expect(mcpDoc).toMatch(/triage-preview-v1/);
    expect(mcpDoc).toMatch(/triage-proposal-list-v1/);
    expect(mcpDoc).toMatch(/44-tool/);
    expect(mcpDoc).toMatch(/Destructive database rollback/i);
    expect(agentDoc).toMatch(/Enablement \/ rollback/i);
    expect(agentDoc).toMatch(/44 tools/);
    expect(agentDoc).toMatch(/export\/backfill/i);
  });

  it("packages/mcp/agents/kanon.md documents triage tools without advertising apply-as-execution", () => {
    expect(agentDoc).toMatch(/49 tools/);
    expect(agentDoc).toContain("kanon_preview_issue_triage");
    expect(agentDoc).toContain("kanon_persist_triage_proposal");
    expect(agentDoc).toContain("kanon_list_triage_proposals");
    expect(agentDoc).toContain("kanon_dismiss_triage_proposal");
    expect(agentDoc).toMatch(/not triage execution/i);
    expect(agentDoc).toMatch(/no workspace-wide queue/i);
    expect(agentDoc).not.toMatch(/apply.*triage proposal/i);
  });
});
