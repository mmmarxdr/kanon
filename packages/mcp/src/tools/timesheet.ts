// ─── Timesheet Tools ──────────────────────────────────────────────────────────
//
// MCP tools for timesheet capture: list worklogs, promote to time entry,
// update / submit / approve / reject / adjust time entries.
// All role enforcement is API-side; MCP surfaces errors (incl. 403) as errorResult.
//
// PM-only tools (approve, reject) are declared in TIMESHEET_DEFERRED_TOOLS so
// hosts can hide them from eager context via ToolSearch.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KanonClient } from "../kanon-client.js";
import { errorResult, dataResult } from "../errors.js";

// ─── Deferred tool names (PM-only, declared for host ToolSearch hiding) ──────

/**
 * Timesheet tools that should be deferred behind ToolSearch.
 * PM-gated on the API side — keeping them out of eager context keeps
 * dev-agent context lean.
 */
export const TIMESHEET_DEFERRED_TOOLS = [
  "kanon_approve_time_entry",
  "kanon_reject_time_entry",
] as const;

// ─── Hours regex (mirrors API schema.ts) ──────────────────────────────────
// HoursRegex: non-negative decimal, ≤2dp, max 999999.99
// SignedHoursRegex: same but allows leading minus for adjustments

const HoursRegex = /^\d{1,6}(\.\d{1,2})?$/;
const SignedHoursRegex = /^-?\d{1,6}(\.\d{1,2})?$/;

// ─── Input Schemas ─────────────────────────────────────────────────────────

const ListMyWorklogsInput = z.object({
  workspaceId: z.string().uuid().describe("Workspace ID to scope the worklog list (required)"),
  from: z.string().datetime().optional().describe("ISO datetime lower bound (inclusive)"),
  to: z.string().datetime().optional().describe("ISO datetime upper bound (inclusive)"),
  limit: z.number().int().positive().max(200).optional().describe("Max results (default 50)"),
});

export const PromoteWorklogInput = z.object({
  worklogId: z.string().uuid().describe("WorkLog ID to promote to a draft TimeEntry"),
  hours: z
    .string()
    .regex(HoursRegex, "non-negative decimal, ≤2dp, max 999999.99")
    .optional()
    .describe("Override hours (decimal string, e.g. '2.00')"),
  issueId: z.string().uuid().optional().describe("Override issueId for the time entry"),
  workedOn: z.string().datetime().optional().describe("Override workedOn datetime"),
});

export const UpdateTimeEntryInput = z.object({
  timeEntryId: z.string().uuid().describe("Time entry ID to update (must be draft or submitted)"),
  hours: z
    .string()
    .regex(HoursRegex, "non-negative decimal, ≤2dp, max 999999.99")
    .optional()
    .describe("New hours value (decimal string, e.g. '3.50')"),
  issueId: z.string().uuid().nullable().optional().describe("New issueId (null to unlink)"),
  workedOn: z.string().datetime().optional().describe("New workedOn datetime"),
});

const SubmitTimeEntryInput = z.object({
  timeEntryId: z.string().uuid().describe("Time entry ID to submit for approval"),
});

const ApproveTimeEntryInput = z.object({
  timeEntryId: z.string().uuid().describe("Time entry ID to approve (PM role required)"),
});

const RejectTimeEntryInput = z.object({
  timeEntryId: z.string().uuid().describe("Time entry ID to reject (PM role required)"),
  reason: z.string().max(500).optional().describe("Optional rejection reason"),
});

export const AdjustTimeEntryInput = z.object({
  timeEntryId: z.string().uuid().describe("Approved time entry ID to create an adjustment for"),
  hours: z
    .string()
    .regex(SignedHoursRegex, "signed decimal, ≤2dp, magnitude max 999999.99")
    .describe("Adjustment hours (signed decimal string, e.g. '-1.00' or '0.50')"),
  workedOn: z.string().datetime().describe("workedOn datetime for the adjustment (required)"),
  issueId: z.string().uuid().nullable().optional().describe("Override issueId for the adjustment"),
});

// ─── Registration ──────────────────────────────────────────────────────────

export function registerTimesheetTools(server: McpServer, client: KanonClient): void {
  // ── kanon_list_my_worklogs ────────────────────────────────────────────────

  server.tool(
    "kanon_list_my_worklogs",
    "List own WorkLogs in workspaceId. Use IDs with kanon_promote_worklog. Filters: from,to (ISO),limit.",
    ListMyWorklogsInput.shape,
    async ({ workspaceId, from, to, limit }) => {
      try {
        const result = await client.listMyWorklogs(workspaceId, from, to, limit);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── kanon_promote_worklog ─────────────────────────────────────────────────

  server.tool(
    "kanon_promote_worklog",
    "Promote WorkLog worklogId to a draft TimeEntry (idempotent). Optional hours/issueId/workedOn override service defaults.",
    PromoteWorklogInput.shape,
    async ({ worklogId, hours, issueId, workedOn }) => {
      try {
        const body: Record<string, unknown> = {};
        if (hours !== undefined) body["hours"] = hours;
        if (issueId !== undefined) body["issueId"] = issueId;
        if (workedOn !== undefined) body["workedOn"] = workedOn;
        const result = await client.promoteWorklog(worklogId, body);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── kanon_update_time_entry ───────────────────────────────────────────────

  server.tool(
    "kanon_update_time_entry",
    "Patch draft/submitted TimeEntry timeEntryId (owner-only). Partial: supply only changed fields (hours,issueId,workedOn).",
    UpdateTimeEntryInput.shape,
    async ({ timeEntryId, hours, issueId, workedOn }) => {
      try {
        const body: Record<string, unknown> = {};
        if (hours !== undefined) body["hours"] = hours;
        if (issueId !== undefined) body["issueId"] = issueId;
        if (workedOn !== undefined) body["workedOn"] = workedOn;
        const result = await client.updateTimeEntry(timeEntryId, body);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── kanon_submit_time_entry ───────────────────────────────────────────────

  server.tool(
    "kanon_submit_time_entry",
    "Submit draft TimeEntry timeEntryId for PM approval (owner-only). Status: draft→submitted.",
    SubmitTimeEntryInput.shape,
    async ({ timeEntryId }) => {
      try {
        const result = await client.submitTimeEntry(timeEntryId);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── kanon_approve_time_entry — DEFERRED (PM-only) ─────────────────────────

  server.tool(
    "kanon_approve_time_entry",
    "Approve submitted TimeEntry timeEntryId — PM role required (403 otherwise). Status: submitted→approved.",
    ApproveTimeEntryInput.shape,
    async ({ timeEntryId }) => {
      try {
        const result = await client.approveTimeEntry(timeEntryId);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── kanon_reject_time_entry — DEFERRED (PM-only) ──────────────────────────

  server.tool(
    "kanon_reject_time_entry",
    "Reject submitted TimeEntry timeEntryId — PM role required (403 otherwise). Optional reason stored on entry.",
    RejectTimeEntryInput.shape,
    async ({ timeEntryId, reason }) => {
      try {
        const body: Record<string, unknown> = {};
        if (reason !== undefined) body["reason"] = reason;
        const result = await client.rejectTimeEntry(timeEntryId, body);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  // ── kanon_adjust_time_entry ───────────────────────────────────────────────

  server.tool(
    "kanon_adjust_time_entry",
    "Create adjustment TimeEntry for approved timeEntryId (owner-only). hours signed ('-1.00' reduces, '0.50' adds), workedOn required. Original must be approved.",
    AdjustTimeEntryInput.shape,
    async ({ timeEntryId, hours, workedOn, issueId }) => {
      try {
        const body: Record<string, unknown> = { hours, workedOn };
        if (issueId !== undefined) body["issueId"] = issueId;
        const result = await client.adjustTimeEntry(timeEntryId, body);
        return dataResult(result);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
