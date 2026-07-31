# Proposal: KAN-187 Slice 3 — Board hierarchy UX

## Intent

Make parent/subtask hierarchy discoverable on the flat board: root cards with
descendants show a disclosure + count; expanding reveals nested child rows
(key, title, state) that navigate to issue detail — without duplicating children
as sibling column cards.

## Scope

### In Scope
- Hierarchy disclosure on root cards (`descendantCount`)
- Nested expand for children/grandchildren (max depth from forest)
- Child rows: key, title, state, click → detail
- Flat Kanban wiring; GroupedBoard uses the same block for ungrouped root cards
- i18n en/es for expand/collapse labels
- Component tests

### Out of Scope
- Dragging nested children between columns
- Detail breadcrumb / SSE (Slice 4)
- API integrity validation (Slice 5)

## Approach

- `HierarchyIssueBlock` owns expand state; roots stay in `SortableContext`.
- Nested rows are not sortable.
- Reuse `IssueNode` from Slice 2 `buildIssueForest`.
