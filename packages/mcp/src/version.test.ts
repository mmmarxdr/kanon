import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MCP_VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("MCP version single-sourcing (KAN-19)", () => {
  it("V1: MCP_VERSION matches package.json version", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
    ) as { version: string };
    expect(MCP_VERSION).toBe(pkg.version);
    expect(MCP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("V2: index.ts wires MCP_VERSION and carries no hardcoded version literal", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    expect(src).toContain("version: MCP_VERSION");
    // The drift class this kills: a semver literal next to the server identity or banner.
    expect(src).not.toMatch(/Kanon MCP v\d/);
    expect(src).not.toMatch(/version:\s*"\d+\.\d+\.\d+"/);
  });

  it("V3: banner tool count is derived, not a hand-maintained literal", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    expect(src).not.toMatch(/\d+ tools registered/);
  });
});
