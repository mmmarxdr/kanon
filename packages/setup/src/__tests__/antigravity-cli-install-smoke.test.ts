/**
 * Antigravity CLI install smoke test — KAN-130.
 *
 * Composed primitives (NOT run()) — mirrors opencode-install-smoke.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getToolByName } from "../registry.js";
import {
  mergeConfig,
  removeConfig,
  buildWrapperMcpEntry,
  formatMcpEntry,
} from "../mcp-config.js";
import { installSkills, removeSkills, PRODUCT_SKILLS } from "../skills.js";
import type { PlatformContext } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_ASSETS_DIR = path.resolve(__dirname, "../../assets");

const FORBIDDEN_BASENAMES = ["settings.json", "GEMINI.md", "keybindings.json"];
const FORBIDDEN_SEGMENTS = [".atl"];

/** Hermetic — do not call resolveWrapperPath() (needs install.sh layout on disk). */
const FAKE_WRAPPER = {
  mode: "local" as const,
  path: "/fake/kanon/wrapper-cli.js",
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

describe("antigravity-cli install smoke — KAN-130", () => {
  let tmpHome: string;
  let ctx: PlatformContext;
  let configPath: string;
  let skillDir: string;
  let cliHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "kanon-antigravity-cli-smoke-"),
    );
    ctx = { platform: "linux", homedir: tmpHome };
    cliHome = path.join(tmpHome, ".gemini", "antigravity-cli");

    const tool = getToolByName("antigravity-cli");
    if (!tool) throw new Error("antigravity-cli registry entry missing");
    const paths = tool.platforms.linux;
    if (!paths) throw new Error("antigravity-cli has no linux platform entry");

    configPath = paths.config(ctx);
    skillDir = paths.skills(ctx);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function runInstall() {
    const tool = getToolByName("antigravity-cli")!;
    const entry = buildWrapperMcpEntry(
      "https://api.kanon.test",
      "direct",
      process.execPath,
      FAKE_WRAPPER,
    );
    mergeConfig(configPath, tool.rootKey, entry);
    installSkills(skillDir, REAL_ASSETS_DIR);
  }

  describe("install path", () => {
    beforeEach(() => {
      fs.mkdirSync(cliHome, { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            other: { command: "other", args: ["run"] },
          },
        }),
      );
      runInstall();
    });

    it("writes mcp_config.json under ~/.gemini/antigravity-cli/", () => {
      expect(fs.existsSync(configPath)).toBe(true);
      expect(configPath.startsWith(cliHome)).toBe(true);
    });

    it("contains mcpServers.kanon with object form", () => {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
        string,
        unknown
      >;
      const servers = config["mcpServers"] as Record<string, unknown>;
      expect(servers["kanon"]).toBeDefined();

      const entry = formatMcpEntry(
        "mcpServers",
        buildWrapperMcpEntry(
          "https://api.kanon.test",
          "direct",
          process.execPath,
          FAKE_WRAPPER,
        ),
      ) as { command?: string; args?: string[]; type?: string };

      const onDisk = servers["kanon"] as {
        command?: string;
        args?: string[];
        type?: string;
      };
      expect(onDisk.type).toBeUndefined();
      expect(typeof onDisk.command).toBe("string");
      expect(Array.isArray(onDisk.args)).toBe(true);
      expect(entry.type).toBeUndefined();
    });

    it("preserves unrelated mcpServers entries", () => {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
        string,
        unknown
      >;
      const servers = config["mcpServers"] as Record<string, unknown>;
      expect(servers["other"]).toEqual({ command: "other", args: ["run"] });
    });

    it("installs all 3 product skills under antigravity-cli/skills", () => {
      for (const skill of PRODUCT_SKILLS) {
        expect(
          fs.existsSync(path.join(skillDir, skill, "SKILL.md")),
          `expected ${skill}/SKILL.md`,
        ).toBe(true);
      }
      expect(skillDir).toContain("antigravity-cli/skills");
      expect(skillDir).not.toContain("antigravity/skills");
    });

    it("LEAKAGE — no settings.json, GEMINI.md, or keybindings.json written", () => {
      const allFiles = walkFiles(tmpHome);
      for (const forbidden of FORBIDDEN_BASENAMES) {
        const leaked = allFiles.filter((f) => path.basename(f) === forbidden);
        expect(leaked, `leaked ${forbidden}`).toEqual([]);
      }
    });

    it("LEAKAGE — no .atl/ segment in written paths", () => {
      const allFiles = walkFiles(tmpHome);
      for (const file of allFiles) {
        const segments = file.split(path.sep).filter(Boolean);
        for (const seg of FORBIDDEN_SEGMENTS) {
          expect(segments, `path ${file}`).not.toContain(seg);
        }
      }
    });
  });

  describe("idempotent install and remove", () => {
    it("re-run leaves exactly one kanon entry", () => {
      runInstall();
      runInstall();

      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
        string,
        unknown
      >;
      const servers = config["mcpServers"] as Record<string, unknown>;
      expect(Object.keys(servers).filter((k) => k === "kanon")).toHaveLength(
        1,
      );
    });

    it("remove cleans MCP + skills; second remove is a no-op", () => {
      fs.mkdirSync(cliHome, { recursive: true });
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            other: { command: "other", args: ["run"] },
          },
        }),
      );
      runInstall();

      const tool = getToolByName("antigravity-cli")!;
      expect(removeConfig(configPath, tool.rootKey)).toBe(true);
      removeSkills(skillDir);

      const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
        string,
        unknown
      >;
      const servers = config["mcpServers"] as Record<string, unknown> | undefined;
      if (servers) {
        expect(servers["kanon"]).toBeUndefined();
        expect(servers["other"]).toEqual({ command: "other", args: ["run"] });
      }

      for (const skill of PRODUCT_SKILLS) {
        expect(fs.existsSync(path.join(skillDir, skill))).toBe(false);
      }

      expect(removeConfig(configPath, tool.rootKey)).toBe(false);
      expect(() => removeSkills(skillDir)).not.toThrow();
    });
  });
});
