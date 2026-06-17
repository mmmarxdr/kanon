# mcp-issue-management Specification

## Purpose

Define the contract of the Kanon MCP server's issue-management tools (`kanon_create_issue`, `kanon_update_issue`, plus their lifecycle peers) and the heartbeat that keeps `WorkSession` presence alive from the client side. The requirements here ensure the MCP layer's input validation matches the API's UUID contract and that the heartbeat loop is robust against transient network failures without masking genuine session expiry or auth drift.

These requirements were hardened in the `work-session-resilience` change (Slice A):

- `CreateIssueInput` / `UpdateIssueInput` accept empty strings as a clear (`""` → `undefined`/`null`) for UUID fields, matching the API's `z.string().uuid().nullable().optional()` schema.
- The MCP heartbeat applies ±20% jitter to its base interval and retries transient failures exactly once with a 1 s backoff, while remaining a no-op on terminal signals (HTTP 404 / 401).

## Requirements

### Requirement: Optional UUID Fields Accept Empty Strings as Cleared

The MCP `CreateIssueInput` and `UpdateIssueInput` Zod schemas MUST accept UUID fields as either a valid UUID string, `null`, or absent. An empty string (`""`) MUST be normalized to `null`/omitted during validation rather than rejected with a ZodError.

UUID fields covered: `assigneeId`, `cycleId`, `parentId` (in `CreateIssueInput`); `assigneeId`, `cycleId`, `parentId`, `roadmapItemId` (in `UpdateIssueInput`).

The wire contract between MCP and API MUST match the API's existing `z.string().uuid().nullable().optional()` schema. An MCP agent passing `""`, `null`, or omitting the field MUST NOT receive a 400 from the API for that reason.

#### Scenario: Empty string `assigneeId` is accepted on create

- GIVEN an MCP tool call to `kanon_create_issue`
- WHEN the input includes `assigneeId: ""`
- THEN validation passes
- AND the request reaches the API with `assigneeId` cleared (not as an empty string)
- AND the API returns a successful response

#### Scenario: `null` `cycleId` detaches on update

- GIVEN an issue currently attached to a cycle
- WHEN `kanon_update_issue` is called with `cycleId: null`
- THEN the issue is detached from the cycle
- AND no ZodError is raised

#### Scenario: Non-UUID string is still rejected

- GIVEN an MCP tool call to `kanon_create_issue`
- WHEN the input includes `assigneeId: "not-a-uuid"`
- THEN validation fails with a clear, agent-readable error
- AND the API is NOT called

### Requirement: Heartbeat Uses Jittered Interval and Bounded Retry

The MCP heartbeat loop MUST apply a per-fire jitter of `±20%` to the base heartbeat interval, so heartbeats from multiple concurrent MCP processes do not synchronize against the API.

On a transient heartbeat failure (network error, 5xx other than 404/401), the heartbeat scheduler MUST retry exactly one time with a backoff of `1 second`. If that retry also fails, the heartbeat interval for that session MUST be cleared (silent give-up) and the failure MUST be reported to `console.error` with a structured log line containing `issueKey` and the failure reason.

The heartbeat scheduler MUST NOT retry on HTTP `404` (session already gone — expiry is terminal) or on HTTP `401` (auth boundary — retrying will not help and may indicate credential drift).

#### Scenario: Heartbeat interval falls within jitter bounds

- GIVEN the base heartbeat interval is `2 * 60 * 1000` ms
- WHEN a heartbeat tick is scheduled
- THEN the effective delay is within `[0.8 * interval, 1.2 * interval]`

#### Scenario: Transient 5xx triggers one retry, then gives up

- GIVEN an active heartbeat timer for `issueKey`
- WHEN the first heartbeat call returns a transient 5xx
- THEN exactly one retry is scheduled after `1_000` ms
- AND if the retry also fails, the heartbeat timer is cleared
- AND a `console.error` log line is emitted containing `issueKey` and the failure reason

#### Scenario: 404 is not retried

- GIVEN an active heartbeat timer for `issueKey`
- WHEN the heartbeat call returns HTTP 404
- THEN no retry is attempted
- AND the heartbeat timer is cleared
- AND a `console.error` log line is emitted

#### Scenario: 401 is not retried

- GIVEN an active heartbeat timer for `issueKey`
- WHEN the heartbeat call returns HTTP 401
- THEN no retry is attempted
- AND the heartbeat timer is cleared
- AND a `console.error` log line is emitted