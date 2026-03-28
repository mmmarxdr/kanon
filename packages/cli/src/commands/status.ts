// ─── kanon status ───────────────────────────────────────────────────────────

import type { Command } from "commander";
import chalk from "chalk";
import { EngramClient, SddParser } from "@kanon/bridge";
import { loadConfig } from "../config.js";
import { KanonClient, KanonApiError, type KanonIssue } from "../kanon-client.js";

/**
 * Register the `kanon status` command.
 *
 * Shows combined project health: Kanon issue counts and Engram SDD status.
 *
 * Options:
 *   --project <KEY>      Kanon project key (required)
 *   --engram-url <url>   Override ENGRAM_URL
 *   --kanon-url <url>    Override KANON_API_URL
 */
export function statusCommand(program: Command): void {
  program
    .command("status")
    .description("Show combined project status from Kanon and Engram")
    .requiredOption("--project <KEY>", "Kanon project key")
    .option("--engram-url <url>", "Engram API URL")
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
  engramUrl?: string;
  kanonUrl?: string;
}

async function runStatus(opts: StatusOptions): Promise<void> {
  const config = loadConfig({
    engramUrl: opts.engramUrl,
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
  if (project.engramNamespace) {
    console.log(
      chalk.dim(`Engram namespace: ${project.engramNamespace}`),
    );
  }
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

  // ─── Engram SDD data ─────────────────────────────────────────────────

  console.log("");
  console.log(chalk.bold.underline("Engram SDD Artifacts"));
  console.log("");

  const namespace = project.engramNamespace;
  if (!namespace) {
    console.log(
      chalk.dim(
        "  No Engram namespace linked. Use `kanon register` to link one.",
      ),
    );
    return;
  }

  const engram = new EngramClient({ baseUrl: config.engramUrl });
  const connectivity = await engram.checkConnectivity();

  if (!connectivity.ok) {
    console.log(
      chalk.yellow(
        `  Engram unavailable at ${config.engramUrl} -- showing Kanon data only`,
      ),
    );
    return;
  }

  let observations;
  try {
    observations = await engram.search("sdd/", {
      project: namespace,
      limit: 100,
    });
  } catch {
    console.log(chalk.yellow("  Could not fetch SDD artifacts from Engram."));
    return;
  }

  if (observations.length === 0) {
    console.log(chalk.dim("  No SDD artifacts found."));
    return;
  }

  const changes = SddParser.groupByChange(observations);

  // SDD Changes table
  const colName = 28;
  const colPhase = 18;
  const colTasks = 14;
  const colStatus = 12;

  const header =
    padRight("Change", colName) +
    padRight("Latest Phase", colPhase) +
    padRight("Tasks", colTasks) +
    padRight("Status", colStatus);

  console.log(chalk.dim(`  ${header}`));
  console.log(chalk.dim(`  ${"─".repeat(colName + colPhase + colTasks + colStatus)}`));

  let inProgress = 0;
  let archived = 0;

  for (const change of changes) {
    const isArchived = change.latestPhase === "archive-report";
    if (isArchived) archived++;
    else inProgress++;

    const doneTasks = change.tasks.filter((t) => t.done).length;
    const totalTasks = change.tasks.length;
    const taskStr =
      totalTasks > 0 ? `${doneTasks}/${totalTasks}` : chalk.dim("n/a");
    const pct =
      totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const statusStr = isArchived
      ? chalk.green("archived")
      : chalk.cyan("in-progress");

    const pctStr =
      totalTasks > 0
        ? ` (${pct}%)`
        : "";

    console.log(
      `  ${padRight(truncate(change.name, colName - 2), colName)}${padRight(change.latestPhase, colPhase)}${padRight(taskStr + pctStr, colTasks)}${statusStr}`,
    );
  }

  console.log("");
  console.log(
    `  ${chalk.bold("Summary:")} ${changes.length} change(s) — ${inProgress} in-progress, ${archived} archived`,
  );
  console.log(
    chalk.dim(`  ${observations.length} total Engram observation(s)`),
  );
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

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

function renderBar(count: number, total: number): string {
  const maxWidth = 16;
  const filled = Math.round((count / total) * maxWidth);
  return chalk.cyan("\u2588".repeat(filled)) + chalk.dim("\u2591".repeat(maxWidth - filled));
}
