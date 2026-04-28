#!/usr/bin/env node
import { runWrapper } from "./wrapper.js";

runWrapper().catch((err: unknown) => {
  process.stderr.write(
    `kanon-mcp-wrapper: unexpected error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
