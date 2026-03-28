// ─── kanon sync ────────────────────────────────────────────────────────────

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
 * Register the `kanon sync` command.
 *
 * Bidirectional sync between Kanon issues and Engram observations.
 * Fetches both sides, then runs SyncEngine.sync() which exports
 * changed Kanon issues and imports changed Engram observations.
 *
 * Options:
 *   --project <KEY>              Kanon project key (required)
 *   --namespace <ns>             Override Engram namespace
 *   --strategy <strategy>        Conflict strategy: engram-wins|kanon-wins|newest-wins (default: newest-wins)
 *   --dry-run                    Preview changes without applying
 */
export function syncCommand(program: Command): void {
  program
    .command("sync")
    .description("Bidirectional sync between Kanon issues and Engram observations")
    .requiredOption("--project <KEY>", "Kanon project key")
    .option("--namespace <ns>", "Engram namespace (overrides project setting)")
    .option(
      "--strategy <strategy>",
      "Conflict resolution: engram-wins|kanon-wins|newest-wins",
      "newest-wins",
    )
    .option("--engram-url <url>", "Engram API URL")
    .option("--kanon-url <url>", "Kanon API URL")
    .option("--dry-run", "Preview changes without applying", false)
    .action(async (opts: SyncOptions) => {
      try {
        await runSync(opts);
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

interface SyncOptions {
  project: string;
  namespace?: string;
  strategy: string;
  engramUrl?: string;
  kanonUrl?: string;
  dryRun: boolean;
}

const VALID_STRATEGIES = ["engram-wins", "kanon-wins", "newest-wins"];

async function runSync(opts: SyncOptions): Promise<void> {
  // Validate strategy
  if (!VALID_STRATEGIES.includes(opts.strategy)) {
    console.error(
      chalk.red(
        `Invalid strategy '${opts.strategy}'. Must be one of: ${VALID_STRATEGIES.join(", ")}`,
      ),
    );
    process.exit(1);
  }

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

  // 2. Connect to Engram
  const engram = new EngramClient({ baseUrl: config.engramUrl });

  const connectivity = await engram.checkConnectivity();
  if (!connectivity.ok) {
    console.error(
      chalk.red(`Engram is not reachable at ${config.engramUrl}.`),
    );
    process.exit(1);
  }

  // 3. Fetch both sides in parallel
  console.log(chalk.dim("Fetching data from both Kanon and Engram..."));

  const [issues, observations] = await Promise.all([
    kanon.listIssues(opts.project),
    engram.search("", { project: namespace, limit: 200 }),
  ]);

  console.log(
    chalk.dim(
      `Found ${issues.length} issue(s) in Kanon, ${observations.length} observation(s) in Engram.`,
    ),
  );

  if (issues.length === 0 && observations.length === 0) {
    console.log(chalk.yellow("Nothing to sync -- both sides are empty."));
    return;
  }

  // 4. Create SyncEngine and run bidirectional sync
  const syncEngine = new SyncEngine(engram, kanon, {
    projectKey: opts.project,
    namespace,
    defaultStrategy: opts.strategy as ConflictStrategy,
    onProgress: (current, total, item) => {
      console.log(
        chalk.dim(`  [${current}/${total}] Syncing ${item}...`),
      );
    },
  });

  const syncableIssues = issuesToSyncable(issues);

  if (opts.dryRun) {
    console.log(chalk.cyan("\nDry run -- no changes will be made.\n"));
  }

  const result = await syncEngine.sync(syncableIssues, observations, {
    strategy: opts.strategy as ConflictStrategy,
    dryRun: opts.dryRun,
  });

  // 5. Log activity for each successfully synced issue
  if (!opts.dryRun) {
    await logSyncActivity(kanon, result);
  }

  // 6. Print summary
  printSyncSummary(result, "Sync", opts.dryRun);
}

/**
 * Convert KanonIssue[] to SyncableIssue[] for the SyncEngine.
 */
function issuesToSyncable(issues: KanonIssue[]): SyncableIssue[] {
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
 * Log engram_synced activity for each successfully synced issue.
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
      // Activity logging is best-effort — don't fail the sync
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
  console.log(`    Imported:   ${chalk.green(String(result.imported))}`);
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
      const dirLabel = item.direction === "exported" ? "EXPORT" : "IMPORT";
      const actionLabel =
        item.action === "create"
          ? chalk.green(`${dirLabel}/CREATE`)
          : chalk.yellow(`${dirLabel}/UPDATE`);
      console.log(`    ${actionLabel} ${item.issueKey}`);
    }
  }
}
