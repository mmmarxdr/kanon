import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const MIGRATOR_ENTRYPOINT = "prisma";
const MIGRATOR_ARGS = ["migrate", "deploy", "--schema=prisma/schema.prisma"] as const;
type Runner = (command: string, args: readonly string[], options: { readonly stdio: "inherit"; readonly shell: false }) => SpawnSyncReturns<Buffer>;

/** Fixed executable and argv: arbitrary documentation-like paths cannot become commands. */
export function runOneShotMigrator(run: Runner = spawnSync): boolean {
  const result = run(MIGRATOR_ENTRYPOINT, MIGRATOR_ARGS, { stdio: "inherit", shell: false });
  return !result.error && result.status === 0;
}

if (process.argv[1]?.endsWith("one-shot-migrator.js")) {
  if (!runOneShotMigrator()) process.exitCode = 1;
}
