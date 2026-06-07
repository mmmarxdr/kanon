/**
 * instructions.test.ts — Win B + PM Persona ceiling
 *
 * Win B: SERVER_INSTRUCTIONS contains DEFERRED TOOLS heading, all 5 deferred
 *        tool names, and is wired into McpServer constructor.
 *
 * PM Persona (new): byte ceiling ≤ 1500, persona block firing pins.
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

  it("B2: DEFERRED_TOOLS array has exactly 5 entries", () => {
    expect(DEFERRED_TOOLS).toHaveLength(5);
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
  it("P1: SERVER_INSTRUCTIONS byte length ≤ 1500", () => {
    expect(Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8")).toBeLessThanOrEqual(
      1500,
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
});
