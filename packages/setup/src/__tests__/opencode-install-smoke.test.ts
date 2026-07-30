/**
 * OpenCode install smoke test — KAN-55 Phase 4.
 *
 * APPROACH: composed primitives (NOT run()).
 *
 * run() is not used here because it calls buildPlatformContext() (reads real OS
 * env), resolveAuth() (interactive/network), resolveWrapperReuse() (keychain),
 * and resolveMcpServerPath() (resolves relative to the compiled __dirname of
 * dist/) — all of which require real system state or non-trivial seams to
 * override. Driving them would add 3-4 mocks for infrastructure, not behaviour.
 *
 * Instead, the test drives the REAL functions that run() composes:
 *   mergeConfig / removeConfig  (mcp-config.ts)
 *   installSkills / removeSkills  (skills.ts)
 *   installCommands / removeCommands  (commands.ts)
 *
 * It uses the REAL `getToolByName("opencode")` registry entry and its
 * OPENCODE_PATHS resolvers, feeding them a temp-homedir PlatformContext.
 * This catches any wiring regression (mis-wired step, build stripping assets,
 * wrong path resolver) that unit tests on individual functions miss.
 *
 * The one seam that IS faked: `assetsDir` is pointed at a local mirror of the
 * real assets directory structure so the test doesn't depend on the compiled
 * dist layout at runtime.  All other state is the real implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getToolByName } from "../registry.js";
import { mergeConfig, removeConfig, buildMcpEntry } from "../mcp-config.js";
import { installSkills, removeSkills, PRODUCT_SKILLS } from "../skills.js";
import { installCommands, removeCommands } from "../commands.js";
import type { PlatformContext, McpServerEntry } from "../types.js";

// ── Resolve the real assets directory from the monorepo ──────────────────────
// This avoids relying on the compiled dist layout.  packages/setup/assets/ is
// always present in the working tree and is the authoritative source of truth.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_ASSETS_DIR = path.resolve(__dirname, "../../assets");

// ── Constants ─────────────────────────────────────────────────────────────────
const EXPECTED_COMMANDS = ["kanon-agent.md", "kanon-init.md", "kanon-onboard.md"];

// Leakage: these MUST NOT appear anywhere under the temp HOME after install.
const FORBIDDEN_BASENAMES = ["AGENTS.md", "opencode.jsonc", "kanon.md"];
const FORBIDDEN_SEGMENTS = [".atl"];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Walk a directory tree and collect every file path (relative to root).
 */
function walkFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full, base));
    } else {
      result.push(path.relative(base, full));
    }
  }
  return result;
}

/**
 * Build a minimal but valid McpServerEntry that represents a static-key
 * direct-mode install (no wrapper, no network).  Used to call mergeConfig
 * with a realistic entry that formatMcpEntry will convert to OpenCode form.
 */
function buildTestEntry(apiUrl: string, apiKey: string): McpServerEntry {
  return {
    command: process.execPath,          // node binary — always present
    args: ["/fake/mcp/dist/index.js"],  // non-existent path is fine; file isn't launched
    env: {
      KANON_API_URL: apiUrl,
      KANON_API_KEY: apiKey,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("opencode install smoke — KAN-55 Phase 4", () => {
  let tmpHome: string;
  let ctx: PlatformContext;

  // Resolved paths derived from ctx (set in beforeEach after tmpHome is known)
  let configPath: string;
  let skillDir: string;
  let commandDir: string;

  beforeEach(() => {
    // Each test gets its own clean temp HOME
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-opencode-smoke-"));

    ctx = { platform: "linux", homedir: tmpHome };

    // Use the REAL opencode registry entry to resolve paths — this is the
    // exact same logic run() uses in production.
    const opencode = getToolByName("opencode");
    if (!opencode) throw new Error("opencode registry entry missing");
    const paths = opencode.platforms["linux"];
    if (!paths) throw new Error("opencode has no linux platform entry");

    configPath = paths.config(ctx);
    skillDir   = paths.skills(ctx);
    commandDir = paths.commands!(ctx);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // ── Install assertions ─────────────────────────────────────────────────────

  describe("install path", () => {
    beforeEach(() => {
      // Execute the real install sequence (mirrors what run() does for opencode)
      const opencode = getToolByName("opencode")!;
      const entry = buildTestEntry("https://api.kanon.test", "test-key-abc123");

      mergeConfig(configPath, opencode.rootKey, entry);
      installSkills(skillDir, REAL_ASSETS_DIR);
      installCommands(commandDir, REAL_ASSETS_DIR);
    });

    it("(1a) opencode.json exists at the expected config path", () => {
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it("(1b) config contains the `mcp` root key (NOT `mcpServers`)", () => {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      expect(config).toHaveProperty("mcp");
      expect(config).not.toHaveProperty("mcpServers");
    });

    it("(1c) `mcp` section is object-keyed, not a top-level array", () => {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const mcp = config["mcp"];
      // Must be a plain object (Record), not an Array
      expect(typeof mcp).toBe("object");
      expect(Array.isArray(mcp)).toBe(false);
    });

    it("(1d) `mcp.kanon` entry exists with correct OpenCode array form", () => {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const mcp = config["mcp"] as Record<string, unknown>;
      expect(mcp).toHaveProperty("kanon");

      const entry = mcp["kanon"] as {
        type?: string;
        command?: unknown;
        environment?: Record<string, string>;
      };

      // OpenCode McpLocalConfig shape: type === "local", command is string[]
      expect(entry.type).toBe("local");
      expect(Array.isArray(entry.command)).toBe(true);
      expect((entry.command as string[]).length).toBeGreaterThan(0);
    });

    it("(1e) `mcp.kanon` uses `environment` (NOT `env`) for credentials", () => {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const mcp = config["mcp"] as Record<string, unknown>;
      const entry = mcp["kanon"] as Record<string, unknown>;

      // OpenCode spec: credentials MUST be in `environment`, never `env`
      expect(entry).toHaveProperty("environment");
      expect(entry).not.toHaveProperty("env");

      const env = entry["environment"] as Record<string, string>;
      expect(env["KANON_API_URL"]).toBe("https://api.kanon.test");
      expect(env["KANON_API_KEY"]).toBe("test-key-abc123");
    });

    it("(2) skills directory contains all 3 product skills (including kanon-agent)", () => {
      for (const skill of PRODUCT_SKILLS) {
        expect(
          fs.existsSync(path.join(skillDir, skill, "SKILL.md")),
          `expected ${skill}/SKILL.md to exist`,
        ).toBe(true);
      }
    });

    it("(2b) kanon-agent skill preserves sections/ subdirectory", () => {
      // The real kanon-agent asset has a sections/ subdir — ensure it was copied
      const sectionsDir = path.join(skillDir, "kanon-agent", "sections");
      expect(fs.existsSync(sectionsDir)).toBe(true);
      const sectionFiles = fs.readdirSync(sectionsDir);
      expect(sectionFiles.length).toBeGreaterThan(0);
    });

    it("(3) commands directory contains EXACTLY the 3 expected command files", () => {
      expect(fs.existsSync(commandDir)).toBe(true);
      const installedFiles = fs
        .readdirSync(commandDir)
        .filter((f) => f.endsWith(".md"))
        .sort();

      expect(installedFiles).toEqual([...EXPECTED_COMMANDS].sort());
    });

    it("(3b) each command file has non-empty content", () => {
      for (const file of EXPECTED_COMMANDS) {
        const content = fs.readFileSync(path.join(commandDir, file), "utf8");
        expect(content.trim().length).toBeGreaterThan(0);
      }
    });

    it("(4) LEAKAGE — no forbidden basenames were written under temp HOME", () => {
      const allFiles = walkFiles(tmpHome);
      for (const forbidden of FORBIDDEN_BASENAMES) {
        const leaked = allFiles.filter(
          (f) => path.basename(f) === forbidden,
        );
        expect(leaked, `leaked forbidden file: ${forbidden}`).toEqual([]);
      }
    });

    it("(4b) LEAKAGE — no .atl/ segment in any written path", () => {
      const allFiles = walkFiles(tmpHome);
      for (const file of allFiles) {
        const segments = file.split(path.sep).filter(Boolean);
        for (const seg of FORBIDDEN_SEGMENTS) {
          expect(
            segments,
            `path "${file}" contains forbidden segment "${seg}"`,
          ).not.toContain(seg);
        }
      }
    });

    it("(4c) LEAKAGE — no template file written (OpenCode is product surface only)", () => {
      // No CLAUDE.md, GEMINI.md, or similar personal harness files
      const allFiles = walkFiles(tmpHome);
      const templateLike = allFiles.filter(
        (f) =>
          f.endsWith("CLAUDE.md") ||
          f.endsWith("GEMINI.md") ||
          f.endsWith(".jsonc"),
      );
      expect(templateLike).toEqual([]);
    });
  });

  // ── Remove assertions ──────────────────────────────────────────────────────

  describe("remove path", () => {
    beforeEach(() => {
      // Install first, then seed a non-kanon file in commands/ to verify preservation
      const opencode = getToolByName("opencode")!;
      const entry = buildTestEntry("https://api.kanon.test", "test-key-abc123");

      mergeConfig(configPath, opencode.rootKey, entry);
      installSkills(skillDir, REAL_ASSETS_DIR);
      installCommands(commandDir, REAL_ASSETS_DIR);

      // Seed a non-kanon file that MUST be preserved after remove
      fs.writeFileSync(path.join(commandDir, "other.md"), "# other command\nNot ours.");
    });

    it("(5a) removeConfig removes the kanon entry from opencode.json", () => {
      const opencode = getToolByName("opencode")!;
      const removed = removeConfig(configPath, opencode.rootKey);

      expect(removed).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const mcp = config["mcp"] as Record<string, unknown> | undefined;
      // mcp section may remain but kanon key must be gone
      if (mcp) {
        expect(mcp).not.toHaveProperty("kanon");
      }
    });

    it("(5b) removeCommands removes all 3 kanon command files", () => {
      removeCommands(commandDir);

      for (const file of EXPECTED_COMMANDS) {
        expect(
          fs.existsSync(path.join(commandDir, file)),
          `expected ${file} to be removed`,
        ).toBe(false);
      }
    });

    it("(5c) removeCommands PRESERVES the seeded non-kanon other.md file", () => {
      removeCommands(commandDir);

      expect(fs.existsSync(path.join(commandDir, "other.md"))).toBe(true);
    });

    it("(5d) removeSkills removes all 3 product skill directories", () => {
      removeSkills(skillDir);

      for (const skill of PRODUCT_SKILLS) {
        expect(
          fs.existsSync(path.join(skillDir, skill)),
          `expected ${skill}/ to be removed`,
        ).toBe(false);
      }
    });

    it("(5e) remove sequence is idempotent — second remove does not throw", () => {
      const opencode = getToolByName("opencode")!;
      removeConfig(configPath, opencode.rootKey);
      removeCommands(commandDir);
      removeSkills(skillDir);

      // Second pass — should all be safe no-ops
      expect(() => removeConfig(configPath, opencode.rootKey)).not.toThrow();
      expect(() => removeCommands(commandDir)).not.toThrow();
      expect(() => removeSkills(skillDir)).not.toThrow();
    });
  });
});
