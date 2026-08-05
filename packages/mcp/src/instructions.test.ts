/**
 * instructions.test.ts — Win B + PM Persona ceiling
 *
 * Win B: SERVER_INSTRUCTIONS contains DEFERRED TOOLS heading, all 14 deferred
 *        tool names, and is wired into McpServer constructor.
 *
 * PM Persona (new): byte ceiling ≤ 1800 (re-anchored for 39-tool surface @ 14 deferred),
 *                   persona block firing pins.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  SERVER_INSTRUCTIONS,
  DEFERRED_TOOLS,
  MCP_TOOL_COUNT,
  MCP_CORE_TOOL_COUNT,
  MCP_DEFERRED_TOOL_COUNT,
  INSTRUCTION_CEILING_BYTES,
} from "./instructions.js";

describe("Win B — SERVER_INSTRUCTIONS deferred tools block", () => {
  it("B1: SERVER_INSTRUCTIONS contains DEFERRED TOOLS heading", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/DEFERRED TOOLS/i);
  });

  it("B2: DEFERRED_TOOLS array has exactly 23 entries", () => {
    // Updated for KAN-104: +2 PM-only timesheet tools (approve/reject).
    // Updated for KAN-118: +3 occasion-only tools (add/remove dependency, adjust time entry).
    // Updated for KAN-119: +1 resolution helper (list_members).
    // Updated for KAN-120: +1 agent communication tool (create_issue_comment).
    // Updated for KAN-104 capture tools: +3 (report_incident, propose_estimate, apply_proposal).
    // Updated for KAN-193 triage: +5 (preview/persist/get/list/dismiss).
    expect(DEFERRED_TOOLS).toHaveLength(23);
  });

  it("B3: each deferred tool name appears verbatim in SERVER_INSTRUCTIONS", () => {
    for (const name of DEFERRED_TOOLS) {
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
  });

  it("B4: the 5 deferred tools are exactly the expected cold tools", () => {
    const expected = [
      "create_project",
      "update_project",
      "delete_cycle",
      "delete_roadmap_item",
      "list_active_workers",
    ];
    for (const name of expected) {
      expect(DEFERRED_TOOLS).toContain(name);
    }
  });

  it("B5: index.ts source wires instructions: SERVER_INSTRUCTIONS into McpServer constructor", () => {
    const src = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(src).toMatch(/instructions\s*:\s*SERVER_INSTRUCTIONS/);
  });
});

// ─── PM Persona — byte ceiling and firing pins ───────────────────────────────

describe("PM Persona — byte ceiling and firing pins", () => {
  it("P1: SERVER_INSTRUCTIONS byte length ≤ INSTRUCTION_CEILING_BYTES (1950)", () => {
    // Fixed ceiling unchanged by KAN-193. Target ≤1900 after triage guidance + prose trim.
    expect(INSTRUCTION_CEILING_BYTES).toBe(1950);
    expect(Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(
      INSTRUCTION_CEILING_BYTES,
    );
  });

  it("P1b: inventory constants are 49/26/23", () => {
    expect(MCP_TOOL_COUNT).toBe(49);
    expect(MCP_CORE_TOOL_COUNT).toBe(26);
    expect(MCP_DEFERRED_TOOL_COUNT).toBe(23);
  });

  it("P2: SERVER_INSTRUCTIONS matches /PM Persona/i", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/PM Persona/i);
  });

  it("P3: SERVER_INSTRUCTIONS contains [Area]", () => {
    expect(SERVER_INSTRUCTIONS).toContain("[Area]");
  });

  it("P4: SERVER_INSTRUCTIONS contains list_groups", () => {
    expect(SERVER_INSTRUCTIONS).toContain("list_groups");
  });

  it("P5: SERVER_INSTRUCTIONS contains format: ack", () => {
    expect(SERVER_INSTRUCTIONS).toContain("format: ack");
  });

  it("P6: SERVER_INSTRUCTIONS still contains DEFERRED TOOLS heading", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/DEFERRED TOOLS/i);
  });

  it("P7: all DEFERRED_TOOLS appear verbatim in SERVER_INSTRUCTIONS", () => {
    for (const name of DEFERRED_TOOLS) {
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
  });

  it("P8: SERVER_INSTRUCTIONS still contains CORE TOOLS heading", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/CORE TOOLS/i);
  });
});

// ─── PR-2 Firing Pins — description coaching ─────────────────────────────────

describe("PR-2 firing pins — description coaching", () => {
  it("P2a: SERVER_INSTRUCTIONS contains DESCRIPTION coaching", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/DESCRIPTION/);
  });

  it("P2b: SERVER_INSTRUCTIONS contains ## Context coaching", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/## Context/);
  });
});

// ─── PR-4a Firing Pin — L2 ADR cardinality guidance ──────────────────────────

describe("PR-4a firing pins — design records guidance", () => {
  it("P4a: SERVER_INSTRUCTIONS contains Design records guidance line", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/Design records/i);
  });
});

// ─── PR-4a review — document tools in DEFERRED_TOOLS ─────────────────────────

// ─── KAN-188 — reconcile-time confirm-or-adjust flow discoverability ────────

describe("KAN-188 — reconcile_time discoverability", () => {
  it("R1: SERVER_INSTRUCTIONS mentions reconcile_time in CORE TOOLS", () => {
    expect(SERVER_INSTRUCTIONS).toContain("reconcile_time");
  });

  it("R2: SERVER_INSTRUCTIONS documents the done-transition reconcile gate", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/reconcile/i);
  });

  it("requires a due date before active work", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/Before start_work: dueDate/);
  });
});

describe("PR-4a review — document tools discoverability", () => {
  it("B2-doc: DEFERRED_TOOLS includes create_design_record", () => {
    expect(DEFERRED_TOOLS).toContain("create_design_record");
  });

  it("B2-list: DEFERRED_TOOLS includes list_design_records", () => {
    expect(DEFERRED_TOOLS).toContain("list_design_records");
  });

  it("B2-get: DEFERRED_TOOLS includes get_design_record", () => {
    expect(DEFERRED_TOOLS).toContain("get_design_record");
  });

  it("B2-pin: create_design_record appears verbatim in SERVER_INSTRUCTIONS", () => {
    expect(SERVER_INSTRUCTIONS).toContain("create_design_record");
  });
});
