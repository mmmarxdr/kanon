# 14. Dedicated Immutable Triage Ledger

Date: 2026-08-05

## Status

Accepted

## Context

We need to store large-scale MCP triage proposals (issue search, preview, and apply operations) without corrupting or entangling with the existing `McpProposal` records, which serve different lifecycle semantics and have varied legacy dependencies. Modifying `McpProposal` in place would introduce substantial risk to existing deployments. Additionally, the new proposals must remain immutable over time for auditability, and their lifecycles (pending, dismissed, expired) must be trackable through an append-only event log.

## Decision

We will implement a **dedicated, immutable triage ledger** using four new database models:
1. `TriagePolicy`: Defines the retention limits and list visibility for a workspace.
2. `TriageProposal`: Stores the core identity, relations, and lifecycle summary of a proposal. It references target issues via a scalar `target_issue_id` to avoid locking overhead and strict referential constraints on the highly active `Issue` table.
3. `TriageProposalContent`: Stores the immutable payload and provenance context of a proposal.
4. `TriageProposalLifecycleEvent`: Provides an append-only audit trail for state changes (e.g., dismissal or expiration) of a proposal.

These models will use `ON DELETE RESTRICT` for internal relations to ensure a proposal cannot be silently orphaned or deleted by a policy or content deletion. We will use a unique constraint on `(proposal_id, state)` in `TriageProposalLifecycleEvent` to ensure terminal state transitions are idempotent.

## Consequences

- Existing `McpProposal` behavior remains completely untouched.
- Clean separation between core Issue metadata and Triage metadata.
- App-level cleanup logic must handle the `ON DELETE RESTRICT` cascading failure by explicitly deleting triage content and events before the parent proposal or policy.
- Retention workers can cleanly tombstone or remove records using the scalar references.
