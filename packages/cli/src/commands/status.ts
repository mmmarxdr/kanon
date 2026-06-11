// ─── kanon status ───────────────────────────────────────────────────────────

import type { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "../config.js";
import { KanonClient, KanonApiError, type KanonIssue } from "../kanon-client.js";

/**
 * Register the `kanon status` command.
 *
 * Shows project health: Kanon issue counts.
 *
 * Options:
 *   --project <KEY>      Kanon project key (required)
 *   --kanon-url <url>    Override KANON_API_URL
 */
export function statusCommand(program: Command): void {
  program
    .command("status")
    .description("Show project status from Kanon")
    .requiredOption("--project <KEY>", "Kanon project key")
    .option("--kanon-url <url>", "Kanon API URL")
    .action(async (opts: StatusOptions) => {
      try {
        await runStatus(opts);
      } catch (err) {
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    });
}

interface StatusOptions {
  project: string;
  kanonUrl?: string;
}

async function runStatus(opts: StatusOptions): Promise<void> {
  const config = loadConfig({
    kanonApiUrl: opts.kanonUrl,
  });

  // ─── Kanon data ───────────────────────────────────────────────────────

  const kanon = new KanonClient({
    baseUrl: config.kanonApiUrl,
    apiKey: config.kanonApiKey,
  });

  let project;
  try {
    project = await kanon.getProject(opts.project);
  } catch (err) {
    if (err instanceof KanonApiError && err.statusCode === 404) {
      console.error(chalk.red(`Project ${opts.project} not found in Kanon.`));
      process.exit(1);
    }
    throw err;
  }

  let issues: KanonIssue[] = [];
  try {
    issues = await kanon.listIssues(opts.project);
  } catch {
    console.warn(chalk.yellow("Warning: Could not fetch issues from Kanon."));
  }

  // ─── Header ───────────────────────────────────────────────────────────

  console.log("");
  console.log(
    chalk.bold(`Project: ${project.name}`) +
      chalk.dim(` (${project.key})`),
  );
  console.log("");

  // ─── Kanon Issues Table ───────────────────────────────────────────────

  console.log(chalk.bold.underline("Kanon Issues"));
  console.log("");

  if (issues.length === 0) {
    console.log(chalk.dim("  No issues found."));
  } else {
    const stateCounts = countBy(issues, (i) => i.state);
    const typeCounts = countBy(issues, (i) => i.type);

    // State breakdown
    const stateOrder = [
      "backlog",
      "explore",
      "propose",
      "design",
      "spec",
      "tasks",
      "apply",
      "verify",
      "archived",
    ];
    console.log(chalk.dim("  State breakdown:"));
    for (const state of stateOrder) {
      const count = stateCounts[state] ?? 0;
      if (count > 0) {
        const bar = renderBar(count, issues.length);
        console.log(
          `  ${padRight(state, 12)} ${bar} ${count}`,
        );
      }
    }
    console.log("");

    // Type breakdown
    console.log(chalk.dim("  Type breakdown:"));
    for (const [type, count] of Object.entries(typeCounts)) {
      console.log(`  ${padRight(type, 12)} ${count}`);
    }
    console.log("");
    console.log(`  ${chalk.bold("Total:")} ${issues.length} issue(s)`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function padRight(str: string, len: number): string {
  // Strip ANSI for length calculation
  const stripped = str.replace(/\u001b\[[0-9;]*m/g, "");
  if (stripped.length >= len) return str;
  return str + " ".repeat(len - stripped.length);
}

function renderBar(count: number, total: number): string {
  const maxWidth = 16;
  const filled = Math.round((count / total) * maxWidth);
  return chalk.cyan("\u2588".repeat(filled)) + chalk.dim("\u2591".repeat(maxWidth - filled));
}
