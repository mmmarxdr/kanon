import fs from "node:fs";

/**
 * Single-sourced package version (KAN-19).
 * Resolves ../package.json from both src/ (vitest) and dist/ (runtime) —
 * both sit one level below the package root.
 */
const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

export const MCP_VERSION: string = pkg.version;
