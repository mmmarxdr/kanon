// ─── Command Installer ────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

/**
 * Install slash-command files from assets to the tool's commands directory.
 * Only for tools that support commands (have a commandDest).
 * Creates parent directories if needed. Idempotent — overwrites on re-run.
 * Removes stale kanon-*.md files not present in the current source set.
 */
export function installCommands(
  commandDest: string,
  assetsDir: string,
): string[] {
  const commandsSource = path.join(assetsDir, "commands");
  if (!fs.existsSync(commandsSource)) {
    return [];
  }

  const installed: string[] = [];

  fs.mkdirSync(commandDest, { recursive: true });

  // Clean stale kanon commands not in the current source set
  const sourceFiles = fs.readdirSync(commandsSource).filter(
    (f) => f.startsWith("kanon-") && f.endsWith(".md"),
  );
  const sourceSet = new Set(sourceFiles);
  if (fs.existsSync(commandDest)) {
    const existing = fs.readdirSync(commandDest).filter(
      (f) => f.startsWith("kanon-") && f.endsWith(".md"),
    );
    for (const file of existing) {
      if (!sourceSet.has(file)) {
        fs.rmSync(path.join(commandDest, file));
      }
    }
  }

  const files = fs.readdirSync(commandsSource);
  for (const file of files) {
    if (!file.startsWith("kanon-") || !file.endsWith(".md")) continue;

    const srcFile = path.join(commandsSource, file);
    const destFile = path.join(commandDest, file);

    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
      installed.push(file);
    }
  }

  return installed;
}

/**
 * Remove Kanon slash-command files from the tool's commands directory.
 * Returns the list of command files that were removed.
 */
export function removeCommands(commandDest: string): string[] {
  if (!fs.existsSync(commandDest)) {
    return [];
  }

  const removed: string[] = [];

  const files = fs.readdirSync(commandDest);
  for (const file of files) {
    if (!file.startsWith("kanon-") || !file.endsWith(".md")) continue;

    const filePath = path.join(commandDest, file);
    if (fs.statSync(filePath).isFile()) {
      fs.rmSync(filePath);
      removed.push(file);
    }
  }

  return removed;
}
