import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("privacy authority boundary", () => {
  it("keeps the operator client and capabilities private while using serializable transactions", () => {
    const source = read("packages/api/src/modules/integrations/privacy-hold/privacy-authority.ts");
    expect(source).toContain("isolationLevel: \"Serializable\"");
    expect(source).not.toMatch(/export\s+(?:const|function|class)\s+.*(?:client|capability|evidence)/i);
    expect(source).toContain("prepare_containment");
    expect(source).toContain("release_issue");
  });
});

it("admits only an authenticated private tombstone through the typed authority", () => {
  const source = read("packages/api/src/modules/integrations/privacy-hold/privacy-authority.ts");
  expect(source).toContain("containAuthenticatedPrivateTombstone");
  expect(source).toContain("record_private_tombstone");
});
