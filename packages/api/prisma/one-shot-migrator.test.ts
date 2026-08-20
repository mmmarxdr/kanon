import { describe, expect, it } from "vitest";
import { runOneShotMigrator } from "../scripts/one-shot-migrator.js";

describe("one-shot privacy migrator", () => {
  it.each(["requirements.txt", "CMakeLists.txt", "README.sh", "guide.mdx"])("never executes %s", (untrusted) => {
    const calls: string[][] = [];
    const result = runOneShotMigrator(((command, args) => {
      calls.push([command, ...args]);
      return { status: 1, error: new Error(untrusted) };
    }) as never);
    expect(result).toBe(false);
    expect(calls).toEqual([["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"]]);
  });
  it("uses the sole packaged prisma entrypoint", () => {
    expect(runOneShotMigrator((() => ({ status: 0 })) as never)).toBe(true);
  });
});
