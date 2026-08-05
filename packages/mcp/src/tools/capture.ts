// ─── Capture Tools ────────────────────────────────────────────────────────────
//
// MCP tools for incident capture and estimation proposals.
// Both tools are DEFERRED (not CORE) to protect the MCP description budget.
//
// report_incident (AC4):
//   One-call composition: creates an incident-type issue + starts a work session.
//   Per KAN-103, startWork performs the implicit session switch + Interruption
//   record when another session is active.
//
// propose_estimate + apply_proposal (AC1):
//   Estimation is judgment-bearing: agent PROPOSES, dev CONFIRMS — never
//   auto-accepted (PRD-0004, ADR-0005 D7). Uses McpProposal flow with
//   kind:"generic" and a typed payload { kind:"estimate", issueKey, estimateHours }.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { errorResult, dataResult } from "../errors.js";

// ─── Deferred tool names ──────────────────────────────────────────────────────

/**
 * Capture tools that should be deferred behind ToolSearch.
 * Incident reporting and estimation proposals are occasion-only —
 * not part of the daily board flow — keeping dev-agent context lean.
 */
export const CAPTURE_DEFERRED_TOOLS = [
  "report_incident",
  "propose_estimate",
  "apply_proposal",
] as const;

// ─── Input Schemas ─────────────────────────────────────────────────────────

const ReportIncidentInput = z.object({
  projectKey: z.string().describe("Project key (e.g. 'KAN')"),
  title: z.string().min(1).max(200).describe("Issue title: [Area] imperative verb phrase"),
  description: z.string().optional().describe("Optional incident description"),
  groupKey: z.string().optional().describe("Optional group key (call list_groups first)"),
  via: z.string().optional().describe("Work-session source identifier (default: 'mcp'); applies to the session, not the issue record"),
});

const ProposeEstimateInput = z.object({
  workspaceId: z.string().uuid().describe("Workspace ID (call list_workspaces to obtain it)"),
  issueKey: z.string().describe("Issue key to estimate (e.g. 'KAN-42')"),
  estimateHours: z.number().positive().describe("Proposed estimate in hours"),
  rationale: z.string().max(1000).optional().describe("Optional rationale for the estimate"),
});

const ApplyProposalInput = z.object({
  proposalId: z.string().uuid().describe("Pending proposal ID to apply (developer confirmation)"),
});

// ─── Registration ──────────────────────────────────────────────────────────

export function registerCaptureTools(server: McpServer, client: KanonClient): void {
  // ── report_incident — DEFERRED ────────────────────────────────────

  server.tool(
    "report_incident",
    "Create incident issue in projectKey + start work session. Forces type:incident. Returns {ok,issueKey,sessionId}. Auto-switches active session (KAN-103).",
    ReportIncidentInput.shape,
    async ({ projectKey, title, description, groupKey, via }) => {
      // Step 1: create the incident issue
      let issue: { key: string; id: string };
      try {
        const body: Record<string, unknown> = { title, type: "incident" };
        if (description !== undefined) body["description"] = description;
        if (groupKey !== undefined) body["groupKey"] = groupKey;
        issue = (await client.createIssue(projectKey, body)) as { key: string; id: string };
      } catch (err) {
        return errorResult(err);
      }

      // Step 2: start work on the newly created issue
      // If startWork fails, surface a clear error naming the created issue key
      // so the incident issue isn't silently orphaned.
      try {
        const sessionResult = await client.startWork(issue.key, via ?? "mcp");
        const session = (sessionResult.session ?? {}) as Record<string, unknown>;
        return dataResult({
          ok: true,
          issueKey: issue.key,
          sessionId: session["id"] ?? null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return errorResult(
          new Error(
            `Incident issue ${issue.key} was created but starting the work session failed: ${message}. ` +
            `Use start_work with issue_key: "${issue.key}" to start tracking manually.`,
          ),
        );
      }
    },
  );

  // ── propose_estimate — DEFERRED ────────────────────────────────────

  server.tool(
    "propose_estimate",
    "Propose estimate for issueKey (confirm via apply_proposal). Pending generic; re-propose while pending → 409. Not triage.",
    ProposeEstimateInput.shape,
    async ({ workspaceId, issueKey, estimateHours, rationale }) => {
      try {
        const body: Record<string, unknown> = {
          kind: "generic",
          title: `Estimate ${issueKey} at ${estimateHours} hour${estimateHours === 1 ? "" : "s"}`,
          // targetRef ties the dedup index (KAN-116) to the issue so a second
          // pending estimate for the same issue is rejected with 409.
          targetRef: `estimate:${issueKey}`,
          payload: {
            kind: "estimate",
            issueKey,
            estimateHours,
          },
        };
        if (rationale !== undefined) body["reason"] = rationale;

        const proposal = await client.createProposal(workspaceId, body);
        return dataResult(proposal);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── apply_proposal — DEFERRED ─────────────────────────────────────

  server.tool(
    "apply_proposal",
    "Apply pending legacy proposalId (dev confirm). Not for triage proposals — those are non-executable.",
    ApplyProposalInput.shape,
    async ({ proposalId }) => {
      try {
        const result = await client.applyProposal(proposalId);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
