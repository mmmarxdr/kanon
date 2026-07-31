# Proposal: KAN-187 Slice 1 — MCP update field parity (`parentId`)

## Intent

`kanon_update_issue` advertises `parentId` (and the API already persists it) but
the tool handler silently drops the field, so agents get a successful ack while
the parent relation is unchanged. This slice forwards `parentId` (including
explicit `null` unlink) and closes the remaining MCP↔API update field gaps
(`type`, `groupKey`) so acknowledgements only cover fields actually submitted.

## Motivation

- Reproduced on KAN-138/KAN-139 and documented in KAN-187: MCP reparent
  “succeeds” without mutating `parentId`.
- `create_issue` already forwards `parentId`; `update_issue` does not — an
  asymmetry that breaks hierarchy workflows for agents.
- Board discoverability (Slices 2–3) cannot be validated end-to-end via MCP
  until reparent/unlink works.

## Scope

### In Scope
- **mcp**: Destructure and forward `parentId`, `type`, and `groupKey` in
  `update_issue` handler body construction.
- **mcp**: Add `type` and `groupKey` to `UpdateIssueInput` to match
  `UpdateIssueBody` on the API.
- **mcp**: Strict-TDD tests proving outgoing `client.updateIssue` body includes
  `parentId` UUID, `parentId: null`, and the new parity fields when provided;
  omitted fields stay absent.
- OpenSpec for this slice only.

### Out of Scope
- API hierarchy validation (self/cycle/cross-project) — Slice 5.
- Board `parent_only` / tree UX — Slices 2–3.
- Detail breadcrumb / SSE invalidation — Slice 4.
- Changing ack shape beyond current `{ ok, id, key }` (still ack of the write
  call; honesty = fields must actually be in the request body).

## Capabilities

### New Capabilities
- `mcp-update-field-parity`: MCP `update_issue` forwards every API-supported
  update field it declares, including `parentId` null unlink.

### Modified Capabilities
- None at the HTTP API layer.

## Approach (settled)

- Mirror `create_issue`’s `if (field !== undefined) body[field] = field`
  pattern for `parentId`, `type`, `groupKey`.
- Rely on existing `NullableOptionalUuid` normalization (`""` → undefined;
  `null` stays null for unlink).
- No API changes; Prisma connect/disconnect already handles null vs uuid.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/mcp/src/types.ts` | Modified | Add `type`, `groupKey` to `UpdateIssueInput` |
| `packages/mcp/src/tools/issues.ts` | Modified | Forward `parentId`, `type`, `groupKey` |
| `packages/mcp/src/tools/issues.test.ts` | Modified | Body-forwarding regression tests |
| `packages/mcp/src/types.test.ts` | Modified | Schema accepts new optional fields |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Agents reparent into invalid parents (API lacks cycle checks) | Med | Accepted until Slice 5; document in exploration |
| Broader field surface surprises clients | Low | Additive optional fields only |

## Rollback Plan

Revert the MCP commits. No migrations.

## Success Criteria

- [ ] `update_issue({ parentId: <uuid> })` calls API with that `parentId`.
- [ ] `update_issue({ parentId: null })` calls API with `parentId: null`.
- [ ] Omitting `parentId` does not send the key.
- [ ] `type` and `groupKey` forward when provided.
- [ ] Existing format-tier ack/full tests still pass.
