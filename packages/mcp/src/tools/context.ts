// ─── Context Tools ──────────────────────────────────────────────────────────

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GetIssueContextInput } from "../types.js";
import { dataResult } from "../errors.js";

const ENGRAM_TIMEOUT_MS = 2_000;

/**
 * Parsed session summary shape returned by the tool.
 */
interface SessionContext {
  id: number;
  date: string;
  goal: string;
  discoveries: string[];
  accomplished: string[];
  nextSteps: string[];
  relevantFiles: string[];
}

/**
 * Extract bullet items from a markdown section.
 * Matches lines starting with `- ` or `* ` under the given heading.
 */
function extractSection(content: string, heading: string): string[] {
  const pattern = new RegExp(
    `##\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = content.match(pattern);
  if (!match) return [];

  return match[1]!
    .split("\n")
    .map((line) => line.replace(/^[\s]*[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * Extract a single-value section (first non-empty line after heading).
 */
function extractGoal(content: string): string {
  const pattern = /##\s+Goal[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i;
  const match = content.match(pattern);
  if (!match) {
    // Fallback: first 120 chars of content
    return content.slice(0, 120).trim();
  }

  const lines = match[1]!
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.join(" ").slice(0, 300);
}

/**
 * Parse a session summary observation content into structured data.
 */
function parseSessionSummary(
  obs: { id: number; content: string; created_at: string },
): SessionContext {
  const { content } = obs;
  return {
    id: obs.id,
    date: obs.created_at,
    goal: extractGoal(content),
    discoveries: extractSection(content, "Discoveries"),
    accomplished: extractSection(content, "Accomplished"),
    nextSteps: extractSection(content, "Next Steps"),
    relevantFiles: extractSection(content, "Relevant Files"),
  };
}

/**
 * Search Engram for session summaries mentioning the given issue key.
 */
async function searchEngram(
  issueKey: string,
  limit: number,
  engramUrl: string,
  engramKey: string | undefined,
): Promise<SessionContext[]> {
  const params = new URLSearchParams({
    q: issueKey,
    project: "kanon",
    type: "session_summary",
    limit: String(limit),
  });

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (engramKey) {
    headers["Authorization"] = `Bearer ${engramKey}`;
  }

  const response = await fetch(`${engramUrl}/search?${params.toString()}`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(ENGRAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    return [];
  }

  const results = (await response.json()) as Array<{
    id: number;
    content: string;
    created_at: string;
  }>;

  return results.map(parseSessionSummary);
}

/**
 * Register the `kanon_get_issue_context` tool on the MCP server.
 *
 * Uses inline `fetch` to query Engram — no `@kanon/bridge` dependency.
 * Returns empty results gracefully when Engram is unreachable or not configured.
 */
export function registerContextTools(server: McpServer): void {
  const engramUrl = (
    process.env["ENGRAM_API_URL"] ??
    process.env["ENGRAM_URL"] ??
    ""
  ).replace(/\/+$/, "");
  const engramKey = process.env["ENGRAM_API_KEY"];

  server.tool(
    "kanon_get_issue_context",
    [
      "Retrieve past AI coding session context for a Kanon issue.",
      "Searches Engram for session summaries that mention the issue key.",
      "Returns structured data: goal, discoveries, accomplished items, next steps, and relevant files.",
      "Use this at the START of a coding session to understand prior work on an issue.",
      "Returns empty results gracefully if Engram is not configured or unreachable.",
    ].join(" "),
    GetIssueContextInput.shape,
    async ({ issueKey, limit }) => {
      const sessionLimit = limit ?? 5;

      if (!engramUrl) {
        return dataResult({
          sessions: [],
          sessionCount: 0,
          message: "Engram not configured — set ENGRAM_API_URL",
        });
      }

      try {
        const sessions = await searchEngram(
          issueKey,
          sessionLimit,
          engramUrl,
          engramKey,
        );
        return dataResult({
          sessions,
          sessionCount: sessions.length,
        });
      } catch {
        return dataResult({
          sessions: [],
          sessionCount: 0,
        });
      }
    },
  );
}
