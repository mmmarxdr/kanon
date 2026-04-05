// ─── Skill Installer ─────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const PRODUCT_SKILLS = [
  "kanon-mcp",
  "kanon-init",
  "kanon-create-issue",
  "kanon-roadmap",
  "kanon-orchestrator-hooks",
];

/**
 * Install product skills from assets directory to the tool's skill directory.
 * Creates parent directories if needed. Idempotent — overwrites on re-run.
 */
export function installSkills(skillDest: string, assetsDir: string): string[] {
  const skillsSource = path.join(assetsDir, "skills");
  if (!fs.existsSync(skillsSource)) {
    return [];
  }

  const installed: string[] = [];

  for (const skillName of PRODUCT_SKILLS) {
    const srcDir = path.join(skillsSource, skillName);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(skillDest, skillName);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });

    // Copy all files in the skill directory
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const srcFile = path.join(srcDir, file);
      const destFile = path.join(destDir, file);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, destFile);
      }
    }

    installed.push(skillName);
  }

  return installed;
}

/**
 * Remove Kanon product skill directories from the tool's skill directory.
 * Returns the list of skills that were removed.
 */
export function removeSkills(skillDest: string): string[] {
  const removed: string[] = [];

  for (const skillName of PRODUCT_SKILLS) {
    const dir = path.join(skillDest, skillName);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(skillName);
    }
  }

  return removed;
}
