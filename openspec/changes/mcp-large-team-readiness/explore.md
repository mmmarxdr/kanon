# MCP large-team readiness — exploration

> Phase: `sdd-explore` · Read-only audit · Source baseline: isolated worktree at the requested current checkout (authoritative source, not older audit counts)

## Executive answer

**Triage is likely the right first product capability, but not as one autonomous mutation tool.** The highest-value first slice is a read-only, evidence-bearing triage recommendation that can become a typed proposal and then an atomic, permission-checked apply operation. It should sit above reusable search, issue-update, dependency, schedule/capacity, and proposal primitives. Do not begin with an AI tool that silently changes priority, ownership, duplicates, or cycles.

The current MCP is a real but narrow board/work-capture adapter: **44 registered tools, 26 core and 18 deferred**, backed by a REST API and Prisma domain services. It has useful composability, response-tier/token work, RBAC enforcement in the API, provenance, proposal storage, event/SSE plumbing, and several idempotent/transactional paths. It is not yet large-team ready because queue-scale retrieval is client-side, triage fields and duplicate/merge semantics are absent, issue dependencies and PPM/portfolio reads are not exposed through MCP, proposal apply is status-only, and multi-step writes have inconsistent concurrency/partial-failure contracts.

## Method and evidence limits

- Registration was reconciled from every `server.tool(` call in `packages/mcp/src/tools/*.ts`, the registration calls in `packages/mcp/src/index.ts`, the description parser test, and domain-local tests. The parser test in `packages/mcp/src/tools/descriptions.test.ts:56-60` expects 44; counting source registrations also yields 44. The runtime banner derives `_registeredTools` rather than using a literal (`index.ts` startup block).
- The requested CodeGraph tool was not available in this executor interface. I did not claim to use it; I reconstructed the symbol/file graph by direct source reads and recorded this as a process risk. The architecture docs corroborate the resulting graph (`docs/architecture/overview.mdx`, `docs/architecture/runtime-flows.mdx`, `docs/modules/mcp.mdx`).
- No board lookup or ticket mutation was performed. Historical repository audits were treated as context only: `docs/ai-integration-review-2026-06.md` still says 38 tools, while current source/tests say 44.
- No implementation, test, product-file change, commit, push, or PR was made.

## 1. Authoritative inventory: all 44 registered tools

Every handler returns MCP JSON text through `dataResult` or `errorResult` (`packages/mcp/src/errors.ts`). “Read” and “write” below describe domain mutation, not HTTP verb alone. `format` tiers are local MCP transforms; raw means the API response is passed through.

### Workspace, project, issue, grouping, planning

| # | Tool | Intent / input shape | Output tier | API route → service | R/W |
|---:|---|---|---|---|---|
| 1 | `kanon_list_workspaces` | `format?: compact\|slim\|full` | list; compact default, local allowlist | `GET /api/workspaces` → workspace list service | R |
| 2 | `kanon_list_projects` | required `workspaceId`; `format`, `limit`, `offset` | list; compact default; local slice | `GET /api/workspaces/:wid/projects` → `projectService.listProjects` | R |
| 3 | `kanon_get_project` | optional `projectKey` (falls back to `.kanon` binding); `format` | entity; slim default/full opt-in | `GET /api/projects/:key` → `projectService.getProject` | R |
| 4 | `kanon_create_project` | `workspaceId,key,name,description?,format?` | write ack `{ok,id,key,name}` default; slim/full opt-in | `POST /api/workspaces/:wid/projects` → `projectService.createProject` | W |
| 5 | `kanon_update_project` | `projectKey?`, `name?`, `description?`, `format?` | write ack default; slim/full opt-in | `PATCH /api/projects/:key` → `projectService.updateProject` | W |
| 6 | `kanon_list_groups` | `projectKey?`; `format`, `limit`, `offset` | compact group table default; local slice | `GET /api/projects/:key/issues/groups` → `issueService.listIssueGroups` (aggregate) | R |
| 7 | `kanon_batch_transition` | `projectKey?`, exactly one of `groupKey` or `keys[]`, `state`, `format?`; handler manually runs refined Zod parse | ack `{ok,count,keys}` default; full raw | group: `PATCH /api/projects/:key/issues/groups/:groupKey/transition`; keys: `POST /api/projects/:key/issues/batch-transition` → `issueService.transitionGroup` / `batchTransitionByKeys` | W/bulk |
| 8 | `kanon_list_issues` | `projectKey?`; `state,type,priority,assigneeId,cycleId,label,groupKey,keys[]`; `format,limit,offset` | compact table default, slim/full list opt-in; local pagination after full API response | `GET /api/projects/:key/issues` → `issueService.listIssues` | R |
| 9 | `kanon_get_issue` | `issueKey`, `format?: slim\|full\|compact` | slim detail default/full raw opt-in (`compact` behaves as non-full entity) | `GET /api/issues/:key` → `issueService.getIssue` | R |
| 10 | `kanon_create_issue` | `projectKey?`, `title`, `description?`, `type?`, `priority?`, `labels?`, `groupKey?`, `assigneeId?`, `cycleId?`, `parentId?`, `template?`, `format?` | write ack `{ok,id,key}` default; slim/full opt-in | `POST /api/projects/:key/issues` → `issueService.createIssue` | W |
| 11 | `kanon_update_issue` | `issueKey`; `title?,description?,priority?,labels?,assigneeId?,cycleId?,roadmapItemId?`, `format?` | write ack default; slim/full opt-in | `PATCH /api/issues/:key` → `issueService.updateIssue` | W |
| 12 | `kanon_transition_issue` | `issueKey,state` (`backlog,analysis,todo,in_progress,review,done`), `format?` | write ack default; slim/full opt-in; special structured 409 guidance for done/time | `POST /api/issues/:key/transition` → `issueService.transitionIssue` | W |
| 13 | `kanon_reconcile_time` | `issueKey`, optional `confirmedTotalHours` | raw reconciliation summary | `POST /api/issues/:key/reconcile-time` → `reconcileIssueTime` | W |
| 14 | `kanon_list_roadmap` | `projectKey?`; `horizon,status,label`; `format,limit,offset` | compact default; local pagination | `GET /api/projects/:key/roadmap` → `roadmapService.listRoadmapItems` | R |
| 15 | `kanon_create_roadmap_item` | `projectKey?`, `title`, `description?`, `horizon?`, `status?`, `effort?`, `impact?`, `labels?`, `sortOrder?`, `targetDate?`, `format?` | write ack default; slim/full opt-in | `POST /api/projects/:key/roadmap` → `roadmapService.createRoadmapItem` | W |
| 16 | `kanon_update_roadmap_item` | `projectKey?`, `itemId`, same mutable fields as create, `format?` | write ack default; slim/full opt-in | `PATCH /api/projects/:key/roadmap/:id` → `roadmapService.updateRoadmapItem` | W |
| 17 | `kanon_delete_roadmap_item` | `projectKey?`, `itemId` | `{deleted:true,itemId}` | `DELETE /api/projects/:key/roadmap/:id` → `roadmapService.deleteRoadmapItem` | W/destructive |
| 18 | `kanon_promote_roadmap_item` | `projectKey?`, `itemId`; issue `title?,type?,priority?,labels?,groupKey?`, `format?` | issue ack default; slim/full opt-in | `POST /api/projects/:key/roadmap/:id/promote` → `roadmapService.promoteToIssue` | W/composite |
| 19 | `kanon_add_dependency` | `projectKey?`, roadmap `sourceItemId,targetItemId`, dependency `type?`, `format?` | dependency ack `{ok,id,projectId}` default; full raw | `POST /api/projects/:key/roadmap/:id/dependencies` → `roadmapService.addDependency` | W |
| 20 | `kanon_remove_dependency` | `projectKey?`, roadmap `sourceItemId,dependencyId` | `{ok:true,deleted:true,dependencyId}` | `DELETE /api/projects/:key/roadmap/:id/dependencies/:depId` → `roadmapService.removeDependency` | W |

### Work sessions, cycles, documents

| # | Tool | Intent / input shape | Output tier | API route → service | R/W |
|---:|---|---|---|---|---|
| 21 | `kanon_start_work` | `issue_key` (snake case) | custom ack `{ok,sessionId,action:"started"}`; starts MCP heartbeat | `POST /api/issues/:key/work-sessions` → `workSessionService.startWork` | W/composite |
| 22 | `kanon_stop_work` | `issue_key` | custom ack `{ok,deleted,issueKey,logged,durationSeconds?}`; stops heartbeat first | `DELETE /api/issues/:key/work-sessions` → `workSessionService.stopWork` | W/composite |
| 23 | `kanon_who_is_working` | `issue_key` | human-readable text, not structured list | `GET /api/issues/:key/work-sessions` → `workSessionService.getActiveWorkers` | R |
| 24 | `kanon_list_cycles` | `projectKey?`; `format?` | compact cycle table default; no local limit/offset | `GET /api/projects/:key/cycles` → `cycleService.listCycles` | R |
| 25 | `kanon_get_cycle` | `cycleId`; `includeAllScopeEvents?`, `format?` | slim detail default/full raw; API caps scope events to recent 20 unless explicitly all | `GET /api/cycles/:id` → `cycleService.getCycle` | R |
| 26 | `kanon_create_cycle` | `projectKey?`, `name`, `goal?`, dates, `state?`, `attachIssueKeys?`, `format?` | cycle ack default; slim/full entity | `POST /api/projects/:key/cycles` → `cycleService.createCycle` | W/composite |
| 27 | `kanon_attach_issues_to_cycle` | `cycleId`; `add?`, `remove?`, optional audit `reason`, `format?` | cycle-attach ack default; slim/full cycle detail | `POST /api/cycles/:id/issues` → `cycleService.attachIssues` | W |
| 28 | `kanon_close_cycle` | `cycleId`, disposition `move_to_next\|move_to_backlog\|leave`, optional `projectKey`, `reason`, `format?` | cycle-close ack default; slim/full composite | orchestrates `GET /api/cycles/:id`, `GET /api/projects/:key/cycles`, one or more `POST /api/cycles/:id/issues`, then `POST /api/cycles/:id/close` via `closeCycleWithDisposition` → `cycleService` | W/multi-step |
| 29 | `kanon_delete_cycle` | `cycleId`, `force?`, `reason?`, `format?` | string tiers: ack header; slim detached keys; full IDs/auditLogId | `DELETE /api/cycles/:id` → `cycleService.deleteCycle` / `delete-cycle.ts` | W/destructive |
| 30 | `kanon_create_document` | `issueKey,kind,title,body` | ack only `{ok,id,issueKey,kind}`; no full option | `POST /api/issues/:key/documents` → `documentService.createDocument` | W |
| 31 | `kanon_list_documents` | `issueKey` | raw document array | `GET /api/issues/:key/documents` → `documentService.listDocuments` | R |
| 32 | `kanon_get_document` | `documentId` | raw document | `GET /api/documents/:id` → document route re-fetch with author | R |

### Timesheet, members, comments, capture/proposals

| # | Tool | Intent / input shape | Output tier | API route → service | R/W |
|---:|---|---|---|---|---|
| 33 | `kanon_list_my_worklogs` | `workspaceId`, optional ISO `from,to`, `limit` | raw `{worklogs,totalDurationS}`; API default limit 50 | `GET /api/me/worklogs` → work-session route/Prisma query | R |
| 34 | `kanon_promote_worklog` | `worklogId`, optional `hours,issueId,workedOn` | raw serialized TimeEntry; API idempotent on source WorkLog | `POST /api/worklogs/:id/promote` → `timesheetService.promoteWorkLog` | W |
| 35 | `kanon_update_time_entry` | `timeEntryId`, optional patch `hours,issueId,workedOn` | raw serialized TimeEntry | `PATCH /api/time-entries/:id` → `timesheetService.updateEntry` | W |
| 36 | `kanon_submit_time_entry` | `timeEntryId` | raw serialized TimeEntry | `POST /api/time-entries/:id/submit` → `timesheetService.submitEntry` | W |
| 37 | `kanon_approve_time_entry` | `timeEntryId`; PM gate in API | raw serialized TimeEntry; deferred | `POST /api/time-entries/:id/approve` → atomic `timesheetService.approveEntry` | W/approval |
| 38 | `kanon_reject_time_entry` | `timeEntryId`, optional `reason` (the service currently ignores the body) | raw serialized TimeEntry; deferred | `POST /api/time-entries/:id/reject` → atomic `timesheetService.rejectEntry` | W/approval |
| 39 | `kanon_adjust_time_entry` | approved `timeEntryId`, signed `hours`, `workedOn`, optional `issueId` | raw serialized adjustment TimeEntry | `POST /api/time-entries/:id/adjust` → `timesheetService.createAdjustment` | W |
| 40 | `kanon_list_members` | `projectKey` | raw `{members:[userId,email,displayName,role,source...]}`; deferred | `GET /api/projects/:key/members` → project-member route/service | R |
| 41 | `kanon_comment_issue` | `issueKey,body` | raw comment; source forced to `mcp`, provenance header is separate; deferred | `POST /api/issues/:key/comments` → `commentService.createComment` | W |
| 42 | `kanon_report_incident` | `projectKey,title,description?,groupKey?,via?` | custom `{ok,issueKey,sessionId}`; create issue then start session; deferred | `POST /api/projects/:key/issues`, then `POST /api/issues/:key/work-sessions` → issue/work-session services | W/multi-step |
| 43 | `kanon_propose_estimate` | `workspaceId,issueKey,estimateHours,rationale?` | raw `McpProposal`; deferred; `targetRef=estimate:<issueKey>` deduplicates pending generic proposals | `POST /api/workspaces/:id/proposals` → `mcp-proposal` route/Prisma | W/proposal |
| 44 | `kanon_apply_proposal` | `proposalId` | raw proposal row with status `applied`; deferred | `POST /api/proposals/:id/apply` → `mcp-proposal` route/Prisma | W/approval |

### Count and test reconciliation

- `packages/mcp/src/index.ts` imports and calls 11 domain registrars: projects, groups, issues, roadmap, work sessions, cycles, documents, timesheet, members, comments, capture.
- Source registration totals: projects 5 + groups 2 + issues 6 + roadmap 7 + work sessions 3 + cycles 6 + documents 3 + timesheet 7 + members 1 + comments 1 + capture 3 = **44**.
- `packages/mcp/src/tools/descriptions.test.ts:56-60` parses exactly 44 non-test tool registrations. Domain tests assert local registration (for example `projects.test.ts:50-58`, `timesheet.test.ts:86-97`, `capture.test.ts:78-87`, `issues.test.ts` reconcile flow) and mocked-client behavior. There is no single test that compares the 44 names against runtime `_registeredTools`, no API-route parity test, and no schema inventory test.
- `DEFERRED_TOOLS` in `packages/mcp/src/instructions.ts:27-49` contains 18 names; the 26 remaining are core. `instructions.test.ts:25-31` checks the 18-entry contract and `:94-96` checks name discoverability. The comments in `instructions.ts` still say “all 40 tools”, while the historical prose in `baseline.fixture.ts` and `docs/ai-integration-review-2026-06.md` contains 38/40/43-era counts. Those are documentation drift signals, not missing current registrations.
- Description budget is intentionally bounded: `descriptions.test.ts:67-71` requires a 30% reduction against a 7600-byte historical baseline; `:102-106` requires the fixed baseline fixture ceiling. The current strategy is deferred tools + `format`/allowlist transforms, not server-side field selection.

## 2. End-to-end architecture and call flow

```text
MCP host over stdio
  -> McpServer / ListTools + CallTool (packages/mcp/src/index.ts)
  -> registered handler (packages/mcp/src/tools/*.ts)
  -> KanonClient method (packages/mcp/src/kanon-client.ts)
  -> fetch: Bearer JWT, optional X-Kanon-Client, 10s AbortSignal timeout
  -> Fastify app/plugins (auth, provenance, CSRF, metrics, rate limit, errors)
  -> route preHandler (workspace/project/issue/cycle/dependency scope + role)
  -> module service
  -> Prisma/PostgreSQL transaction and domain model
  -> ActivityLog / AdminAuditLog where implemented
  -> in-process EventBus (fire-and-forget listeners) -> workspace SSE -> MCP local cache/web
  -> JSON response -> MCP CallToolResult text
```

Exact evidence:

1. **Registration/schema:** `packages/mcp/src/index.ts` constructs `McpServer({name:"kanon-mcp",version,instructions})`, wraps `server.tool` with `wrapHandlerWithActivity`, then calls all 11 registrars. Schemas live in `packages/mcp/src/types.ts` plus local tool schemas; the MCP SDK receives Zod `.shape` objects, so refinements that are not in `.shape` need manual parsing (the batch transition handler explicitly does this).
2. **Client boundary:** `KanonClient` in `packages/mcp/src/kanon-client.ts` owns URL building and all REST calls. `doRequest` sends `Accept`, Bearer auth, JSON bodies, optional `X-Kanon-Client`, and a 10-second timeout. `request` retries a 401 once after `/api/auth/exchange`, with a single-flight refresh latch; non-401 transient errors are not retried. `KanonApiError` preserves status, code, and parsed `details`; `errors.ts:errorResult` exposes only status/code/message to MCP callers.
3. **API composition:** `packages/api/src/app.ts:211-238` mounts the feature routes. It registers auth, via, CSRF, metrics and EventBus infrastructure before feature routes. `docs/architecture/overview.mdx` confirms API is the system of record and MCP does not access Prisma.
4. **Authorization:** `packages/api/src/middleware/require-role.ts` defines `ROLE_HIERARCHY = viewer < member < pm < admin < owner`, resolves project membership/effective role, and enforces `allowedProjectIds` before owner/admin bypass. Issue/cycle/dependency-specific gates resolve the project before calling the service. This is a strong API-side boundary; MCP should not duplicate it.
5. **Issue write path:** `packages/api/src/modules/issue/routes.ts` dispatches to `issueService.createIssue/listIssues/getIssue/updateIssue/transitionIssue/listIssueGroups/transitionGroup/batchTransitionByKeys`; `issue/schema.ts` validates states/types/priority and query filters; `issue/service.ts` writes `Issue`, `ActivityLog`, cycle scope events, subscriptions and emits `issue.*` events. Issue creation atomically increments the project sequence counter, but downstream failure can leave a sequence gap by design.
6. **Planning/capture path:** roadmap and cycle routes/services write `RoadmapItem`, `RoadmapDependency`, `Cycle`, `CycleScopeEvent`, and issue links. Work sessions write `WorkSession`, then `WorkLog` on explicit stop/expiry; timesheet promotes to `TimeEntry`, with immutable approved entries and adjustment rows. Schedule/forecast/milestone/typed issue-dependency services exist below the API boundary but are not MCP-registered.
7. **Events/SSE:** `packages/api/src/services/event-bus/types.ts` defines issue, work, schedule, estimate, dependency, interruption, proposal-adjacent and forecast events. `in-process.ts` uses a synchronous EventEmitter with a 1000-event replay buffer and subscriber error counter. `modules/events/workspace-events.ts` exposes `GET /api/events/workspace/:wid`, 30-second heartbeats and `Last-Event-ID` replay. `packages/mcp/src/sse-client.ts` reconnects with exponential backoff and caches only 200 events; the current MCP tools do not expose a generic event/query tool, though `get_issue` has a local recent-event seam in comments.
8. **Derived data:** `app.ts` wires notification, forecast, and work-session transition listeners. `docs/architecture/ppm-engine.md` describes L0 capture → L1 human-gated canonical facts → L2 derived forecast/read-model → L3 reads. The EventBus is process-local and not a durable queue; the docs explicitly call out durable delivery/retry/DLQ as future work.

## 3. Large-team readiness assessment

| Dimension | Current evidence / composable path | Readiness gap and implication |
|---|---|---|
| Intake and triage | Create issue supports title template, type, priority, labels, group, assignee, cycle, parent; `report_incident` composes create + start. Group lookup is an explicit instruction prerequisite. | No inbox/queue abstraction, intake source, required triage metadata, SLA clock, triage state, or reviewer workflow. Agents can create cards but cannot consistently classify/rank/reroute a shared queue. |
| Duplicate detection/consolidation | `list_issues` can filter by fields/keys; API has `q` title/key search (`issue/schema.ts`) but MCP does not expose it. Agent can list then get individual issues. | No semantic candidate endpoint, duplicate relation, canonical/duplicate status, merge/reparent/redirect operation, or conflict policy. Consolidation cannot be safe or auditable. |
| Priority/severity/impact/urgency | `Issue.priority` has critical/high/medium/low; roadmap has effort/impact; update can change priority. | Severity, customer/business impact, urgency, confidence, risk and SLA due time are not Issue fields or MCP inputs. Priority alone cannot support large-team incident/product triage. |
| Routing/ownership | `groupKey`, `assigneeId`, labels and `kanon_list_members`; API has effective project/workspace roles. | No team entity, expertise/capability taxonomy, routing rules, on-call rotation, ownership confidence, or capacity-aware assignment. Group keys are free-form and no label/team enumeration exists. |
| Assignment, capacity, cycles | Active worker listing and single-worker conflict are implemented; cycles have scope/velocity/burnup/risks; schedule/forecast/milestone API modules and `IssueSchedule`, `IssueForecast`, `Milestone` models exist. | MCP cannot read schedule, forecast, portfolio health, milestones, typed issue dependencies, or capacity. Cycle attachment is useful but not enough to answer “who can take this and when?” |
| Dependencies/portfolio | Roadmap dependency tools prevent cycles for `RoadmapDependency`. | API has richer `IssueDependency` (`blocks`, FS/SS/FF/SF, lagDays), but MCP has no issue dependency tools. No workspace portfolio/read-model surface is mounted into MCP; `ppm-foundation/proposal.md` describes rates/budgets/rollups as intended foundation, not current MCP capability. |
| Bulk operations | Batch transition supports group or up to 100 issue keys; key mode prevalidates and updates/logs in a transaction. | Only one bulk mutation family exists. No bulk patch/routing/triage, dry-run, per-item result, partial-failure contract, or job status. Group mode rejects >100 and done-time blocks return structured API details but MCP passes them through without per-issue recovery. |
| Pagination/filtering/scale | MCP local `limit`/`offset`, compact tables, allowlist slim transforms, API key cap 100. Issue list batches active workers to avoid N+1. | API list calls fetch the full project/workspace arrays before MCP slices; no cursor/continuation token, server-side total/count contract, field projection, sort control, or request budget. Documents/comments/cycles/worklogs/members are unbounded or fixed-take raw lists. This is the most immediate large-team latency/token risk. |
| Token efficiency | 18 tools are deferred behind instructions; 26 core; `format:compact/slim/full`; write ack tier; descriptions parser and byte ceilings. | Deferred list and count comments drift; raw-heavy domains bypass transforms; compact tables lose stable structured semantics; adding triage tools will exceed context budget unless cold tools are reclassified or tool search is relied on. |
| Latency/reliability | 10s client timeout; 401 refresh is single-flight; heartbeat retries one transient failure; API rate limiting/metrics/logging are present. | No general retry/backoff or idempotency key. Search/triage would amplify round trips. API services contain graph-walk N+1 (`issue-dependency/service.ts:reachable`, roadmap DFS), multi-query cycle close, and event-driven eventual consistency. |
| RBAC/token scope | API gates all current routes through workspace/project/issue/cycle/dependency role checks; scoped refresh tokens carry allowed project IDs; timesheet PM approval is enforced API-side. | No triage-specific policy, approval role, field-level permissions, workspace/project cross-boundary preview policy, or MCP-visible permission explanation. `kanon_list_members` returns emails/raw identity data, so least-privilege response design matters. |
| Auditability/provenance | `ActivityLog` records issue mutation actions and `via`; comments/documents/estimate/time writes thread provenance; cycle deletion writes `AdminAuditLog` inside a transaction; EventBus carries actor/via. | No MCP audit/activity read tool; no general AdminAuditLog query; many planning writes lack reason/decision fields; proposal apply records only status/time and does not record an executed action. |
| Approvals/explainability | Estimate tool intentionally creates a proposal; API proposal dedup uses a workspace-local partial unique index; PM time approval is atomic. | `POST /proposals/:id/apply` only flips `McpProposal.status` to applied—it does not execute `payload`. No generic proposal list/dismiss MCP tools. A triage proposal needs before/after, evidence, policy version, confidence, reviewer, and applied action result. |
| Dry-run/proposal/apply separation | Existing estimate proposal demonstrates the desired conceptual separation; regular writes mutate immediately. | There is no common dry-run or proposal mode on issue/cycle/bulk tools. Proposal kinds exist (`reassign`, `add_dependency`, `split_issue`, generic) but their execution is not implemented. |
| Idempotency/concurrency | Issue sequence increment is row-lock serialized; WorkLog→TimeEntry promotion is idempotent; approve/reject uses conditional update in a transaction; pending generic proposal targetRef has DB dedup. | Work-session single-worker check is explicitly check-then-act and admits a sub-millisecond race; issue update/assignment/cycle changes have no version/ETag; `apply` read-check-update can race; no client-supplied idempotency key. |
| Partial failures/recovery | `closeCycleWithDisposition` reports `PartialCycleMutationError` and compensates re-attach in one path; incident capture tells caller how to start work if step 2 fails; API transactions protect batch/cycle create/approval. | Cycle close still mutates across calls; incident create can leave an orphan; event/listener errors are swallowed and only logged; there is no durable operation record, recovery job, or MCP resume token. |
| Multi-workspace/project scale | `.kanon` binding resolves project from process cwd; list workspaces/projects orient the agent; API scopes project keys to user workspaces and token project IDs. | Project-key tie-break chooses oldest workspace when a user has duplicate keys; most tools accept project key, not workspace+project identity; no cross-project/workspace triage query, portfolio rollup, or explicit workspace context in issue output. |
| External provider/inbound readiness | Prisma has `IntegrationConnection`, `MemberIntegrationCredential`, `ExternalRef`; `docs/adr/0012-external-pm-integrations-redmine.md` specifies provider adapters, outbound events, polling/webhook seams, encrypted credentials. | `app.ts` does not register an integrations route and source search finds only integration crypto under the module; no current provider sync/inbound MCP surface. External status/workflow/identity mapping and conflict handling remain design work. |
| Observability/operations | Pino redaction, `/metrics`, rate-limit, API health, event replay, EventBus subscriber error count, MCP SSE reconnect logging, heartbeat logs. | No per-tool latency/error/cardinality metrics, correlation/idempotency IDs, proposal/triage decision telemetry, dead-letter queue, durable event delivery, or MCP operator diagnostic tool. |

### API primitives present but not MCP-exposed

These are important because the recommendation should not create redundant MCP tools when orchestration is enough:

- Schedule: `GET/PUT /api/issues/:key/schedule`, `POST /api/issues/:key/estimate`, project schedule timeline/config routes (`modules/schedule/routes.ts`).
- Milestones: create/list/update/attach/detach routes (`modules/milestone/routes.ts`).
- Issue dependencies: create/list/delete with typed edges and `lagDays` (`modules/issue-dependency/routes.ts` and `service.ts`). This is distinct from the currently exposed roadmap dependency family.
- Activity and collaboration: `GET/POST /api/issues/:key/activity`, `GET /api/issues/:key/comments`, comment PATCH, document PATCH (`modules/activity`, `comment`, `document`).
- Work detail: heartbeat, issue worklogs, manual interruptions (`modules/work-session/routes.ts`).
- Issue search capabilities: `q`, `parent_only`, `has_documents`, `document_kind` in `IssueFilterQuery`; only a subset is mapped by MCP `ListIssuesInput`.
- Cycle activation and explicit baseline (`POST /cycles/:id/activate`, `/baseline`) exist but are not MCP tools.
- Proposal list and dismiss exist (`GET /api/workspaces/:id/proposals`, `POST /api/proposals/:id/dismiss`), but MCP only creates/applies.
- Issue subscriptions and notifications exist but are not MCP surfaces.
- Project archive/delete exists but `kanon_delete_project` is absent despite the deferred instructions’ destructive-tool theme.

## 4. Composability versus genuinely missing primitives

### Workflows already composable

1. **Basic intake:** resolve project (`.kanon`/`get_project`) → `list_groups` → `create_issue` → optional `update_issue` → `transition_issue`/`start_work`; incident intake is one existing composite tool.
2. **Manual triage of one known issue:** `get_issue` → `list_members`/`list_groups` → `update_issue` for priority/labels/assignee/group/cycle → `comment_issue` or a design record. This is adequate for a human-directed small queue, not a large shared inbox.
3. **Cycle planning:** `list_cycles`/`get_cycle` → `create_cycle` → `attach_issues_to_cycle`; `close_cycle` has disposition orchestration and API safeguards.
4. **Roadmap conversion:** `list_roadmap` → `update_roadmap_item` or `promote_roadmap_item`; roadmap dependency edges are composable for planning graph work.
5. **Capture and approval:** start/stop → list own WorkLogs → promote → update → submit; PM approve/reject and adjustment are available when discovered through deferred tools.
6. **Estimate judgment:** propose estimate → human applies. This is a good product pattern, although current apply is not an execution engine.

### Workflows that need new API/MCP primitives

- **Bounded queue search:** server-side cursor/filter/sort/field projection and an issue search endpoint that can return candidate duplicates, not a client-side full-project dump.
- **Triage evidence and decision record:** a normalized recommendation/proposal schema with before snapshot, candidate references, rule/model version, confidence, evidence, requested changes, actor and approval state.
- **Duplicate consolidation:** canonical/duplicate relation, redirect/merge semantics, comment/attachment/child/dependency/cycle/time handling, conflict policy and idempotent operation.
- **Team/capacity routing:** team/expertise/ownership model plus capacity/read APIs; do not infer capacity from active workers or cycle membership.
- **Portfolio visibility:** MCP reads for schedule timeline, forecast, milestones, project health/read model, typed issue dependencies and workspace rollups.
- **Safe bulk writes:** dry-run + plan hash + idempotency key + optimistic version + per-item result/blocked reasons, preferably as an asynchronous operation for large queues.
- **Proposal execution:** typed `McpProposal` apply dispatcher or a generic action endpoint that executes a validated payload transactionally, records reviewer/decision and returns side effects. Do not add a separate triage mutation that duplicates `update_issue` semantics.
- **Audit/diagnostics:** queryable activity/audit and operation status, with correlation IDs and an event/retry/DLQ contract.

## 5. Ranked gap/opportunity matrix

Effort is relative to a small/medium/large multi-package slice; risk includes product and data-safety risk.

| Rank | Persona / scenario | Existing workaround | Missing primitive | Impact | Effort | Risk | Recommendation |
|---:|---|---|---|---|---|---|---|
| P0 | PM/triager handles 1000 new issues | `list_issues` then repeated `get_issue`; local offset after full fetch | Cursor-based server-side issue search with projection, q, filters, stable sort, workspace/project scope | Very high: latency, token and missed-queue risk | M | M | Build before any bulk/AI triage; make it reusable for web/MCP |
| P0 | Agent recommends classification/routing without silently mutating | Prompt/model judgment over `get_issue` plus ad hoc updates | Read-only triage result contract: recommendations, evidence, confidence, candidate refs, policy/model version | Very high: safe first AI value | M | M | First user-facing triage slice; no mutation |
| P0 | PM approves a triage batch | Existing generic proposal row; apply only flips status | Typed proposal/action execution with before-version, idempotency, reviewer, audit and atomic result | Very high: trust and safe automation | L | H | Fix proposal foundation before triage apply; preserve estimate/replan reuse |
| P0 | Planner sees blockers across delivery tickets | Roadmap dependency tools only | MCP issue-dependency list/create/delete, including type/lag and both directions | High: current graph is incomplete/misleading | S-M | M | Expose existing API; do not invent a second dependency model |
| P1 | PM consolidates duplicate reports | Search/filter manually, comment and possibly delete | Duplicate candidate query + explicit duplicate relation/merge operation | High: queue quality and reporting integrity | L | H | Separate detection from consolidation; proposal/apply first |
| P1 | PM asks “who can own this by next cycle?” | `list_members`, active workers, cycle list; guess capacity | Schedule/forecast/capacity/ownership reads and team/expertise taxonomy | High: assignment quality | L | H | Build read model/API before routing mutation |
| P1 | Portfolio/Director scans cross-project health | Web-only PPM surfaces; no MCP portfolio read | Workspace/project portfolio read endpoint with cursor, freshness and permission scope | High for management persona; lower for coding-agent hot path | L | M | Defer from core tool list; expose on-demand read tools |
| P1 | Ops triages a queue in bulk | Repeat `update_issue` or batch transition only | Dry-run bulk plan, bounded batch, partial results, retry/resume/idempotency | High: operator safety | L | H | Reuse typed issue patch primitives; never autonomous all-or-nothing by default |
| P1 | Auditor explains an AI change | ActivityLog exists but no MCP read; proposal only status | Audit/activity query plus decision/evidence record and correlation ID | High: enterprise trust/compliance | M | M | Pair with proposal execution, not as a standalone triage embellishment |
| P1 | Support/incident team needs urgency/SLA | Priority and incident type; `report_incident` | Severity/impact/urgency/SLA policy fields and escalation timers | High for support; product decision required | M-L | H | Product discovery first; avoid overloading priority |
| P2 | PM syncs triage with Redmine/Jira | Schema/ADR seams only; no mounted integration routes | Provider adapter, external refs, inbound conflict policy, sync status/read tools | Medium-high later; high operational risk | XL | H | Finish integration contract independently; triage should emit canonical events |
| P2 | Agent diagnoses stale/retried operations | API logs/metrics and EventBus replay | Operation status, correlation IDs, durable queue/DLQ/rebuild tooling | Medium but essential at scale | L | H | Platform prerequisite for autonomous/bulk workflows |

## 6. Triage deep dive (design intentionally open)

### Working definition and actors

“Triage” should mean **turning an incoming or ambiguous issue into a shared, explainable work decision**: validate/normalize the issue, classify type, assess severity/impact/urgency, find duplicate candidates, route to group/team/owner, set priority/labels/cycle/SLA recommendations, and record what was decided and by whom. It is not merely “set priority” and not the same as incident capture.

- Initiators: support, PM, engineering lead, developer, or an agent acting on behalf of a workspace member.
- Recommender: deterministic policy engine and/or host AI, explicitly identified.
- Approver: configurable project/workspace role; default should be PM/admin for ownership, severity/SLA, merge and cycle commitments. A member may propose; viewer may read only.
- Executor: API service, never direct MCP/Prisma mutation. Human override must remain possible and visible.

### Product/API shapes considered

| Shape | Behavior | Strength | Failure mode / decision |
|---|---|---|---|
| A. Read-only recommendation | `triage_preview` reads one issue plus bounded candidates and returns suggested fields, duplicate candidates, evidence, confidence and `requiresApproval`; zero writes | Safest, easy to measure, works with current MCP orchestration and lets humans compare quality | Needs search/candidate and missing domain fields; recommendation can be ignored. **Best first slice.** |
| B. Proposal + apply | Preview creates a typed immutable proposal; a reviewer edits/approves/dismisses; apply validates versions/permissions and atomically executes supported patches/relations | Matches existing `McpProposal` intent, gives audit/rollback boundary and human override | Requires replacing status-only apply, typed dispatch, conflict/idempotency and a real audit record. **Best production mutation shape.** |
| C. Atomic autonomous mutation | One call computes and immediately changes issue, owner, labels, priority, cycle and duplicate links | Low interaction count and potentially useful for deterministic low-risk rules | High blast radius, unclear AI accountability, race-prone, hard to recover, poor explainability. **Do not make default.** |
| D. Composable workflow | Agent calls search → get candidates → recommendation/model → update/merge/apply primitives | Maximum reuse and incremental rollout; no new “god tool” | Many round trips, non-atomic, context-heavy, race windows. **Use internally/for preview; wrap with B for mutation.** |
| E. Async queue/batch triage | Submit a bounded job/plan, inspect progress/results, approve a batch | Appropriate for enterprise queues and partial failures | More operational infrastructure and UX; not a first single-issue slice. |

**Recommendation:** expose either (1) one read-only recommendation tool plus existing/generic proposal discovery, or (2) two explicit tools, `triage_preview` and `triage_apply`, over API primitives. Do not create `kanon_triage_issue` that owns every field and bypasses `update_issue`, dependency, schedule and proposal semantics. A generic proposal/action family can avoid future tool proliferation, but it must be typed and executable, not the current status-only flip.

### Judgment, evidence and fields

- Deterministic rules should handle schema validation, required fields, known group/role membership, duplicate exact-key detection, cycle/project boundaries, state transition legality, version conflicts, and policy thresholds.
- AI judgment may summarize issue text, annotate/explain server-ranked candidates, infer type/labels, or suggest expertise, but deterministic server ranking/order is authoritative: host AI cannot add, remove, or reorder the bounded candidate set. It must return evidence snippets/field references, confidence (`high/medium/low` or calibrated score), model/provider/version and “unknown” rather than inventing facts.
- Current safe recommendations can target existing fields: `type` (create only today), `priority`, `labels`, `groupKey`, `assigneeId`, `cycleId`, `parentId`. `kanon_update_issue` currently lacks `type`; this is an API/MCP contract gap, not a reason for a triage-specific type tool.
- Severity, customer impact, urgency, SLA deadline/escalation, product area, source channel and service ownership are not current Issue fields. Their addition requires product decisions and schema/API changes; do not encode them as arbitrary labels without deciding query/reporting semantics.
- Duplicate evidence should include normalized title/key/text similarity, links to candidate issue keys, same project/workspace proof, and a reason for “not a duplicate” when a human overrides.
- Assignment recommendations must distinguish “best matching expertise” from “currently available capacity”; the current `WorkSession` single-worker guard is not a capacity model.

### Permissions, audit, idempotency and override contract hypotheses

A proposal/apply design should carry: `proposalId`, workspace/project, target issue IDs, action kind, proposed patch/relations, before snapshot or version, evidence, confidence, policy/model version, generatedBy/client identity, reason, expiration, and an idempotency key. Apply should:

1. re-check token project scope and minimum role per action;
2. reject stale target versions with a structured conflict rather than overwrite;
3. execute only validated action kinds in a transaction where possible;
4. record the approving member, prior/current values, evidence/proposal IDs, reason and `via` in audit/activity;
5. be idempotent for a repeated key and return the original result;
6. return per-action success/blocked/conflict results for a batch;
7. support dry-run/preview without writes and human-edited overrides.

The current `McpProposal` API already has pending/applied/dismissed states, 8 KiB payload validation, workspace authorization, and pending generic targetRef dedup. It lacks action execution, apply-time atomic conditional update, dismiss MCP access, and an audit/decision event. Those are foundational rather than triage-specific.

### Minimal first slice

A deliberately small hypothesis for proposal round:

1. **Read-only single-issue triage preview** scoped by explicit project/workspace identity, with compact and full response tiers.
2. **Bounded candidate retrieval** using server-side q/filter/cursor/field projection; initially exact/normalized text candidates, not embeddings.
3. Recommendation fields limited to existing canonical fields: type, priority, labels, group, assignee and cycle, with `null/unknown` allowed.
4. Evidence and confidence on every recommendation; no writes and no hidden side effects.
5. A typed proposal envelope that can later carry a patch, duplicate-link decision or route decision; proposal creation may be a separate API action if product wants it persisted immediately.
6. Acceptance measurement: zero unintended mutations; bounded latency/tokens; reviewer can reconstruct why each suggestion exists; same input+rules gives stable deterministic rule output; low-confidence cases escalate.

### Explicit non-goals for the first slice

- No autonomous merge/delete or “close duplicate” action.
- No SLA enforcement, paging, on-call integration or escalation timers.
- No new AI model hosting/provider, embeddings store or cross-workspace search.
- No assignment based on inferred capacity without a capacity model.
- No bulk autonomous mutation; no silent cycle commitment or severity override.
- No external-provider write/sync; no inbound webhook ownership.
- No replacement of existing `kanon_update_issue`, `kanon_list_issues`, dependency, cycle or schedule primitives.

### Edge cases to resolve in design

Deleted or concurrently edited target; issue moved projects; duplicate candidates in a different project/workspace; exact duplicate already merged; candidate itself closed/done; parent/child and dependency preservation during consolidation; time entries/worklogs and audit history; issue with no group or members; owner absent or deactivated; cycle closed/active boundary; incident requiring immediate routing; conflicting deterministic rule and AI recommendation; low-confidence/no-evidence output; model/provider unavailable; prompt injection in issue text; external provider status mismatch; scoped token cannot see a candidate; stale proposal after a human override; retries after timeout with unknown commit outcome; partial batch where one issue is forbidden or already changed.

### Unanswered product questions for the interactive proposal round

1. Is triage a Kanon-owned policy engine or an agent capability that only uses Kanon primitives?
2. Which persona approves severity, ownership, duplicate consolidation and cycle placement?
3. Are severity/impact/urgency/SLA first-class fields, and what are their vocabularies/tenant configuration?
4. What is the canonical duplicate outcome: link, merge, redirect, close, or a proposal to a human?
5. Can one issue belong to multiple teams/groups, and is group taxonomy project- or workspace-scoped?
6. What evidence is required for AI suggestions, and how is confidence calibrated/monitored?
7. Which changes are low-risk enough for deterministic auto-apply (for example, label normalization) and which always require approval?
8. Is capacity planning in scope now, or should triage only route by declared ownership/expertise?
9. What is the acceptable single-issue and 100-issue latency/token budget?
10. Should proposal approval be member/PM/admin, and can the proposer approve their own recommendation?
11. What version/locking contract should coexist with web drag/drop and external-provider sync?
12. Are triage decisions retained indefinitely, and must they be exportable for compliance?

## 7. Recommendation and sequencing

1. **First:** agree the triage product definition and decision/audit contract; treat triage as a workflow over primitives, not a monolith.
2. **Foundation slice:** server-side bounded issue search/projection + typed read-only triage recommendation. Reclassify enough cold tools before adding core descriptions; keep triage on-demand if necessary.
3. **Safety slice:** make proposals execute typed actions with optimistic version/idempotency, reviewer attribution, dry-run and per-action result. Reuse it for estimate and forecast replan rather than adding bespoke apply paths.
4. **Scale slice:** expose issue dependencies and PPM/portfolio reads; add bulk dry-run/plan/apply only after operation status and partial-failure contracts exist.
5. **Domain slice:** decide and model severity/impact/urgency/SLA, team/expertise/capacity, and duplicate merge semantics.
6. **Integration/operations slice:** finish external provider routes/inbound conflict policy, durable event/retry/DLQ and triage/proposal metrics.

This sequencing keeps the likely high-value triage bet while preventing a risky AI mutation layer from hiding current retrieval, domain-model and operational gaps.

## 8. Risks carried into proposal/design

- **Process:** CodeGraph was unavailable to this executor; a future run should inject/use the repository graph tool and validate the symbol inventory automatically.
- **Count drift:** current source/test count is 44, but instructions/comments/historical docs contain 38/40/43-era statements. Any new tool must update count assertions, deferred/core classification, description budgets and release artifacts together.
- **Context budget:** only a small description-budget margin is intentionally protected; triage should be deferred/on-demand or accompanied by a cold-tool reclassification.
- **Data safety:** duplicate merge, assignment, cycle changes and bulk triage are irreversible or socially consequential; proposal/apply, version checks and audit are prerequisites.
- **Event consistency:** EventBus is in-process, synchronous emission with fire-and-forget listeners and finite replay; it is not a durable job system for large batches or external sync.
- **Scope ambiguity:** API already contains PPM/typed dependency/integration pieces that are not MCP-accessible; a triage proposal must distinguish “expose an existing primitive” from “invent a new domain model.”
