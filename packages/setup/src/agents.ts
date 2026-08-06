// ─── Agent Installer ─────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { stringify } from "smol-toml";
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

function renderCodexAgent(source: string): string {
  const { body, data } = parseFrontmatter(source);
  return stringify({
    name: typeof data["name"] === "string" ? data["name"] : "kanon",
    description: typeof data["description"] === "string"
      ? data["description"]
      : "Project management operations through Kanon",
    developer_instructions: body.trim(),
  }) + "\n";
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
    const outputFile = host === "codex" ? "kanon.toml" : file;
    const destFile = path.join(agentDest, outputFile);

    if (!fs.existsSync(srcFile) || !fs.statSync(srcFile).isFile()) continue;
    if (host === "cursor") {
      fs.writeFileSync(destFile, renderCursorAgent(fs.readFileSync(srcFile, "utf8")));
    } else if (host === "codex") {
      fs.writeFileSync(destFile, renderCodexAgent(fs.readFileSync(srcFile, "utf8")));
    } else {
      fs.copyFileSync(srcFile, destFile);
    }
    installed.push(outputFile);
  }

  return installed;
}

/**
 * Remove Kanon agent files from the tool's agent directory.
 * Returns the list of agent files that were removed.
 */
export function removeAgents(agentDest: string, host?: string): string[] {
  if (!fs.existsSync(agentDest)) {
    return [];
  }

  const removed: string[] = [];

  const productFiles = host === "codex" ? ["kanon.toml"] : PRODUCT_AGENT_FILES;
  for (const file of productFiles) {
    const filePath = path.join(agentDest, file);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      fs.rmSync(filePath);
      removed.push(file);
    }
  }

  return removed;
}
