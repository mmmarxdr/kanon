# Design: KAN-187 Slice 1 — MCP update field parity

## 1. Bug locus

```133:142:packages/mcp/src/tools/issues.ts
    async ({ issueKey, title, description, priority, labels, assigneeId, cycleId, roadmapItemId, format }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body["title"] = title;
        // ...
        if (roadmapItemId !== undefined) body["roadmapItemId"] = roadmapItemId;
        // parentId never read — silently dropped
```

`UpdateIssueInput` already includes `parentId` (`types.ts:162`). Schema
validation succeeds; the handler never copies it into `body`.

## 2. Fix

Extend destructuring and body copies:

```ts
async ({
  issueKey, title, description, type, priority, labels, groupKey,
  assigneeId, cycleId, parentId, roadmapItemId, format,
}) => {
  const body: Record<string, unknown> = {};
  // existing fields...
  if (type !== undefined) body["type"] = type;
  if (groupKey !== undefined) body["groupKey"] = groupKey;
  if (parentId !== undefined) body["parentId"] = parentId;
  // ...
}
```

Add to `UpdateIssueInput`:

```ts
type: z.enum(ISSUE_TYPES).optional(),
groupKey: z.string().nullable().optional(), // match API nullable clear
```

Use the same nullability as `UpdateIssueBody` for `groupKey`
(`nullable().optional()`). `type` is optional non-null enum (API does not
accept null type).

## 3. Test seams

In `issues.test.ts`, new describe `update_issue — field forwarding`:

1. `parentId` UUID → `mockClient.updateIssue` second arg contains it.
2. `parentId: null` → body has `parentId: null`.
3. No `parentId` in input → body has no `parentId` key.
4. `type` + `groupKey` forward when set.
5. Combined with title still produces ack default.

Schema tests in `types.test.ts` for new optional fields.

## 4. Non-goals this slice

- Server-side ancestry validation
- Changing tool description beyond existing “Update issue fields…”
- Web/API code
