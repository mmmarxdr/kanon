# External PM Integrations — Current Status

> **Canonical continuation branch:** `feat/external-pm-integrations`
>
> Continue development from this branch. Reviewed child branches remain as
> work-unit history; each accepted child fast-forwards this cumulative branch.

## Snapshot

| Item | Current state |
| --- | --- |
| Canonical remote branch | `origin/feat/external-pm-integrations` |
| Published commit | `730229af93e62f1a8e9b0fbb28ac18bf213eac27` |
| OpenSpec progress | 11/31 complete; 20 pending |
| Dispatcher recommendation | `apply` |
| Next task | A1.9 — wire issue create/update/transition writers |
| Merged into `main` | No |
| End-to-end Kanon → Redmine | Not operational yet |
| Proposal success criteria | 0/8 proven end-to-end |

## Published on the canonical branch

The branch contains the accumulated implementation and SDD history through
A1.8b:

| Task | Delivered capability |
| --- | --- |
| A1.1 | Provider-neutral canonical integration contracts and ports |
| A1.2 | Connection lifecycle and project-binding persistence |
| A1.3 | External identity and credential-health persistence |
| A1.4 | Durable integration work/outbox persistence |
| A1.5 | Inbound application and conflict persistence |
| A1.6 | Tenant-safe binding backfill and transaction gate |
| A1.7 | Transactional outbox capture and read-only due-work scanner |
| A1.8a | Settled Issue mutation contract and canonical capture payload |
| A1.8b | Owned issue mutation transaction and mandatory awaited outbox capture |

The complete SDD artifacts are also present:

- `proposal.md`
- `design.md`
- `specs/pm-integration-core/spec.md`
- `specs/pm-integration-connection/spec.md`
- `specs/pm-integration-outbound-sync/spec.md`
- `specs/pm-integration-inbound-sync/spec.md`
- `specs/pm-integration-admin-ui/spec.md`
- `tasks.md`
- `apply-progress.md`
- `review-ledger.md`

## Functional reality

Kanon does **not** send changes to Redmine yet. The persistence, outbox, and
contract foundations exist, but the following runtime pieces do not:

- Redmine HTTP client and provider adapter
- Connection and credential API/service
- Issue/cycle writer integration
- Event listener and enqueue wiring
- Claim/lease worker
- Retry and dead-letter processing
- Live Redmine API validation

## Remaining work for Kanon → Redmine

The approved plan has 13 remaining tasks on the outbound critical path.

### Wire local mutation capture

- [ ] **A1.9** — wire issue create/update/transition writers
- [ ] **A1.10** — wire batch/group operations
- [ ] **A1.11** — wire cycle and delete operations
- [ ] **A1.12** — extract/register the scheduler

### Build the Redmine integration

- [ ] **A2.1** — SSRF and DNS-rebinding protection
- [ ] **A2.2** — `RedmineHttpClient`
- [ ] **A2.3** — `RedmineProviderAdapter`

### Add connection and credential lifecycle

- [ ] **A3.1** — connection lifecycle, service, and endpoints
- [ ] **A3.2** — credentials, validation, and key rotation

### Operate outbound synchronization

- [ ] **A4.1** — event listener and enqueue path
- [ ] **A4.2** — claims, leases, and epoch fencing
- [ ] **A4.3** — worker, retry, and dead-letter handling
- [ ] **A4.4** — ambiguous-result/conflict handling

After A4.4, the planned backend path is:

```text
Kanon mutation
  → transactional outbox
  → claim/lease worker
  → Redmine adapter
  → Redmine REST API
```

## Remaining work for the complete proposal

After outbound, seven additional tasks remain:

- A5.1–A5.3 — inbound Redmine → Kanon polling, conflict handling, and close
- A6.1–A6.3 — API coverage, owner/member UI, and end-to-end validation
- B1.1 — final binding hardening after the zero-unresolved proof

## Accepted A1.8a debt

A1.8a was published with an explicit maintainer exception:

- `size:exception`
- Current focused contract tests: 2/2
- Core regression tests: 5/5
- Direct TypeScript check: passed
- Forced Prettier check: passed
- Historical broader 20-case coverage was reduced and is recorded as follow-up
  debt in `review-ledger.md`

This debt does not mean outbound synchronization is complete. A1.9 and all
runtime/provider work listed above remain mandatory.

## Source of truth

- Product scope and success criteria: `proposal.md`
- Architecture: `design.md`
- Executable implementation sequence: `tasks.md`
- Implementation evidence: `apply-progress.md`
- Findings and accepted exceptions: `review-ledger.md`
