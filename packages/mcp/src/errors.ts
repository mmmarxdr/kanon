// ─── MCP Error Response Helper ──────────────────────────────────────────────

import { KanonApiError } from "./kanon-client.js";
import { TRIAGE_MCP_CONTRACT_VERSION } from "./types.js";
import { MCP_VERSION } from "./version.js";

/**
 * Shape returned by MCP tool handlers.
 * The index signature is required by the MCP SDK's CallToolResult type.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const SEMANTIC_CATEGORIES = new Set([
  "validation",
  "not_found_or_not_visible",
  "authorization",
  "source_conflict",
  "immutable_content_conflict",
  "terminal_lifecycle",
  "temporary_unavailability",
  "unsupported_non_executable",
  "degraded_success",
]);

/**
 * Maps any error into an MCP CallToolResult with isError: true.
 * - KanonApiError: includes status code and error code.
 * - Triage semantic errors: preserve category/retry/correlation + MCP contract version.
 * - Unknown errors: includes stringified message.
 */
export function errorResult(err: unknown): ToolResult {
  if (err instanceof KanonApiError) {
    const payload: Record<string, unknown> = {
      error: `${err.statusCode}: ${err.message}`,
      code: err.code,
    };
    if (err.category && SEMANTIC_CATEGORIES.has(err.category)) {
      payload["category"] = err.category;
      payload["apiContractVersion"] = err.apiContractVersion ?? "triage-api.v1";
      payload["mcpContractVersion"] = TRIAGE_MCP_CONTRACT_VERSION;
      payload["mcpVersion"] = MCP_VERSION;
      if (err.retry) payload["retry"] = err.retry;
      if (err.correlationId) payload["correlationId"] = err.correlationId;
      if (err.provenance) payload["provenance"] = err.provenance;
    }
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        }),
      },
    ],
    isError: true,
  };
}

/**
 * Returns data directly as JSON text in an MCP CallToolResult.
 * No wrapper object — the MCP SDK's `isError` flag handles error signaling.
 */
export function dataResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

/**
 * Triage success payload — preserves API fields and adds MCP contract/version.
 */
export function triageDataResult(data: unknown, correlationId?: string): ToolResult {
  const base =
    data && typeof data === "object" && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>) }
      : { data };
  base["mcpContractVersion"] = TRIAGE_MCP_CONTRACT_VERSION;
  base["mcpVersion"] = MCP_VERSION;
  if (correlationId && base["correlationId"] === undefined) {
    base["correlationId"] = correlationId;
  }
  return dataResult(base);
}
