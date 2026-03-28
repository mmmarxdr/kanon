// ─── kanon recover ──────────────────────────────────────────────────────────

import type { Command } from "commander";
import chalk from "chalk";
import {
  EngramClient,
  SddParser,
  EntityMapper,
  type SddChange,
} from "@kanon/bridge";
import { loadConfig } from "../config.js";
import { KanonClient, KanonApiError, type KanonIssue } from "../kanon-client.js";

/**
 * Register the `kanon recover` command.
 *
 * Imports SDD artifacts from Engram into Kanon as Issues.
 * Creates one parent Issue (type=feature) per SDD change and child Issues
 * (type=task) for each task item.
 *
 * Options:
 *   --project <KEY>      Kanon project key (required)
 *   --engram-url <url>   Override ENGRAM_URL
 *   --kanon-url <url>    Override KANON_API_URL
 *   --dry-run            Preview what would be created
 */
export function recoverCommand(program: Command): void {
  program
    .command("recover")
    .description("Import SDD artifacts from Engram into Kanon as Issues")
    .requiredOption("--project <KEY>", "Kanon project key")
    .option("--engram-url <url>", "Engram API URL")
    .option("--kanon-url <url>", "Kanon API URL")
    .option("--dry-run", "Preview changes without creating", false)
    .action(async (opts: RecoverOptions) => {
      try {
        await runRecover(opts);
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

interface RecoverOptions {
  project: string;
  engramUrl?: string;
  kanonUrl?: string;
  dryRun: boolean;
}

async function runRecover(opts: RecoverOptions): Promise<void> {
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
      console.error(
        chalk.dim("Hint: Create the project first, then run kanon register."),
      );
      process.exit(1);
    }
    throw err;
  }

  const namespace = project.engramNamespace;
  if (!namespace) {
    console.error(
      chalk.red(
        `Project ${opts.project} has no Engram namespace linked.`,
      ),
    );
    console.error(
      chalk.dim(
        "Hint: Run `kanon register --project " +
          opts.project +
          " --namespace <ns>` first.",
      ),
    );
    process.exit(1);
  }

  // 2. Search Engram for SDD artifacts
  console.log(
    chalk.dim(`Searching Engram for SDD artifacts in namespace '${namespace}'...`),
  );

  const engram = new EngramClient({ baseUrl: config.engramUrl });
  const observations = await engram.search("sdd/", {
    project: namespace,
    limit: 100,
  });

  if (observations.length === 0) {
    console.log(chalk.yellow("No SDD artifacts found in Engram."));
    return;
  }

  // 3. Parse and group by change
  const changes = SddParser.groupByChange(observations);
  console.log(
    chalk.dim(
      `Found ${changes.length} SDD change(s) with ${observations.length} artifact(s).`,
    ),
  );

  // 4. Get existing issues to check for duplicates (idempotency)
  let existingIssues: KanonIssue[] = [];
  if (!opts.dryRun) {
    existingIssues = await kanon.listIssues(opts.project);
  }

  const existingTopicKeys = new Set<string>();
  for (const issue of existingIssues) {
    if (issue.specArtifacts && typeof issue.specArtifacts === "object") {
      const ref = issue.specArtifacts as { topicKey?: string };
      if (ref.topicKey) {
        existingTopicKeys.add(ref.topicKey);
      }
    }
  }

  // 5. Map and create
  let createdFeatures = 0;
  let createdTasks = 0;
  let skippedFeatures = 0;
  let skippedTasks = 0;

  for (const change of changes) {
    const parentPayload = EntityMapper.changeToParentIssue(
      change,
      opts.project,
    );
    const parentTopicKey = `sdd/${change.name}/proposal`;

    if (opts.dryRun) {
      printDryRunChange(change, parentPayload);
      createdFeatures++;
      createdTasks += change.tasks.length;
      continue;
    }

    // Check idempotency for parent
    if (existingTopicKeys.has(parentTopicKey)) {
      skippedFeatures++;
      // Skip child tasks too — they belong to the existing parent
      skippedTasks += change.tasks.length;
      continue;
    }

    // Create parent issue
    let parentIssue;
    try {
      parentIssue = await kanon.createIssue(opts.project, {
        title: parentPayload.title,
        type: parentPayload.type,
        priority: parentPayload.priority,
        description: parentPayload.description,
      });
      createdFeatures++;
    } catch (err) {
      console.error(
        chalk.red(
          `Failed to create feature issue for change '${change.name}': ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      continue;
    }

    // Create child task issues
    for (const task of change.tasks) {
      const taskPayload = EntityMapper.taskToChildIssue(task, change.name, opts.project);
      const taskTopicKey = `sdd/${change.name}/task/${task.title.slice(0, 50)}`;

      if (existingTopicKeys.has(taskTopicKey)) {
        skippedTasks++;
        continue;
      }

      try {
        await kanon.createIssue(opts.project, {
          title: taskPayload.title,
          type: taskPayload.type,
          priority: taskPayload.priority,
          description: taskPayload.description,
          parentId: parentIssue.id,
        });
        createdTasks++;
      } catch (err) {
        console.error(
          chalk.yellow(
            `Warning: Failed to create task '${task.title}': ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }
  }

  // 6. Print summary
  console.log("");
  if (opts.dryRun) {
    console.log(chalk.cyan("Dry run complete — no changes made."));
    console.log(
      `Would create ${chalk.bold(String(createdFeatures))} feature(s), ${chalk.bold(String(createdTasks))} task(s)`,
    );
  } else {
    console.log(chalk.green("Recovery complete."));
    console.log(
      `Created ${chalk.bold(String(createdFeatures))} feature(s), ${chalk.bold(String(createdTasks))} task(s)`,
    );
    if (skippedFeatures > 0 || skippedTasks > 0) {
      console.log(
        chalk.dim(
          `Skipped ${skippedFeatures} existing feature(s), ${skippedTasks} existing task(s)`,
        ),
      );
    }
  }
}

/**
 * Print a dry-run summary for a single SDD change.
 */
function printDryRunChange(
  change: SddChange,
  parentPayload: { title: string; type: string; state: string },
): void {
  console.log("");
  console.log(
    chalk.bold(`  [Feature] ${parentPayload.title}`) +
      chalk.dim(` (state: ${parentPayload.state})`),
  );
  console.log(
    chalk.dim(`    Change: ${change.name} | Artifacts: ${[...change.artifacts.keys()].join(", ")}`),
  );

  for (const task of change.tasks) {
    const marker = task.done ? chalk.green("[x]") : chalk.dim("[ ]");
    console.log(`    ${marker} ${task.title}`);
  }
}
