import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Resolve relative to the package root (packages/web).
// Process cwd in vitest is the package root; use an absolute path from there.
const issuePagePath = path.resolve(
  "src/routes/_authenticated/issue-page.tsx",
);
const src = readFileSync(issuePagePath, "utf8");

it("issue-page.tsx stays within the 300-line monolith ceiling (KAN-59/KAN-108)", () => {
  expect(src.split("\n").length).toBeLessThanOrEqual(300);
});
