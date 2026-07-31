# hierarchy-read-model Specification

## Purpose

Load all project issues for the board and derive a defensive parent/child forest
so root cards remain the default board unit while descendants are available for
later expansion.

---

## Requirements

### Requirement: Board list fetches all issues

`useIssuesQuery` MUST request `GET /api/projects/:projectKey/issues` without
`parent_only=true`. The query key MUST remain `issueKeys.list(projectKey)`.

#### Scenario: Fetch URL has no parent_only

- GIVEN the board mounts for project `KAN`
- WHEN `useIssuesQuery` runs
- THEN `fetchApiValidated` is called with `/api/projects/KAN/issues`

---

### Requirement: Forest builder

`buildIssueForest(issues)` MUST return roots (including orphans), a by-id map,
`total`, and `rootCount`. Children MUST nest under existing same-list parents.
Missing parents, self-parenting, and cycles MUST promote the offending node to
a root without infinite recursion. Nesting MUST stop at
`ISSUE_FOREST_MAX_DEPTH` (8). Each node MUST expose `descendantCount`.

#### Scenario: Nested root/child/grandchild

- GIVEN issues R → C → G linked by parentId
- WHEN the forest is built
- THEN roots contain only R
- AND R.children contains C
- AND C.children contains G
- AND R.descendantCount is 2

#### Scenario: Orphan becomes root

- GIVEN a child whose parentId is not in the list
- WHEN the forest is built
- THEN that child appears among roots

#### Scenario: Cycle does not recurse forever

- GIVEN A.parentId = B and B.parentId = A
- WHEN the forest is built
- THEN both appear as roots (or one root with truncated link)
- AND the builder terminates

#### Scenario: Depth cap

- GIVEN a chain deeper than `ISSUE_FOREST_MAX_DEPTH`
- WHEN the forest is built
- THEN nodes beyond the cap are not nested under the capped parent as further
  descendants (promoted or truncated per design)

---

### Requirement: Board cards stay root-only

Until Slice 3, `BoardPage` MUST pass only forest roots to `KanbanBoard` and
`GroupedBoard`, so children are not duplicate flat cards.

#### Scenario: Nested issues do not appear as sibling cards

- GIVEN a root with one child in the fetched list
- WHEN the flat board renders
- THEN the child is not a top-level card in a column

---

### Requirement: Toolbar distinguishes roots vs total

The board toolbar MUST show both the number of root cards and the total issue
count from the forest.

#### Scenario: Toolbar copy

- GIVEN 1 root and 3 total issues (root + 2 descendants)
- WHEN the toolbar renders
- THEN it includes both root count and total count
