// ─── kanon-binding — walk-up resolver + Zod schema tests ─────────────────────
//
// Tests for:
//   parseKanonConfig — Zod-based schema validator
//   findKanonConfig  — fs-injected walk-up resolver (stops at .git boundary)
//   writeKanonConfig — pure writer fn (serialises binding to JSON string)

import { describe, it, expect } from "vitest";
import {
  parseKanonConfig,
  findKanonConfig,
  writeKanonConfig,
} from "./kanon-binding.js";

// ─── parseKanonConfig ────────────────────────────────────────────────────────

describe("parseKanonConfig", () => {
  it("accepts a valid binding with all three fields", () => {
    const raw = JSON.stringify({
      projectKey: "KAN",
      workspaceId: "ws_abc",
      apiUrl: "https://api.example.com",
    });
    const result = parseKanonConfig(raw);
    expect(result).toEqual({
      projectKey: "KAN",
      workspaceId: "ws_abc",
      apiUrl: "https://api.example.com",
    });
  });

  it("rejects a file missing projectKey", () => {
    const raw = JSON.stringify({ workspaceId: "ws_abc", apiUrl: "https://api.example.com" });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects a file missing workspaceId", () => {
    const raw = JSON.stringify({ projectKey: "KAN", apiUrl: "https://api.example.com" });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects a file missing apiUrl", () => {
    const raw = JSON.stringify({ projectKey: "KAN", workspaceId: "ws_abc" });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects an empty-string projectKey", () => {
    const raw = JSON.stringify({ projectKey: "", workspaceId: "ws_abc", apiUrl: "https://api.example.com" });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects an empty-string workspaceId", () => {
    const raw = JSON.stringify({ projectKey: "KAN", workspaceId: "", apiUrl: "https://api.example.com" });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects an empty-string apiUrl", () => {
    const raw = JSON.stringify({ projectKey: "KAN", workspaceId: "ws_abc", apiUrl: "" });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects extra/engram fields (strict mode)", () => {
    const raw = JSON.stringify({
      projectKey: "KAN",
      workspaceId: "ws_abc",
      apiUrl: "https://api.example.com",
      engramNamespace: "kanon",
    });
    expect(() => parseKanonConfig(raw)).toThrow();
  });

  it("rejects non-JSON content", () => {
    expect(() => parseKanonConfig("not-json")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => parseKanonConfig("")).toThrow();
  });

  it("rejects a JSON null", () => {
    expect(() => parseKanonConfig("null")).toThrow();
  });

  it("returns a typed KanonBinding — shape matches interface", () => {
    const raw = JSON.stringify({
      projectKey: "PROJ",
      workspaceId: "ws_xyz",
      apiUrl: "http://localhost:3000",
    });
    const result = parseKanonConfig(raw);
    expect(result.projectKey).toBe("PROJ");
    expect(result.workspaceId).toBe("ws_xyz");
    expect(result.apiUrl).toBe("http://localhost:3000");
  });
});

// ─── findKanonConfig ─────────────────────────────────────────────────────────

/**
 * Build a minimal fake filesystem. The vfs is a flat map of absolute paths
 * to their content. Directories are implicit (we only need existsSync + readFileSync).
 */
function makeFakeFs(vfs: Record<string, string>) {
  return {
    existsSync: (p: string) => Object.prototype.hasOwnProperty.call(vfs, p),
    readFileSync: (p: string) => {
      if (!Object.prototype.hasOwnProperty.call(vfs, p)) {
        throw new Error(`ENOENT: no such file: ${p}`);
      }
      return vfs[p] as string;
    },
  };
}

const validBinding = JSON.stringify({
  projectKey: "KAN",
  workspaceId: "ws_abc",
  apiUrl: "https://api.example.com",
});

describe("findKanonConfig", () => {
  it("returns binding when .kanon is in the start directory", () => {
    const fs = makeFakeFs({ "/repo/.kanon": validBinding });
    const result = findKanonConfig("/repo", fs);
    expect(result).not.toBeNull();
    expect(result?.projectKey).toBe("KAN");
  });

  it("returns binding from an ancestor directory (walk-up)", () => {
    const fs = makeFakeFs({ "/repo/.kanon": validBinding });
    const result = findKanonConfig("/repo/packages/mcp/src", fs);
    expect(result).not.toBeNull();
    expect(result?.projectKey).toBe("KAN");
  });

  it("returns null when no .kanon exists anywhere", () => {
    const fs = makeFakeFs({});
    const result = findKanonConfig("/repo/src/utils", fs);
    expect(result).toBeNull();
  });

  it("returns null when .kanon is only above the .git boundary", () => {
    // .kanon sits ABOVE the .git dir — must NOT be found
    const fs = makeFakeFs({
      "/home/user/.kanon": validBinding,
      "/home/user/repo/.git": "placeholder",
    });
    const result = findKanonConfig("/home/user/repo/src", fs);
    expect(result).toBeNull();
  });

  it("returns binding when .kanon is at the same level as .git", () => {
    // .kanon and .git are siblings — the repo root itself has .kanon
    const fs = makeFakeFs({
      "/repo/.kanon": validBinding,
      "/repo/.git": "placeholder",
    });
    const result = findKanonConfig("/repo/src", fs);
    expect(result).not.toBeNull();
    expect(result?.projectKey).toBe("KAN");
  });

  it("prefers the nearest (deepest) .kanon when multiple exist", () => {
    const innerBinding = JSON.stringify({
      projectKey: "INNER",
      workspaceId: "ws_inner",
      apiUrl: "https://inner.example.com",
    });
    const fs = makeFakeFs({
      "/repo/.kanon": validBinding,
      "/repo/packages/.kanon": innerBinding,
    });
    const result = findKanonConfig("/repo/packages/mcp", fs);
    expect(result?.projectKey).toBe("INNER");
  });

  it("returns null and does not throw on malformed .kanon", () => {
    const fs = makeFakeFs({ "/repo/.kanon": "{ bad json " });
    // The resolver should surface malformed content as an error, not swallow it.
    // Spec says clear, actionable errors — so we expect throw on bad content.
    expect(() => findKanonConfig("/repo/src", fs)).toThrow();
  });

  it("stops walking after reaching a .git dir and finding no .kanon up to that point", () => {
    const fs = makeFakeFs({
      "/repo/.git": "placeholder",
      // no .kanon anywhere
    });
    const result = findKanonConfig("/repo/src/utils", fs);
    expect(result).toBeNull();
  });

  it("handles start dir that is the repo root with both .git and .kanon", () => {
    const fs = makeFakeFs({
      "/repo/.kanon": validBinding,
      "/repo/.git": "placeholder",
    });
    const result = findKanonConfig("/repo", fs);
    expect(result).not.toBeNull();
    expect(result?.projectKey).toBe("KAN");
  });
});

// ─── writeKanonConfig ────────────────────────────────────────────────────────

describe("writeKanonConfig", () => {
  it("serialises a binding to a formatted JSON string", () => {
    const binding = {
      projectKey: "KAN",
      workspaceId: "ws_abc",
      apiUrl: "https://api.example.com",
    };
    const output = writeKanonConfig(binding);
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed["projectKey"]).toBe("KAN");
    expect(parsed["workspaceId"]).toBe("ws_abc");
    expect(parsed["apiUrl"]).toBe("https://api.example.com");
  });

  it("round-trips: writeKanonConfig output can be parsed back by parseKanonConfig", () => {
    const original = {
      projectKey: "KAN",
      workspaceId: "ws_abc",
      apiUrl: "https://api.example.com",
    };
    const json = writeKanonConfig(original);
    const reparsed = parseKanonConfig(json);
    expect(reparsed).toEqual(original);
  });

  it("does NOT include extra fields beyond the three canonical ones", () => {
    const binding = {
      projectKey: "KAN",
      workspaceId: "ws_abc",
      apiUrl: "https://api.example.com",
    };
    const output = writeKanonConfig(binding);
    const keys = Object.keys(JSON.parse(output) as object);
    expect(keys).toHaveLength(3);
    expect(keys).toContain("projectKey");
    expect(keys).toContain("workspaceId");
    expect(keys).toContain("apiUrl");
  });
});
