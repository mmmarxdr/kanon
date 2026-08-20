import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../../..");
const files = [
  "packages/api/prisma/migrations/20260820140000_privacy_authority/migration.sql",
  "packages/api/src/modules/integrations/privacy-hold/privacy-authority.ts",
];

describe("KAN-246 PR2 scope", () => {
  it("contains authority/RLS only, not replay, cache, or historical repair work", () => {
    const changed = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n").toLowerCase();
    for (const excluded of ["event-bus", "workspace-event", "mcp replay", "historical journal", "populated-project"]) {
      expect(changed).not.toContain(excluded);
    }
  });
});
