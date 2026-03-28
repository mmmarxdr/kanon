// ─── kanon register ─────────────────────────────────────────────────────────

import type { Command } from "commander";
import chalk from "chalk";
import { EngramClient } from "@kanon/bridge";
import { loadConfig } from "../config.js";
import { KanonClient, KanonApiError } from "../kanon-client.js";

/**
 * Register the `kanon register` command.
 *
 * Links a Kanon project to an Engram namespace by setting `engramNamespace`
 * on the project record via PATCH /api/projects/:key.
 *
 * Options:
 *   --project <KEY>      Kanon project key (required)
 *   --namespace <ns>     Engram project namespace (required)
 *   --engram-url <url>   Override ENGRAM_URL
 *   --kanon-url <url>    Override KANON_API_URL
 *   --dry-run            Show what would happen without making changes
 */
export function registerCommand(program: Command): void {
  program
    .command("register")
    .description("Link a Kanon project to an Engram namespace")
    .requiredOption("--project <KEY>", "Kanon project key")
    .requiredOption("--namespace <ns>", "Engram project namespace")
    .option("--engram-url <url>", "Engram API URL")
    .option("--kanon-url <url>", "Kanon API URL")
    .option("--dry-run", "Preview changes without applying", false)
    .action(async (opts: RegisterOptions) => {
      try {
        await runRegister(opts);
      } catch (err) {
        if (err instanceof KanonApiError && err.statusCode === 404) {
          console.error(chalk.red(`Project ${opts.project} not found`));
          process.exit(1);
        }
        console.error(
          chalk.red(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
        process.exit(1);
      }
    });
}

interface RegisterOptions {
  project: string;
  namespace: string;
  engramUrl?: string;
  kanonUrl?: string;
  dryRun: boolean;
}

async function runRegister(opts: RegisterOptions): Promise<void> {
  const config = loadConfig({
    engramUrl: opts.engramUrl,
    kanonApiUrl: opts.kanonUrl,
  });

  // Validate: check Engram namespace has observations
  const engram = new EngramClient({ baseUrl: config.engramUrl });
  const connectivity = await engram.checkConnectivity();
  if (!connectivity.ok) {
    console.warn(
      chalk.yellow(
        `Warning: Engram is not reachable at ${config.engramUrl}. Proceeding anyway.`,
      ),
    );
  } else {
    // Verify namespace has some observations
    const results = await engram.search("sdd/", {
      project: opts.namespace,
      limit: 1,
    });
    if (results.length === 0) {
      console.warn(
        chalk.yellow(
          `Warning: No SDD observations found in Engram namespace '${opts.namespace}'.`,
        ),
      );
    }
  }

  // Validate: check project exists in Kanon
  const kanon = new KanonClient({
    baseUrl: config.kanonApiUrl,
    apiKey: config.kanonApiKey,
  });

  const project = await kanon.getProject(opts.project);

  if (opts.dryRun) {
    console.log(chalk.cyan("Dry run — no changes will be made.\n"));
    console.log(
      `Would link project ${chalk.bold(project.key)} (${project.name}) to Engram namespace ${chalk.bold(opts.namespace)}`,
    );
    return;
  }

  // PATCH the project with engram namespace
  await kanon.updateProject(opts.project, {
    engramNamespace: opts.namespace,
  });

  console.log(
    chalk.green(
      `Project ${chalk.bold(project.key)} linked to Engram namespace '${opts.namespace}'`,
    ),
  );
}
