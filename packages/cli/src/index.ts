#!/usr/bin/env node
// ─── Kanon CLI ──────────────────────────────────────────────────────────────

import { Command } from "commander";
import { registerCommand } from "./commands/register.js";
import { recoverCommand } from "./commands/recover.js";
import { statusCommand } from "./commands/status.js";
import { exportCommand } from "./commands/export.js";
import { importCommand } from "./commands/import.js";
import { syncCommand } from "./commands/sync.js";

const program = new Command();

program
  .name("kanon")
  .version("0.0.1")
  .description(
    "Kanon CLI — bridge between Engram persistent memory and Kanon project management",
  );

// Global options available on all commands
program
  .option("--engram-url <url>", "Engram API URL (default: $ENGRAM_URL or http://localhost:7437)")
  .option("--kanon-url <url>", "Kanon API URL (default: $KANON_API_URL or http://localhost:3000)");

// Register subcommands
registerCommand(program);
recoverCommand(program);
statusCommand(program);
exportCommand(program);
importCommand(program);
syncCommand(program);

program.parse(process.argv);
