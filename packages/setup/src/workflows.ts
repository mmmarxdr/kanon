// ─── Workflow Installer ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

/**
 * Install workflow files from assets to the tool's workflow directory.
 * Only for tools that support workflows (have a workflowDest).
 * Creates parent directories if needed. Idempotent — overwrites on re-run.
 */
export function installWorkflows(
  workflowDest: string,
  assetsDir: string,
): string[] {
  const workflowsSource = path.join(assetsDir, "workflows");
  if (!fs.existsSync(workflowsSource)) {
    return [];
  }

  const installed: string[] = [];

  fs.mkdirSync(workflowDest, { recursive: true });

  // Clean stale kanon workflows not in the current source set
  const sourceFiles = fs.readdirSync(workflowsSource).filter(
    (f) => f.startsWith("kanon-") && f.endsWith(".md"),
  );
  const sourceSet = new Set(sourceFiles);
  if (fs.existsSync(workflowDest)) {
    const existing = fs.readdirSync(workflowDest).filter(
      (f) => f.startsWith("kanon-") && f.endsWith(".md"),
    );
    for (const file of existing) {
      if (!sourceSet.has(file)) {
        fs.rmSync(path.join(workflowDest, file));
      }
    }
  }

  const files = fs.readdirSync(workflowsSource);
  for (const file of files) {
    if (!file.startsWith("kanon-") || !file.endsWith(".md")) continue;

    const srcFile = path.join(workflowsSource, file);
    const destFile = path.join(workflowDest, file);

    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
      installed.push(file);
    }
  }

  return installed;
}

/**
 * Remove Kanon workflow files from the tool's workflow directory.
 * Returns the list of workflow files that were removed.
 */
export function removeWorkflows(workflowDest: string): string[] {
  if (!fs.existsSync(workflowDest)) {
    return [];
  }

  const removed: string[] = [];

  const files = fs.readdirSync(workflowDest);
  for (const file of files) {
    if (!file.startsWith("kanon-") || !file.endsWith(".md")) continue;

    const filePath = path.join(workflowDest, file);
    if (fs.statSync(filePath).isFile()) {
      fs.rmSync(filePath);
      removed.push(file);
    }
  }

  return removed;
}
