# Design: KAN-187 Slice 2 — Hierarchy read-model

## 1. Fetch

```ts
// use-issues-query.ts
`/api/projects/${projectKey}/issues`  // was ?parent_only=true
```

`issueKeys.list(projectKey)` unchanged. API already returns `parentId`.

## 2. `buildIssueForest`

File: `packages/web/src/lib/build-issue-forest.ts`

```ts
export const ISSUE_FOREST_MAX_DEPTH = 8;

export type IssueNode = Issue & {
  children: IssueNode[];
  descendantCount: number;
  depth: number;
};

export type IssueForest = {
  roots: IssueNode[];       // includes promoted orphans
  byId: Map<string, IssueNode>;
  total: number;
  rootCount: number;
};

export function buildIssueForest(
  issues: Issue[],
  opts?: { maxDepth?: number },
): IssueForest;
```

### Algorithm

1. Clone each issue into an `IssueNode` (`children: []`, `descendantCount: 0`, `depth: 0`) indexed by `id`.
2. First pass — link: for each node with `parentId`:
   - if parent missing → mark orphan (later root)
   - if parent exists, walk ancestors; if `node.id` appears → cycle → mark orphan
   - else append to `parent.children` (pending depth trim)
3. Roots = nodes never appended as children + orphans.
4. Second pass — assign `depth` from roots DFS; if `depth > maxDepth`, detach
   subtree and promote that node to roots (defensive).
5. Third pass — bottom-up `descendantCount = sum(1 + child.descendantCount)`.
6. Sort each `children` array by `key` for stable UI.

## 3. Board wiring

`board-page.tsx`:

```ts
const forest = useMemo(() => buildIssueForest(issues ?? []), [issues]);
const boardIssues = forest.roots; // IssueNode[] <: Issue for cards
// toolbar: `${forest.rootCount} roots · ${forest.total} issues · ${inProgress} active`
```

Pass `boardIssues` into `KanbanBoard` / `GroupedBoard`. Keep full `issues` for
assignee aggregation.

## 4. Tests

- `build-issue-forest.test.ts` — nest, orphan, self-parent, cycle A→B→A, depth
  cap, empty, descendantCount.
- `use-issues-query.test.tsx` — URL without `parent_only`.
