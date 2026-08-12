// ─── Triage Tools (KAN-193) ───────────────────────────────────────────────────
//
// Five deferred MCP adapters over the triage API. No Prisma, role logic, local
// ranking, local paging, or Sampling. Hosts without a model stop after prepare.

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { KanonClient } from "../kanon-client.js";
import { errorResult, triageDataResult } from "../errors.js";
import {
  PreviewIssueTriageInput,
  PreviewIssueTriageInputShape,
  PersistTriageProposalInput,
  GetTriageProposalInput,
  ListTriageProposalsInput,
  DismissTriageProposalInput,
  DismissTriageProposalInputShape,
  TRIAGE_PREVIEW_TIMEOUT_MS,
  TRIAGE_PERSIST_TIMEOUT_MS,
  TRIAGE_GET_TIMEOUT_MS,
  TRIAGE_LIST_TIMEOUT_MS,
  TRIAGE_DISMISS_TIMEOUT_MS,
  TRIAGE_PREVIEW_COMPACT_BUDGET_BYTES,
  TRIAGE_PREVIEW_FULL_BUDGET_BYTES,
  TRIAGE_LIST_BUDGET_BYTES,
  TRIAGE_GET_BUDGET_BYTES,
  TRIAGE_DISMISS_BUDGET_BYTES,
} from "../types.js";

export const TRIAGE_DEFERRED_TOOLS = [
  "preview_issue_triage",
  "persist_triage_proposal",
  "get_triage_proposal",
  "list_triage_proposals",
  "dismiss_triage_proposal",
] as const;

export function isTriageToolsEnabled(value = process.env["KANON_TRIAGE_TOOLS_ENABLED"]): boolean {
  if (value === undefined || value === "true") return true;
  if (value === "false") return false;
  throw new Error("KANON_TRIAGE_TOOLS_ENABLED must be true or false");
}

const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const DISMISS_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

function correlationOrNew(explicit?: string): string {
  return explicit ?? randomUUID();
}

function enforceBudget(data: unknown, budgetBytes: number): unknown {
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") <= budgetBytes) return data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const truncated = { ...(data as Record<string, unknown>) };
    const degradation = Array.isArray(truncated["degradation"])
      ? [...(truncated["degradation"] as unknown[])]
      : [];
    if (!degradation.includes("output_truncated")) degradation.push("output_truncated");
    truncated["degradation"] = degradation;
    // Drop optional bulk fields first (design: optional detail before supported items).
    delete truncated["evidence"];
    delete truncated["rows"];
    delete truncated["lifecycleHistory"];
    const retry = JSON.stringify(truncated);
    if (Buffer.byteLength(retry, "utf8") <= budgetBytes) return truncated;
  }
  return {
    error: "OUTPUT_BUDGET_EXCEEDED",
    code: "OUTPUT_BUDGET_EXCEEDED",
    budgetBytes,
    retry: "none",
  };
}

export function registerTriageTools(server: McpServer, client: KanonClient): void {
  // ── preview_issue_triage — DEFERRED, read-only ───────────────────────────

  server.tool(
    "preview_issue_triage",
    "Read-only prepare/validate triage preview for one issue. Deterministic prepare; host_assisted adds contextToken. No persistence.",
    PreviewIssueTriageInputShape.shape,
    READ_ANNOTATIONS,
    async (rawInput: unknown) => {
      const parsed = PreviewIssueTriageInput.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult(new Error(parsed.error.errors[0]?.message ?? "Invalid input"));
      }
      const input = parsed.data;
      const correlationId = correlationOrNew(input.correlationId);
      const format = input.format ?? "compact";
      const budget =
        format === "full" ? TRIAGE_PREVIEW_FULL_BUDGET_BYTES : TRIAGE_PREVIEW_COMPACT_BUDGET_BYTES;

      try {
        const body: Record<string, unknown> = { phase: input.phase, format };
        if (input.phase === "prepare") {
          body["aiIntent"] = input.aiIntent ?? "none";
          if (input.scope !== undefined) body["scope"] = input.scope;
        } else {
          body["contextToken"] = input.contextToken;
          body["hostOutcome"] = input.hostOutcome;
          if (input.suggestions !== undefined) body["suggestions"] = input.suggestions;
        }

        const result = await client.previewIssueTriage(input.issueKey, body, {
          timeoutMs: TRIAGE_PREVIEW_TIMEOUT_MS,
          correlationId,
        });
        return triageDataResult(enforceBudget(result, budget), correlationId);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── persist_triage_proposal — DEFERRED, write ────────────────────────────

  server.tool(
    "persist_triage_proposal",
    "Persist exact preview+seal as typed triage proposal. Create/dedupe only — no Issue mutation.",
    PersistTriageProposalInput.shape,
    WRITE_ANNOTATIONS,
    async (rawInput) => {
      const parsed = PersistTriageProposalInput.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult(new Error(parsed.error.errors[0]?.message ?? "Invalid input"));
      }
      const { issueKey, preview, previewSeal, retainedItemIds, supersedesId, correlationId: cid } =
        parsed.data;
      const correlationId = correlationOrNew(cid);
      try {
        const body: Record<string, unknown> = { preview, previewSeal };
        if (retainedItemIds !== undefined) body["retainedItemIds"] = retainedItemIds;
        if (supersedesId !== undefined) body["supersedesId"] = supersedesId;
        const result = await client.persistTriageProposal(issueKey, body, {
          timeoutMs: TRIAGE_PERSIST_TIMEOUT_MS,
          correlationId,
        });
        return triageDataResult(result, correlationId);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── get_triage_proposal — DEFERRED, read-only ────────────────────────────

  server.tool(
    "get_triage_proposal",
    "Get one triage proposal by UUID (compact/full). Disposed returns tombstone; non-executable.",
    GetTriageProposalInput.shape,
    READ_ANNOTATIONS,
    async ({ proposalId, format, correlationId: cid }) => {
      const correlationId = correlationOrNew(cid);
      try {
        const result = await client.getTriageProposal(proposalId, format ?? "compact", {
          timeoutMs: TRIAGE_GET_TIMEOUT_MS,
          correlationId,
        });
        return triageDataResult(enforceBudget(result, TRIAGE_GET_BUDGET_BYTES), correlationId);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── list_triage_proposals — DEFERRED, read-only ──────────────────────────

  server.tool(
    "list_triage_proposals",
    "List compact triage proposals for one required projectKey. Server-paginated; not workspace-wide.",
    ListTriageProposalsInput.shape,
    READ_ANNOTATIONS,
    async (rawInput) => {
      const parsed = ListTriageProposalsInput.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult(new Error(parsed.error.errors[0]?.message ?? "Invalid input"));
      }
      const { projectKey, state, targetIssueKey, generatorSource, degraded, limit, cursor, correlationId: cid } =
        parsed.data;
      const correlationId = correlationOrNew(cid);
      try {
        const result = await client.listTriageProposals(
          projectKey,
          { state, targetIssueKey, generatorSource, degraded, limit: limit ?? 20, cursor },
          { timeoutMs: TRIAGE_LIST_TIMEOUT_MS, correlationId },
        );
        return triageDataResult(enforceBudget(result, TRIAGE_LIST_BUDGET_BYTES), correlationId);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── dismiss_triage_proposal — DEFERRED, destructive write ────────────────

  server.tool(
    "dismiss_triage_proposal",
    "Dismiss one triage proposal with reason (1..1000 chars). Terminal, idempotent lifecycle write.",
    DismissTriageProposalInputShape.shape,
    DISMISS_ANNOTATIONS,
    async (rawInput) => {
      const parsed = DismissTriageProposalInput.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult(new Error(parsed.error.errors[0]?.message ?? "Invalid input"));
      }
      const { proposalId, reason, correlationId: cid } = parsed.data;
      const correlationId = correlationOrNew(cid);
      try {
        const result = await client.dismissTriageProposal(
          proposalId,
          { reason },
          { timeoutMs: TRIAGE_DISMISS_TIMEOUT_MS, correlationId },
        );
        return triageDataResult(enforceBudget(result, TRIAGE_DISMISS_BUDGET_BYTES), correlationId);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
