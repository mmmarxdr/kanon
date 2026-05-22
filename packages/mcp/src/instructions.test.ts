/**
 * instructions.test.ts — Win B
 *
 * Asserts that:
 * 1. SERVER_INSTRUCTIONS contains a DEFERRED TOOLS heading
 * 2. Each of the 5 deferred tool names appears verbatim in SERVER_INSTRUCTIONS
 * 3. DEFERRED_TOOLS array has exactly 5 entries
 * 4. index.ts source passes instructions: SERVER_INSTRUCTIONS to new McpServer(...)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// These imports will fail (RED) until instructions.ts is created
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
