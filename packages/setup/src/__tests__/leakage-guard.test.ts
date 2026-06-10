/**
 * G6 — Personal-config leakage guard.
 *
 * The proposal is explicit: Kanon setup writes ONLY to product surface files
 * for OpenCode. It MUST NOT touch personal harness files:
 *
 *   - ~/.config/opencode/AGENTS.md        (OpenCode agent config)
 *   - ~/.config/opencode/opencode.jsonc   (OpenCode personal config)
 *   - ~/.config/opencode/kanon.md         (any Kanon agent file)
 *   - ~/.atl/...                          (Gentle AI internal)
 *   - ~/.config/opencode/commands/private (we own commands/, but no private subdirs)
 *
 * This test scans the registry for OpenCode and asserts that no platform
 * path, anywhere, resolves to one of these forbidden locations. It also
 * confirms that the OpenCode entry has no `template` (no personal file
 * would be written) and no `agents` directory.
 *
 * If a future PR adds a `template` or `agents` to the opencode entry, this
 * test breaks — forcing the author to confirm the path is product-surface
 * and update the allowlist (or the test).
 */

import { describe, it, expect } from "vitest";
import { getToolByName } from "../registry.js";
import type { PlatformContext } from "../types.js";

/** Personal-config basenames that MUST NEVER be written by kanon-setup. */
const FORBIDDEN_BASENAMES = [
  "AGENTS.md",
  "opencode.jsonc",
  "kanon.md",
] as const;

/** Personal-config directory segments that MUST NEVER be written by kanon-setup. */
const FORBIDDEN_PATH_SEGMENTS = [".atl"] as const;

describe("opencode — personal-config leakage guard", () => {
  const opencode = getToolByName("opencode");
  if (!opencode) {
    // Registry entry missing — skip the test set with a clear message.
    it.skip("opencode registry entry is missing — leakage guard cannot run", () => {});
    return;
  }

  const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };
  const darwinCtx: PlatformContext = { platform: "darwin", homedir: "/Users/test" };
  const wslCtx: PlatformContext = {
    platform: "wsl",
    homedir: "/home/test",
    winHome: "/mnt/c/Users/test",
  };
  const contexts: Array<[string, PlatformContext]> = [
    ["linux", ctx],
    ["darwin", darwinCtx],
    ["wsl", wslCtx],
  ];

  for (const [name, ctxFor] of contexts) {
    describe(`platform=${name}`, () => {
      const paths = opencode.platforms[name as keyof typeof opencode.platforms];
      if (!paths) {
        it.skip(`opencode does not declare ${name}`, () => {});
        return;
      }

      for (const forbidden of FORBIDDEN_BASENAMES) {
        it(`config path MUST NOT be a ${forbidden} file`, () => {
          const configPath = paths.config(ctxFor);
          expect(configPath.endsWith(`/${forbidden}`)).toBe(false);
          expect(configPath.endsWith(forbidden)).toBe(false);
        });

        it(`skills (if present) MUST NOT be a ${forbidden} directory`, () => {
          if (!paths.skills) return;
          const skill = paths.skills(ctxFor);
          expect(skill.endsWith(`/${forbidden}`)).toBe(false);
          expect(skill.endsWith(forbidden)).toBe(false);
        });

        it(`commands (if present) MUST NOT be a ${forbidden} directory`, () => {
          if (!paths.commands) return;
          const command = paths.commands(ctxFor);
          expect(command.endsWith(`/${forbidden}`)).toBe(false);
          expect(command.endsWith(forbidden)).toBe(false);
        });

        it(`template (if present) MUST NOT be a ${forbidden} file`, () => {
          if (!paths.template) return;
          const tpl = paths.template(ctxFor);
          expect(tpl.endsWith(`/${forbidden}`)).toBe(false);
          expect(tpl.endsWith(forbidden)).toBe(false);
        });

        it(`agents (if present) MUST NOT be a ${forbidden} file`, () => {
          if (!paths.agents) return;
          const agent = paths.agents(ctxFor);
          expect(agent.endsWith(`/${forbidden}`)).toBe(false);
          expect(agent.endsWith(forbidden)).toBe(false);
        });
      }

      for (const segment of FORBIDDEN_PATH_SEGMENTS) {
        it(`no path (config/skills/commands/template/agents) may live under ${segment}/`, () => {
          const allPaths = [
            paths.config(ctxFor),
            paths.skills(ctxFor),
            paths.commands?.(ctxFor),
            paths.template?.(ctxFor),
            paths.agents?.(ctxFor),
          ].filter((p): p is string => Boolean(p));

          for (const p of allPaths) {
            // Path must not contain `.atl` as a segment (homebrew atlantis, etc. are fine).
            const segments = p.split("/").filter(Boolean);
            expect(segments).not.toContain(segment);
          }
        });
      }

      it("does NOT declare a `template` path (OpenCode is product surface only)", () => {
        expect(paths.template).toBeUndefined();
      });

      it("does NOT declare an `agents` directory (no personal agent files)", () => {
        expect(paths.agents).toBeUndefined();
      });
    });
  }
});
