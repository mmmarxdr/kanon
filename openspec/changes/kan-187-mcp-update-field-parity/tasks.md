# Tasks: KAN-187 Slice 1 — MCP update field parity

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~80–150 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |

### Phase 1 — Schema (STRICT TDD)

- [ ] **1.1 RED** `types.test.ts`: `UpdateIssueInput` accepts `type` and `groupKey` (incl. null groupKey).
- [ ] **1.2 GREEN** Add `type`, `groupKey` to `UpdateIssueInput` in `types.ts`.
- [ ] **1.3 COMMIT** `feat(mcp): add type and groupKey to UpdateIssueInput`

### Phase 2 — Handler forwarding (STRICT TDD)

- [ ] **2.1 RED** `issues.test.ts`: assert `updateIssue` body for parentId uuid/null/omitted, type, groupKey.
- [ ] **2.2 GREEN** Forward fields in `tools/issues.ts` update handler.
- [ ] **2.3 COMMIT** `fix(mcp): forward parentId type groupKey on update_issue`
- [ ] **2.4** Run `pnpm --filter @kanon/mcp test`
