# mcp-update-field-parity Specification

## Purpose

Ensure `kanon_update_issue` forwards every update field it declares to the
Kanon API, especially `parentId` for reparent and unlink, plus `type` and
`groupKey` for parity with `PATCH /api/issues/:key`.

---

## Requirements

### Requirement: parentId forwarding

When the caller supplies `parentId` as a UUID, the MCP handler MUST include
`parentId` with that value in the body passed to `client.updateIssue`. When
the caller supplies `parentId: null`, the handler MUST include
`parentId: null` (unlink). When `parentId` is omitted, the handler MUST NOT
include a `parentId` key in the body.

#### Scenario: Reparent forwards UUID

- GIVEN `update_issue` is invoked with `issueKey` and `parentId: "<uuid>"`
- WHEN the handler runs
- THEN `client.updateIssue(issueKey, body)` is called
- AND `body.parentId` equals that UUID

#### Scenario: Unlink forwards null

- GIVEN `update_issue` is invoked with `parentId: null`
- WHEN the handler runs
- THEN `body.parentId` is `null`

#### Scenario: Omitted parentId stays absent

- GIVEN `update_issue` is invoked with only `title`
- WHEN the handler runs
- THEN `body` does not have a `parentId` property

---

### Requirement: type and groupKey parity

`UpdateIssueInput` MUST accept optional `type` (issue type enum) and optional
`groupKey` (string or null). When provided, the handler MUST forward them on
the update body. When omitted, they MUST NOT appear on the body.

#### Scenario: type and groupKey forward

- GIVEN `update_issue` with `type: "bug"` and `groupKey: "auth"`
- WHEN the handler runs
- THEN `body.type` is `"bug"` and `body.groupKey` is `"auth"`

#### Scenario: groupKey null clears grouping

- GIVEN `update_issue` with `groupKey: null`
- WHEN the handler runs
- THEN `body.groupKey` is `null`

---

### Requirement: Existing ack/full behavior preserved

Default response MUST remain ack `{ ok, id, key }`. `format: "full"` MUST
still return the entity. Field-forwarding MUST NOT change those contracts.

#### Scenario: Ack still default after parentId update

- GIVEN `update_issue` with `parentId` and no format
- WHEN the handler succeeds
- THEN the tool result parses to `{ ok: true, id, key }` only
