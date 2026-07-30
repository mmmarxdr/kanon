// ─── Agent Installer ─────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./utils/frontmatter.js";

export const PRODUCT_AGENT_FILES = ["kanon.md"] as const;

function renderCursorAgent(source: string): string {
  const { body, data } = parseFrontmatter(source);
  const name = typeof data["name"] === "string" ? data["name"] : "kanon";
  const description = typeof data["description"] === "string"
    ? data["description"]
    : "Project management operations through Kanon";

  return [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "readonly: false",
    "is_background: false",
    "---",
    body,
  ].join("\n");
}

/**
 * Install agent files from assets to the tool's agent directory.
 * Only for tools that support agents (have an agentDest).
 * Creates parent directories if needed. Idempotent — overwrites on re-run.
 */
export function installAgents(
  agentDest: string,
  assetsDir: string,
  host?: string,
): string[] {
  const agentsSource = path.join(assetsDir, "agents");
  if (!fs.existsSync(agentsSource)) {
    return [];
  }

  const installed: string[] = [];

  fs.mkdirSync(agentDest, { recursive: true });

  for (const file of PRODUCT_AGENT_FILES) {
    const srcFile = path.join(agentsSource, file);
    const destFile = path.join(agentDest, file);

    if (!fs.existsSync(srcFile) || !fs.statSync(srcFile).isFile()) continue;
    if (host === "cursor") {
      fs.writeFileSync(destFile, renderCursorAgent(fs.readFileSync(srcFile, "utf8")));
    } else {
      fs.copyFileSync(srcFile, destFile);
    }
    installed.push(file);
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

  for (const file of PRODUCT_AGENT_FILES) {
    const filePath = path.join(agentDest, file);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      fs.rmSync(filePath);
      removed.push(file);
    }
  }

  return removed;
}
