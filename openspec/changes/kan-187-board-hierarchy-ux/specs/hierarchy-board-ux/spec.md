# hierarchy-board-ux Specification

## Purpose

Board hierarchy disclosure and nested child navigation on top of the Slice 2 forest.

---

### Requirement: Disclosure on roots with descendants

A root card with `descendantCount > 0` MUST show a disclosure control and the
descendant count. Roots with no children MUST render as ordinary cards.

#### Scenario: Root with descendants shows control

- GIVEN a root with one child
- WHEN the board renders
- THEN the root card exposes a control to expand/collapse
- AND the descendant count is visible

#### Scenario: Leaf root has no disclosure

- GIVEN a root with no children
- WHEN the board renders
- THEN no hierarchy disclosure control is shown

---

### Requirement: Nested expansion

Expanding a node MUST reveal its direct children once. Expanding a child MUST
reveal grandchildren. Collapsing MUST hide the nested rows. An issue MUST NOT
appear both as a column card and as a nested row.

#### Scenario: Expand reveals child once

- GIVEN root R with child C
- WHEN the user expands R
- THEN C appears nested under R
- AND C is not a separate top-level card in any column

#### Scenario: Nested expand for grandchild

- GIVEN R → C → G
- WHEN the user expands R then C
- THEN G appears nested under C

---

### Requirement: Child navigation

Nested child rows MUST show key, title, and state, and MUST call the board
`onSelectIssue` handler when activated.

#### Scenario: Click child navigates

- GIVEN an expanded root with child C
- WHEN the user activates the child row
- THEN `onSelectIssue` is invoked with C's key
