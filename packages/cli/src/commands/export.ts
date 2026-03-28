// ─── kanon export ──────────────────────────────────────────────────────────

import type { Command } from "commander";
import chalk from "chalk";
import {
  EngramClient,
  SyncEngine,
  type SyncResult,
  type ConflictStrategy,
  type SyncableIssue,
} from "@kanon/bridge";
import { loadConfig } from "../config.js";
import { KanonClient, KanonApiError, type KanonIssue } from "../kanon-client.js";

/**
 * Register the `kanon export` command.
 *
 * Exports Kanon issues to Engram observations via bidirectional SyncEngine.
 *
 * Options:
 *   --project <KEY>      Kanon project key (required)
 *   --namespace <ns>     Override Engram namespace (default: project's linked namespace)
 *   --dry-run            Preview changes without applying
 */
export function exportCommand(program: Command): void {
  program
    .command("export")
    .description("Export Kanon issues to Engram observations")
    .requiredOption("--project <KEY>", "Kanon project key")
    .option("--namespace <ns>", "Engram namespace (overrides project setting)")
    .option("--engram-url <url>", "Engram API URL")
    .option("--kanon-url <url>", "Kanon API URL")
    .option("--filter-state <state>", "Only export issues matching this state")
    .option("--filter-type <type>", "Only export issues matching this type")
    .option("--dry-run", "Preview changes without applying", false)
    .action(async (opts: ExportOptions) => {
      try {
        await runExport(opts);
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

interface ExportOptions {
  project: string;
  namespace?: string;
  engramUrl?: string;
  kanonUrl?: string;
  filterState?: string;
  filterType?: string;
  dryRun: boolean;
}

async function runExport(opts: ExportOptions): Promise<void> {
  const config = loadConfig({
    engramUrl: opts.engramUrl,
    kanonApiUrl: opts.kanonUrl,
  });

  // 1. Look up project to get its engram namespace
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

  const namespace = opts.namespace ?? project.engramNamespace;
  if (!namespace) {
    console.error(
      chalk.red(`Project ${opts.project} has no Engram namespace linked.`),
    );
    console.error(
      chalk.dim(
        "Hint: Run `kanon register --project " +
          opts.project +
          " --namespace <ns>` first, or pass --namespace.",
      ),
    );
    process.exit(1);
  }

  // 2. Fetch issues from Kanon
  console.log(chalk.dim(`Fetching issues from project '${opts.project}'...`));
  let issues = await kanon.listIssues(opts.project);

  // Apply filters
  if (opts.filterState) {
    issues = issues.filter((i) => i.state === opts.filterState);
  }
  if (opts.filterType) {
    issues = issues.filter((i) => i.type === opts.filterType);
  }

  if (issues.length === 0) {
    console.log(chalk.yellow("No issues found in project. Nothing to export."));
    return;
  }

  console.log(chalk.dim(`Found ${issues.length} issue(s).`));

  // 3. Create clients and SyncEngine
  const engram = new EngramClient({ baseUrl: config.engramUrl });

  const connectivity = await engram.checkConnectivity();
  if (!connectivity.ok) {
    console.error(
      chalk.red(`Engram is not reachable at ${config.engramUrl}.`),
    );
    process.exit(1);
  }

  const syncEngine = new SyncEngine(engram, kanon, {
    projectKey: opts.project,
    namespace,
    defaultStrategy: "kanon-wins" as ConflictStrategy,
    onProgress: (current, total, item) => {
      console.log(
        chalk.dim(`  [${current}/${total}] Exporting ${item}...`),
      );
    },
  });

  // 4. Convert KanonIssues to SyncableIssues
  const syncableIssues = issuesToSyncable(issues);

  // 5. Run export
  if (opts.dryRun) {
    console.log(chalk.cyan("\nDry run -- no changes will be made.\n"));
  }

  const result = await syncEngine.exportToEngram(syncableIssues, {
    dryRun: opts.dryRun,
  });

  // 6. Log activity for each successfully exported issue
  if (!opts.dryRun) {
    await logSyncActivity(kanon, result);
  }

  // 7. Print summary
  printSyncSummary(result, "Export", opts.dryRun);
}

/**
 * Convert KanonIssue[] to SyncableIssue[] for the SyncEngine.
 */
function issuesToSyncable(issues: KanonIssue[]): SyncableIssue[] {
  // Build parent→children map
  const childrenMap = new Map<string, KanonIssue[]>();
  for (const issue of issues) {
    if (issue.parentId) {
      const siblings = childrenMap.get(issue.parentId) ?? [];
      siblings.push(issue);
      childrenMap.set(issue.parentId, siblings);
    }
  }

  return issues.map((issue) => {
    const children = childrenMap.get(issue.id);
    return {
      key: issue.key,
      title: issue.title,
      type: issue.type,
      state: issue.state,
      priority: issue.priority,
      description: issue.description ?? undefined,
      engramContext: issue.engramContext,
      labels: issue.labels,
      children: children?.map((c) => ({
        key: c.key,
        title: c.title,
        state: c.state,
      })),
    };
  });
}

/**
 * Log engram_synced activity for each successfully exported issue.
 * Failures are logged to stderr but do not fail the command.
 */
async function logSyncActivity(
  kanon: KanonClient,
  result: SyncResult,
): Promise<void> {
  const successItems = result.items.filter((i) => i.success);
  for (const item of successItems) {
    try {
      await kanon.logActivity(item.issueKey, "engram_synced", {
        direction: item.direction,
        action: item.action,
      });
    } catch {
      // Activity logging is best-effort — don't fail the export
      console.error(
        chalk.dim(
          `Warning: Failed to log activity for ${item.issueKey}`,
        ),
      );
    }
  }
}

/**
 * Print a formatted summary table for a sync result.
 */
function printSyncSummary(
  result: SyncResult,
  operation: string,
  dryRun: boolean,
): void {
  console.log("");

  if (dryRun) {
    console.log(chalk.cyan(`${operation} dry run complete -- no changes made.`));
  } else {
    console.log(chalk.green(`${operation} complete.`));
  }

  console.log("");
  console.log(chalk.bold("  Summary:"));
  console.log(`    Exported:   ${chalk.green(String(result.exported))}`);
  console.log(`    Unchanged:  ${chalk.dim(String(result.unchanged))}`);
  console.log(`    Conflicts:  ${result.conflicts > 0 ? chalk.yellow(String(result.conflicts)) : chalk.dim("0")}`);
  console.log(`    Errors:     ${result.errors.length > 0 ? chalk.red(String(result.errors.length)) : chalk.dim("0")}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log(chalk.red("  Errors:"));
    for (const err of result.errors) {
      console.log(chalk.red(`    ${err.item}: ${err.error}`));
    }
  }

  if (dryRun && result.items.length > 0) {
    console.log("");
    console.log(chalk.dim("  Items that would be processed:"));
    for (const item of result.items) {
      const actionLabel =
        item.action === "create"
          ? chalk.green("CREATE")
          : chalk.yellow("UPDATE");
      console.log(`    ${actionLabel} ${item.issueKey}`);
    }
  }
}
