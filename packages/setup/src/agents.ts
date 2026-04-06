// ─── Agent Installer ─────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

/**
 * Install agent files from assets to the tool's agent directory.
 * Only for tools that support agents (have an agentDest).
 * Creates parent directories if needed. Idempotent — overwrites on re-run.
 */
export function installAgents(
  agentDest: string,
  assetsDir: string,
): string[] {
  const agentsSource = path.join(assetsDir, "agents");
  if (!fs.existsSync(agentsSource)) {
    return [];
  }

  const installed: string[] = [];

  fs.mkdirSync(agentDest, { recursive: true });

  // Clean stale kanon agents not in the current source set
  const sourceFiles = fs.readdirSync(agentsSource).filter(
    (f) => f.startsWith("kanon") && f.endsWith(".md"),
  );
  const sourceSet = new Set(sourceFiles);
  if (fs.existsSync(agentDest)) {
    const existing = fs.readdirSync(agentDest).filter(
      (f) => f.startsWith("kanon") && f.endsWith(".md"),
    );
    for (const file of existing) {
      if (!sourceSet.has(file)) {
        fs.rmSync(path.join(agentDest, file));
      }
    }
  }

  const files = fs.readdirSync(agentsSource);
  for (const file of files) {
    if (!file.startsWith("kanon") || !file.endsWith(".md")) continue;

    const srcFile = path.join(agentsSource, file);
    const destFile = path.join(agentDest, file);

    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
      installed.push(file);
    }
  }

  return installed;
}

/**
 * Remove Kanon agent files from the tool's agent directory.
 * Returns the list of agent files that were removed.
 */
export function removeAgents(agentDest: string): string[] {
  if (!fs.existsSync(agentDest)) {
    return [];
  }

  const removed: string[] = [];

  const files = fs.readdirSync(agentDest);
  for (const file of files) {
    if (!file.startsWith("kanon") || !file.endsWith(".md")) continue;

    const filePath = path.join(agentDest, file);
    if (fs.statSync(filePath).isFile()) {
      fs.rmSync(filePath);
      removed.push(file);
    }
  }

  return removed;
}
