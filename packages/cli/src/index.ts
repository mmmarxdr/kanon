#!/usr/bin/env node
// ─── Kanon CLI ──────────────────────────────────────────────────────────────

import { Command } from "commander";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("kanon")
  .version("0.0.1")
  .description("Kanon CLI — project management tool");

// Global options available on all commands
program
  .option("--kanon-url <url>", "Kanon API URL (default: $KANON_API_URL or http://localhost:3000)");

// Register subcommands
statusCommand(program);

program.parse(process.argv);
