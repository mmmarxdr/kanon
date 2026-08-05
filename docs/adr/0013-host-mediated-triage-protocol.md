# ADR 0013: Host-Mediated Triage Protocol

## Context
Need for deterministic, read-only preview of triage without zero-write limits.

## Decision
Adopt a prepare-validate protocol relying on a host-assisted model and a bounded preview context.

## Consequences
- Requires zero domain writes during preview
- Reduces duplicate relations
- Bounds context to 15m expiration
