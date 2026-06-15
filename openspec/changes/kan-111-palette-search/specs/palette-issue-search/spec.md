# palette-issue-search Specification

## Purpose

Server-backed, project-scoped issue search in the command palette (`Cmd+K`).
Replaces the cache-only filter with a debounced server query, adds chip + typed-token
filters (state / type / priority / document presence), and exposes a document-kind
indicator per result. Commands remain available when there is no project context.

---

## Requirements

### Requirement: Project-scoped text search via server

The system SHALL query `GET /api/projects/:key/issues?q=` for the current project
whenever the palette is open and the user types. The `q` parameter MUST match issues
by title OR key using a case-insensitive substring (`contains`) filter applied at the
server. An empty query MUST return the most recent issues for the project (no
restriction on `q`). The palette MUST derive `projectKey` from the current route; if
no project context is available the search input MUST be hidden and commands MUST
continue to work normally.

#### Scenario: Typing returns server matches

- GIVEN the palette is open and the route has a project context
- WHEN the user types a partial title or key (e.g. "auth")
- THEN the palette displays issues whose title OR key contains "auth" (case-insensitive)
- AND results come from the server, not the client cache

#### Scenario: Empty query returns recent issues

- GIVEN the palette is open and the route has a project context
- WHEN the query field is empty (no text, no filter tokens)
- THEN the palette displays a recent / default issue list from the server

#### Scenario: No project context — search disabled, commands available

- GIVEN the palette is open on a route with no project context (e.g. workspace root)
- WHEN the user opens the palette
- THEN the search input is hidden or disabled
- AND all existing commands (Create issue, Go to…) remain accessible and functional

---

### Requirement: Filter combination (AND semantics)

The list endpoint MUST accept `state`, `type`, `priority`, `has_documents` (boolean),
and `document_kind` query parameters. All active filters MUST be combined with the
text query using AND logic. Clearing all filters MUST reset results to the unfiltered
(q-only) server response.

#### Scenario: Multiple filters applied together

- GIVEN the palette has tokens `state:done type:bug`
- WHEN the server receives the request
- THEN only issues that are BOTH `state=done` AND `type=bug` are returned
- AND the `q` text filter (if any) is applied on top

#### Scenario: Document-presence filter — has:adr

- GIVEN the user types `has:adr`
- WHEN the server processes the request
- THEN only issues that have at least one document of `kind = 'adr'` are returned
- AND the filter is implemented as `documents: { some: { kind: 'adr' } }`

#### Scenario: Clearing filters resets results

- GIVEN one or more chips / tokens are active
- WHEN the user removes all filter chips and clears all tokens
- THEN the palette re-queries the server with no filter parameters
- AND results reflect the unfiltered list

---

### Requirement: documentKinds exposed per issue

Each issue in the list response MUST include a `documentKinds: DocumentKind[]` field
containing the distinct document kinds attached to that issue. No schema migration is
required; the field is derived from the existing `IssueDocument`↔`Issue` relation
via Prisma select/groupBy. The `DocumentKind` enum and the updated `issueSchema` MUST
be exported from `packages/shared`.

#### Scenario: Issue with documents exposes distinct kinds

- GIVEN an issue has two documents of kind `adr` and one of kind `design-record`
- WHEN the list endpoint returns that issue
- THEN `documentKinds` equals `['adr', 'design-record']` (no duplicates)

#### Scenario: Issue with no documents returns empty array

- GIVEN an issue has no attached documents
- WHEN the list endpoint returns that issue
- THEN `documentKinds` equals `[]`

#### Scenario: Zod validation at shared boundary

- GIVEN the shared `issueSchema` includes `documentKinds: z.array(DocumentKindEnum)`
- WHEN the web layer calls `fetchApiValidated` with a list response
- THEN the response is validated and a type-safe `Issue` with `documentKinds` is returned

---

### Requirement: Hybrid filter input — chips and typed tokens share one filters object

The palette MUST support both chip controls and typed-token syntax
(`state:done has:adr type:bug priority:high`) as input methods for the same filter.
Both MUST write to and read from ONE shared `filters` object. Text that does not match
a known token prefix MUST be treated as free-text `q`. An unrecognised or malformed
token (e.g. `foo:bar`) MUST NOT crash the parser — it MUST be passed through as free
text.

#### Scenario: Typed token updates chip state

- GIVEN the user types `state:done` in the palette input
- WHEN the token parser runs
- THEN the `state` chip shows `done` as the active selection
- AND the `filters.state` value equals `'done'`

#### Scenario: Chip selection updates query string

- GIVEN the user selects `priority: high` via the chip UI
- WHEN the filters object is updated
- THEN the next server request includes `priority=high`
- AND any typed `priority:…` token is removed from the text input

#### Scenario: Unknown token treated as free text

- GIVEN the user types `foo:bar some title`
- WHEN the token parser runs
- THEN `foo:bar` is not parsed as a filter and is included in `q` as free text
- AND no error is thrown

#### Scenario: Leftover text after token extraction becomes q

- GIVEN the user types `state:in-progress auth module`
- WHEN the token parser runs
- THEN `filters.state = 'in-progress'` and `q = 'auth module'`

---

### Requirement: Palette shows document indicator on results

The palette MUST render a visible indicator on any result issue that has at least one
known document kind (e.g. `adr`, `design-record`). The indicator MUST use the
`documentKinds` field from the server response; it MUST NOT require an additional
network request.

#### Scenario: Issue with ADR shows indicator

- GIVEN an issue result has `documentKinds` containing `'adr'`
- WHEN the palette renders that result row
- THEN an ADR indicator is visible (icon or badge)

#### Scenario: Issue without documents shows no indicator

- GIVEN an issue result has `documentKinds = []`
- WHEN the palette renders that result row
- THEN no document indicator is rendered

---

### Requirement: Debounced query — React Query keyed by search params

The web layer MUST debounce the server query by ~200 ms after the last input change.
The React Query key MUST be `issueKeys.search(projectKey, q, filters)` so that distinct
search states cache and invalidate independently. The hook MUST use `fetchApiValidated`
with the shared `IssueFilterQuery` Zod schema at the request boundary.

#### Scenario: Rapid typing triggers only one request

- GIVEN the user types three characters in quick succession within 200 ms
- WHEN the debounce timer fires
- THEN exactly one server request is sent with the final query string
- AND intermediate keystrokes do NOT produce separate requests

#### Scenario: Distinct search states cache independently

- GIVEN the user searches for "auth" then clears and searches for "billing"
- WHEN both queries have resolved
- THEN each result set is cached under its own React Query key
- AND switching back to "auth" restores the cached result without a new request

---

### Requirement: Keyboard navigation and existing actions preserved

The palette MUST retain full keyboard navigation (↑ / ↓ to move, Enter to activate,
Esc to close) when displaying server results. Existing palette commands (Create issue,
Go to board, etc.) MUST remain accessible and MUST NOT be displaced by search results.

#### Scenario: Arrow keys navigate server results

- GIVEN the palette is showing server-returned issue results
- WHEN the user presses ↑ or ↓
- THEN focus moves between result rows
- AND pressing Enter on a focused row activates that issue

#### Scenario: Esc closes palette

- GIVEN the palette is open with an active search
- WHEN the user presses Esc
- THEN the palette closes
- AND no navigation side-effects occur

#### Scenario: Commands remain reachable alongside results

- GIVEN the palette is showing both search results and command entries
- WHEN the user navigates with arrow keys
- THEN both result rows and command rows are reachable via keyboard

---

### Requirement: Zod validation at API query boundary

The API route MUST validate incoming query parameters against the `IssueFilterQuery`
Zod schema exported from `packages/shared`. Invalid or unexpected parameter values
MUST be rejected with a 400 response; valid but absent optional parameters MUST be
treated as no-op (filter not applied).

#### Scenario: Valid query parameters accepted

- GIVEN a request with `q=auth&state=done&type=bug`
- WHEN the route handler validates the query
- THEN validation passes and the service is called with parsed filter values

#### Scenario: Invalid parameter value rejected

- GIVEN a request with `state=notastate` (not a valid StateEnum value)
- WHEN the route handler validates the query
- THEN a 400 response is returned with a validation error message

#### Scenario: Missing optional parameters treated as no-op

- GIVEN a request with only `q=auth` (no state, type, or priority)
- WHEN the route handler validates the query
- THEN the service is called without state/type/priority filters
- AND the response includes all matching issues regardless of state/type/priority
