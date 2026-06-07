// ─── Skill Installer ─────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

export const PRODUCT_SKILLS = ["kanon-agent", "kanon-init", "kanon-onboard"];

export const RETIRED_SKILLS = [
  "kanon-mcp",
  "kanon-create-issue",
  "kanon-roadmap",
  "kanon-cycle",
  "kanon-orchestrator-hooks",
];

/**
 * Install product skills from assets directory to the tool's skill directory.
 * Removes retired skills on every run (idempotent upgrade-safe cleanup).
 * Copies each product skill recursively (preserves sections/ subdirectories).
 * Creates parent directories if needed. Idempotent — overwrites on re-run.
 */
export function installSkills(skillDest: string, assetsDir: string): string[] {
  const skillsSource = path.join(assetsDir, "skills");
  if (!fs.existsSync(skillsSource)) {
    return [];
  }

  // Remove retired skills before installing product skills
  for (const name of RETIRED_SKILLS) {
    fs.rmSync(path.join(skillDest, name), { recursive: true, force: true });
  }

  const installed: string[] = [];

  for (const skillName of PRODUCT_SKILLS) {
    const srcDir = path.join(skillsSource, skillName);
    if (!fs.existsSync(srcDir)) continue;

    const destDir = path.join(skillDest, skillName);
    // Remove existing dest dir so cpSync replaces cleanly
    fs.rmSync(destDir, { recursive: true, force: true });
    // Recursive copy: preserves sections/ and any nested structure
    fs.cpSync(srcDir, destDir, { recursive: true });

    installed.push(skillName);
  }

  return installed;
}

/**
 * Remove Kanon product and retired skill directories from the tool's skill directory.
 * Returns the list of skills that were removed.
 */
export function removeSkills(skillDest: string): string[] {
  const removed: string[] = [];

  for (const skillName of [...PRODUCT_SKILLS, ...RETIRED_SKILLS]) {
    const dir = path.join(skillDest, skillName);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(skillName);
    }
  }

  return removed;
}
