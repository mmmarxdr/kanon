// ─── MCP Error Response Helper ──────────────────────────────────────────────

import { KanonApiError } from "./kanon-client.js";

/**
 * Shape returned by MCP tool handlers.
 * The index signature is required by the MCP SDK's CallToolResult type.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Maps any error into an MCP CallToolResult with isError: true.
 * - KanonApiError: includes status code and error code.
 * - Unknown errors: includes stringified message.
 */
export function errorResult(err: unknown): ToolResult {
  if (err instanceof KanonApiError) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `${err.statusCode}: ${err.message}`,
            code: err.code,
          }),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        }),
      },
    ],
    isError: true,
  };
}

/**
 * Wraps a successful result into an MCP CallToolResult.
 */
export function successResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true, data }),
      },
    ],
  };
}
