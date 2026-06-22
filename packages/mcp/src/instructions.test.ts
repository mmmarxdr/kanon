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

import { SERVER_INSTRUCTIONS, DEFERRED_TOOLS } from "./instructions.js";

describe("Win B — SERVER_INSTRUCTIONS deferred tools block", () => {
  it("B1: SERVER_INSTRUCTIONS contains DEFERRED TOOLS heading", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/DEFERRED TOOLS/i);
  });

  it("B2: DEFERRED_TOOLS array has exactly 18 entries", () => {
    // Updated for KAN-104: +2 PM-only timesheet tools (approve/reject).
    // Updated for KAN-118: +3 occasion-only tools (add/remove dependency, adjust time entry).
    // Updated for KAN-119: +1 resolution helper (kanon_list_members).
    // Updated for KAN-120: +1 agent communication tool (kanon_comment_issue).
    // Updated for KAN-104 capture tools: +3 (report_incident, propose_estimate, apply_proposal).
    expect(DEFERRED_TOOLS).toHaveLength(18);
  });

  it("B3: each deferred tool name appears verbatim in SERVER_INSTRUCTIONS", () => {
    for (const name of DEFERRED_TOOLS) {
      expect(SERVER_INSTRUCTIONS).toContain(name);
    }
  });

  it("B4: the 5 deferred tools are exactly the expected cold tools", () => {
    const expected = [
      "kanon_create_project",
      "kanon_update_project",
      "kanon_delete_cycle",
      "kanon_delete_roadmap_item",
      "kanon_who_is_working",
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
  it("P1: SERVER_INSTRUCTIONS byte length ≤ 1900", () => {
    // ceiling re-anchored for 38-tool surface with 10 deferred (was 1,600 @ 8 deferred);
    // KAN-104 timesheet: +2 deferred names (~54 B) + 2 core tool lines (~105 B) → ~159 B added.
    // KAN-104 capture tools: +3 deferred names (report_incident, propose_estimate, apply_proposal)
    //   → ~72 B added; ceiling bumped to 1900 (CORE section unchanged, only DEFERRED list grows).
    expect(Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(
      1900,
    );
  });

  it("P2: SERVER_INSTRUCTIONS matches /PM Persona/i", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/PM Persona/i);
  });

  it("P3: SERVER_INSTRUCTIONS contains [Area]", () => {
    expect(SERVER_INSTRUCTIONS).toContain("[Area]");
  });

  it("P4: SERVER_INSTRUCTIONS contains kanon_list_groups", () => {
    expect(SERVER_INSTRUCTIONS).toContain("kanon_list_groups");
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

describe("PR-4a review — document tools discoverability", () => {
  it("B2-doc: DEFERRED_TOOLS includes kanon_create_document", () => {
    expect(DEFERRED_TOOLS).toContain("kanon_create_document");
  });

  it("B2-list: DEFERRED_TOOLS includes kanon_list_documents", () => {
    expect(DEFERRED_TOOLS).toContain("kanon_list_documents");
  });

  it("B2-get: DEFERRED_TOOLS includes kanon_get_document", () => {
    expect(DEFERRED_TOOLS).toContain("kanon_get_document");
  });

  it("B2-pin: kanon_create_document appears verbatim in SERVER_INSTRUCTIONS", () => {
    expect(SERVER_INSTRUCTIONS).toContain("kanon_create_document");
  });
});
