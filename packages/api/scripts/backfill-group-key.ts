/**
 * Backfill script: populate `groupKey` for existing issues.
 *
 * Derives groupKey from multiple sources (in priority order):
 *   1. `engramContext.topicKey` — extract SDD prefix (e.g. `sdd/auth-model/spec` → `sdd/auth-model`)
 *   2. `specArtifacts` — if it has topicKey, extract prefix
 *   3. Issue title — if it looks like a topic_key (e.g. `sdd/bridge-phase-c/proposal`)
 *   4. Labels — if issue has `engram:{changeName}` label matching known SDD patterns
 *
 * Idempotent: only updates issues where `groupKey` is null and a valid
 * group key can be derived. Safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/backfill-group-key.ts
 *   npx tsx scripts/backfill-group-key.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";

/** Matches sdd/{changeName}/{phase} or sdd-init/{project} */
const SDD_TOPIC_KEY_RE = /^(sdd\/[^/]+)\/.+$/;
const SDD_INIT_RE = /^(sdd-init\/[^/]+)$/;

/**
 * Known label-to-groupKey mappings for engram: labels that correspond
 * to specific SDD changes but whose issue titles don't contain the topic_key.
 */
const LABEL_GROUP_MAP: Record<string, string> = {
  "engram:bridge-phase-c": "sdd/bridge-phase-c",
  "engram:project-foundation": "sdd/project-foundation",
  "engram:web-board-view": "sdd/web-board-view",
  "engram:sdd-init": "sdd-init/kanon",
};

interface EngramContext {
  topicKey?: string;
  [key: string]: unknown;
}

interface SpecArtifacts {
  topicKey?: string;
  [key: string]: unknown;
}

function extractGroupKeyFromTopicKey(topicKey: string): string | null {
  const sddMatch = SDD_TOPIC_KEY_RE.exec(topicKey);
  if (sddMatch?.[1]) return sddMatch[1];

  const initMatch = SDD_INIT_RE.exec(topicKey);
  if (initMatch?.[1]) return initMatch[1];

  return null;
}

function deriveGroupKey(issue: {
  title: string;
  labels: string[];
  engramContext: unknown;
  specArtifacts: unknown;
}): string | null {
  // 1. engramContext.topicKey
  const ctx = issue.engramContext as EngramContext | null;
  if (ctx?.topicKey) {
    const gk = extractGroupKeyFromTopicKey(ctx.topicKey);
    if (gk) return gk;
  }

  // 2. specArtifacts.topicKey
  const spec = issue.specArtifacts as SpecArtifacts | null;
  if (spec?.topicKey) {
    const gk = extractGroupKeyFromTopicKey(spec.topicKey);
    if (gk) return gk;
  }

  // 3. Title as topic_key (e.g. "sdd/bridge-phase-c/proposal")
  const titleSdd = SDD_TOPIC_KEY_RE.exec(issue.title);
  if (titleSdd?.[1]) return titleSdd[1];

  const titleInit = SDD_INIT_RE.exec(issue.title);
  if (titleInit?.[1]) return titleInit[1];

  // 4. Labels — check for known SDD-related engram labels
  for (const label of issue.labels || []) {
    if (LABEL_GROUP_MAP[label]) {
      return LABEL_GROUP_MAP[label];
    }
  }

  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();

  try {
    console.log(
      `[backfill-group-key] Starting${dryRun ? " (DRY RUN)" : ""}...`,
    );

    // Find all issues without a groupKey
    const issues = await prisma.issue.findMany({
      where: {
        groupKey: null,
      },
      select: {
        id: true,
        key: true,
        title: true,
        labels: true,
        engramContext: true,
        specArtifacts: true,
      },
    });

    console.log(
      `[backfill-group-key] Found ${issues.length} issues without groupKey`,
    );

    // Build update batch
    const updates: Array<{
      id: string;
      key: string;
      groupKey: string;
      source: string;
    }> = [];
    const skipped: Array<{ key: string; title: string }> = [];

    for (const issue of issues) {
      const groupKey = deriveGroupKey(issue);
      if (!groupKey) {
        skipped.push({ key: issue.key, title: issue.title });
        continue;
      }

      // Determine source for logging
      let source = "unknown";
      const ctx = issue.engramContext as EngramContext | null;
      const spec = issue.specArtifacts as SpecArtifacts | null;
      if (ctx?.topicKey && extractGroupKeyFromTopicKey(ctx.topicKey)) {
        source = "engramContext";
      } else if (
        spec?.topicKey &&
        extractGroupKeyFromTopicKey(spec.topicKey)
      ) {
        source = "specArtifacts";
      } else if (
        SDD_TOPIC_KEY_RE.test(issue.title) ||
        SDD_INIT_RE.test(issue.title)
      ) {
        source = "title";
      } else {
        source = "label";
      }

      updates.push({ id: issue.id, key: issue.key, groupKey, source });
    }

    // Group by groupKey for summary
    const groupCounts: Record<string, number> = {};
    for (const u of updates) {
      groupCounts[u.groupKey] = (groupCounts[u.groupKey] || 0) + 1;
    }

    console.log(
      `[backfill-group-key] ${updates.length} issues will be updated, ${skipped.length} skipped`,
    );
    console.log(`[backfill-group-key] Groups:`);
    for (const [gk, count] of Object.entries(groupCounts).sort()) {
      console.log(`  ${gk}: ${count} issues`);
    }

    if (dryRun) {
      console.log("\n[backfill-group-key] Issue details:");
      for (const u of updates) {
        console.log(
          `  [dry-run] ${u.key} → groupKey="${u.groupKey}" (from ${u.source})`,
        );
      }
      if (skipped.length > 0) {
        console.log("\n[backfill-group-key] Skipped (no groupKey derivable):");
        for (const s of skipped) {
          console.log(`  [skip] ${s.key}: ${s.title}`);
        }
      }
      console.log("\n[backfill-group-key] Dry run complete. No changes made.");
      return;
    }

    // Batch update in a single transaction
    if (updates.length > 0) {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.issue.update({
            where: { id: u.id },
            data: { groupKey: u.groupKey },
          }),
        ),
      );
    }

    console.log(
      `[backfill-group-key] Successfully updated ${updates.length} issues.`,
    );
    console.log(
      `[backfill-group-key] ${skipped.length} issues skipped (no groupKey derivable).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[backfill-group-key] Fatal error:", err);
  process.exit(1);
});
