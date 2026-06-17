/**
 * Codex CLI install smoke test — KAN-128.
 *
 * Composed primitives (NOT run()) — mirrors opencode-install-smoke.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

import { getToolByName } from "../registry.js";
import {
  mergeTomlMcpConfig,
  removeTomlMcpConfig,
  formatCodexMcpEntry,
  buildWrapperMcpEntry,
} from "../mcp-config.js";
import { installSkills, removeSkills, PRODUCT_SKILLS } from "../skills.js";
import type { PlatformContext } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_ASSETS_DIR = path.resolve(__dirname, "../../assets");

const FORBIDDEN_BASENAMES = ["AGENTS.md"];
const FORBIDDEN_SEGMENTS = [".atl"];

/** Hermetic — do not call resolveWrapperPath() (needs install.sh layout on disk). */
const FAKE_WRAPPER = {
  mode: "local" as const,
  path: "/fake/kanon-mcp/wrapper-cli.js",
};

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

describe("codex install smoke — KAN-128", () => {
  let tmpHome: string;
  let codexHome: string;
  let ctx: PlatformContext;
  let configPath: string;
  let skillDir: string;
  let prevCodexHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-codex-smoke-"));
    codexHome = path.join(tmpHome, "codex-home");
    prevCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;

    ctx = { platform: "linux", homedir: tmpHome };

    const codex = getToolByName("codex");
    if (!codex) throw new Error("codex registry entry missing");
    const paths = codex.platforms.linux;
    if (!paths) throw new Error("codex has no linux platform entry");

    configPath = paths.config(ctx);
    skillDir = paths.skills(ctx);
  });

  afterEach(() => {
    if (prevCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = prevCodexHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function runInstall() {
    const entry = buildWrapperMcpEntry(
      "https://api.kanon.test",
      "direct",
      process.execPath,
      FAKE_WRAPPER,
    );
    mergeTomlMcpConfig(configPath, "kanon-mcp", formatCodexMcpEntry(entry));
    installSkills(skillDir, REAL_ASSETS_DIR);
  }

  describe("install path", () => {
    beforeEach(() => {
      fs.mkdirSync(codexHome, { recursive: true });
      fs.writeFileSync(
        configPath,
        `
[mcp_servers.other]
command = "other"
args = ["run"]
`,
      );
      runInstall();
    });

    it("writes config.toml under CODEX_HOME", () => {
      expect(fs.existsSync(configPath)).toBe(true);
      expect(configPath.startsWith(codexHome)).toBe(true);
    });

    it("contains mcp_servers.kanon-mcp with command and args", () => {
      const config = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = config["mcp_servers"] as Record<string, unknown>;
      expect(servers["kanon-mcp"]).toBeDefined();

      const entry = servers["kanon-mcp"] as {
        command?: string;
        args?: string[];
      };
      expect(typeof entry.command).toBe("string");
      expect(Array.isArray(entry.args)).toBe(true);
      expect(entry.args!.length).toBeGreaterThan(0);
    });

    it("preserves unrelated mcp_servers entries", () => {
      const config = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = config["mcp_servers"] as Record<string, unknown>;
      expect(servers["other"]).toEqual({ command: "other", args: ["run"] });
    });

    it("installs all 3 product skills under CODEX_HOME/skills", () => {
      for (const skill of PRODUCT_SKILLS) {
        expect(
          fs.existsSync(path.join(skillDir, skill, "SKILL.md")),
          `expected ${skill}/SKILL.md`,
        ).toBe(true);
      }
      expect(skillDir.startsWith(codexHome)).toBe(true);
    });

    it("LEAKAGE — no AGENTS.md written under CODEX_HOME", () => {
      const allFiles = walkFiles(codexHome);
      for (const forbidden of FORBIDDEN_BASENAMES) {
        const leaked = allFiles.filter((f) => path.basename(f) === forbidden);
        expect(leaked, `leaked ${forbidden}`).toEqual([]);
      }
    });

    it("LEAKAGE — no .atl/ segment in written paths", () => {
      const allFiles = walkFiles(codexHome);
      for (const file of allFiles) {
        const segments = file.split(path.sep).filter(Boolean);
        for (const seg of FORBIDDEN_SEGMENTS) {
          expect(segments, `path ${file}`).not.toContain(seg);
        }
      }
    });
  });

  describe("idempotent install and remove", () => {
    it("re-run leaves exactly one kanon-mcp entry", () => {
      runInstall();
      runInstall();

      const config = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = config["mcp_servers"] as Record<string, unknown>;
      expect(Object.keys(servers).filter((k) => k === "kanon-mcp")).toHaveLength(1);
    });

    it("remove cleans MCP + skills; second remove is a no-op", () => {
      runInstall();

      expect(removeTomlMcpConfig(configPath, "kanon-mcp")).toBe(true);
      removeSkills(skillDir);

      const config = parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
      const servers = config["mcp_servers"] as Record<string, unknown> | undefined;
      if (servers) {
        expect(servers["kanon-mcp"]).toBeUndefined();
      }

      for (const skill of PRODUCT_SKILLS) {
        expect(fs.existsSync(path.join(skillDir, skill))).toBe(false);
      }

      expect(removeTomlMcpConfig(configPath, "kanon-mcp")).toBe(false);
      expect(() => removeSkills(skillDir)).not.toThrow();
    });
  });
});
