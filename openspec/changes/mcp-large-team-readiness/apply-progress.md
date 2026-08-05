# MCP large-team readiness PR2 Apply Progress

Task 2.1: RED - Wrote failing API migration tests using Prisma integration harness.
Task 2.2: GREEN - Added TriageProposal, TriageProposalContent, TriageProposalLifecycleEvent, and TriagePolicy to Prisma schema with required properties. Created migration SQL and updated workspace service to inject a default policy on creation.
Task 2.3: TRIANGULATE - Wrote validation logic and test helpers to check upgrade scenarios, RESTRICT delete constraints, index generation, and terminal-event uniqueness.
Task 2.4: REFACTOR - Created ADR 0014 for the dedicated immutable triage ledger.
Task 2.5: REFACTOR - Isolated checks, verified everything via `pnpm test`, marked all tasks as complete.
