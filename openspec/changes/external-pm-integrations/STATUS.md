# External PM Integrations — Current Status

> **Canonical continuation branch:** `feat/external-pm-integrations`
>
> Continue development from this branch. Reviewed child branches remain as
> work-unit history; each accepted child fast-forwards this cumulative branch.

## Snapshot

| Item | Current state |
| --- | --- |
| Canonical remote branch | `origin/feat/external-pm-integrations` |
| Published commit | PR #223 branch through A2.3 |
| OpenSpec progress | 18/31 complete locally; 13 pending |
| Dispatcher recommendation | `apply` |
| Next task | A3.1 — connection lifecycle and endpoints |
| Merged into `main` | No |
| End-to-end Kanon → Redmine | Not operational yet |
| Proposal success criteria | 0/8 proven end-to-end |

## Published on the canonical branch

The branch contains the accumulated implementation and SDD history through
A2.3:

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
| A1.9 | Issue create/update/transition capture |
| A1.10 | Batch and group transition capture |
| A1.11 | Cycle create/close/delete capture |
| A1.12 | Non-overlapping integration scanner scheduling |
| A2.1 | SSRF and DNS-rebinding guard |
| A2.2 | Redmine HTTP transport |
| A2.3 | Redmine provider adapter |

PR #223 is published through A2.3 and its cumulative full CI passed before the
public review fix pass. The six confirmed review fixes and five rejected
findings are recorded in `review-ledger.md`; A3.1 remains next.

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

- Connection and credential API/service
- Event listener and enqueue wiring
- Claim/lease worker
- Retry and dead-letter processing
- Live Redmine API validation

## Remaining work for Kanon → Redmine

The approved plan has 6 remaining tasks on the outbound critical path after local A2.3.

### Wire local mutation capture

- [x] **A1.9** — wire issue create/update/transition writers (published)
- [x] **A1.10** — wire batch/group operations (published)
- [x] **A1.11** — wire cycle and delete operations (published)
- [x] **A1.12** — extract/register the scheduler (published)

### Build the Redmine integration

- [x] **A2.1** — SSRF and DNS-rebinding protection (published)
- [x] **A2.2** — `RedmineHttpClient` (published)
- [x] **A2.3** — `RedmineProviderAdapter` (published)

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
