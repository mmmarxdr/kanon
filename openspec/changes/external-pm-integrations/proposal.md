# Proposal: External PM Integrations — Bidirectional Redmine Sync (amends ADR-0012)

## Intent

Developers work in Kanon; PMs run their process in Redmine. Today the two drift apart by hand. We want devs to stay in Kanon and PMs to stay in Redmine while both sides stay in sync **bidirectionally**: Kanon → Redmine (assignee, estimate, dates, progress, status) and Redmine → Kanon (notably "PM closes in Redmine → Kanon issue → done"). Success = an opt-in, per-workspace connection where a dev's change lands in Redmine attributed to the real user, a PM's close returns to Kanon, and admins can see who is/isn't covered — with no SSRF, no bricked credentials on key rotation, and no silent lost writes.

## Scope

### In Scope
- Provider-agnostic core (canonical model + `PmProviderAdapter` port + mapping/crypto) — KAN-182.
- Redmine adapter + `RedmineHttpClient` with **SSRF hardening** (scheme restriction, private-IP blocklist, anti-DNS-rebind at connect-time AND per-request) — KAN-183 (G1, CRITICAL).
- Connection/credential service + endpoints with a **defined bootstrap transaction** (empty connection → admin credential → set `serviceCredentialId`) and **`owner`-only** connection creation via `require-role.ts` — KAN-184 (G2 HIGH; G3 role-ceiling detection strategy resolved here/adapter).
- **Bidirectional sync engine** — KAN-185: outbound event-driven push + **inbound via `PollingInboundSource`** (extract the inlined `app.ts:262-278` self-rescheduling timer into a shared helper). Must actually build the PM-close → Kanon `done` flow. Explicit in-scope: **source-of-truth per field, conflict resolution when both sides changed, field-ownership**. Plus retry/dead-letter worker (G4), `issue.updated` `fields` filtering (G5), debounce/coalesce for batch storms (G9), orphaned-`ExternalRef` handling on hard-delete (G7).
- **Credential re-encryption migration tool** (decrypt old key → encrypt new key) + bulk undecryptable-row detector — KAN-184/185 (G6).
- Admin config UI + per-user connect + **sync-coverage visibility** ("X of Y assignees connected/syncing") — KAN-186 (G8).

### Out of Scope / Non-Goals
- Webhook inbound (`WebhookInboundSource`) — phase 2. The current Redmine 6.0.2 has no native
  webhooks; Redmine 7.0.0 can later add native webhook wake-ups without replacing durable polling
  and REST reconciliation.
- Jira / MS Project / Planner adapters — later adapters, core stays untouched.
- Custom Redmine fields, story-point mapping, per-project (multi-Redmine) connections.
- Redesigning the ADR-0012 canonical model / adapter architecture — kept as-is.

## Capabilities

### New Capabilities
- `pm-integration-core`: canonical model, `PmProviderAdapter` port, status/field mapping, AES-256-GCM crypto.
- `pm-integration-connection`: connection/credential lifecycle, bootstrap transaction, SSRF validation, `owner`-role gating, re-encryption tool.
- `pm-integration-outbound-sync`: event-driven Kanon → Redmine push, status/field maps, role-ceiling handling, retry/dead-letter, `fields` filtering, debounce.
- `pm-integration-inbound-sync`: `PollingInboundSource`, conflict resolution, field-ownership/source-of-truth, PM-close → `done`.
- `pm-integration-admin-ui`: admin config, per-user connect, sync-coverage panel.

### Modified Capabilities
- None at existing spec level. (Event-bus `issue.updated` payload may gain value/field context for G5 — additive, no existing spec covers it.)

## Approach

Keep ADR-0012's hexagonal core inside `packages/api/src/modules/integrations/` unchanged: canonical model + `PmProviderAdapter` outbound port + separate `InboundSource` port. This proposal **amends ADR-0012's phase boundaries only**: the ADR scoped inbound as designed-not-built and deferred bidirectional/conflict/field-ownership to phase 2 — those are now **in scope this cycle**. The added seam is the inbound path (`PollingInboundSource` feeding the same sync engine) plus an explicit **conflict-resolution / field-ownership** layer deciding, per field, which side wins when both changed. Mechanism detail (retry backoff, debounce window, ceiling-detection algorithm, conflict policy) is left to sdd-design; the proposal only fixes them as required, non-deferrable concerns.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `modules/integrations/core` | New | canonical model, ports, mapping, crypto (KAN-180/182 done/next) |
| `modules/integrations/providers/redmine` | New | adapter + HTTP client + SSRF guard |
| `modules/integrations/inbound` | New | shared polling helper + `PollingInboundSource` |
| `modules/integrations/{routes,service,sync-listener}.ts` | New | endpoints, bootstrap txn, sync engine, retry worker |
| `middleware/require-role.ts` | Modified | reuse for `owner`-gated connection creation |
| `services/event-bus` (`issue.updated`) | Possibly Modified | `fields` filtering / richer payload (G5) |
| `app.ts:262-278` | Modified | extract self-rescheduling timer into shared helper |
| `config/env.ts` + ops runbook | Modified | `INTEGRATION_ENCRYPTION_KEY` rotation + re-encryption tool |
| `packages/web` (admin settings) | New | config UI, per-user connect, sync-coverage panel |
| `packages/shared` | New | shared response/DTO types |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SSRF via admin `baseUrl` (G1) | High | connect-time + per-request IP validation; `owner`-only creation |
| Non-atomic connection bootstrap (G2) | High | defined ordered transaction; rollback on partial failure |
| Key rotation bricks credentials (G6) | Med | re-encryption tool + bulk undecryptable detector before rotation |
| Lost writes on Redmine outage (G4) | Med | retry/dead-letter worker; observable on `ExternalRef.metadata` |
| Bidirectional conflict / lost updates | Med | explicit field-ownership + conflict policy (design phase) |
| Event-storm on batch transition (G9) | Med | debounce/coalesce in sync-listener |
| **Scope >> ADR outbound MVP → oversized PR** | High | **Chained PRs required (KAN-182→186); flag to sdd-tasks** |

## Rollback Plan

Integration is opt-in and inert without a connection — a workspace with no `IntegrationConnection` is unaffected. Rollback = disable the connection (stop listeners/poller) and, if needed, revert the additive module + web surface. Prisma tables (KAN-180/181 done) are additive; leaving them in place is harmless. No data migration to unwind. Re-encryption tool is opt-in and reversible while both keys are held.

## Dependencies

- KAN-180 (crypto) and KAN-181 (Prisma schema) — DONE.
- `INTEGRATION_ENCRYPTION_KEY` env (prod-enforced, present).
- Live corp Redmine REST + rotated API token for validation.

## Success Criteria

- [ ] Dev change in Kanon lands in Redmine, attributed to the real user via their token.
- [ ] PM closes in Redmine → Kanon issue transitions to `done` (inbound polling, built not stubbed).
- [ ] Both-sides-changed conflicts resolve by a defined field-ownership policy — no silent lost update.
- [ ] `baseUrl` SSRF attempts (link-local/private/rebind) are rejected at connect and per request.
- [ ] Connection creation restricted to `owner`; admin cannot create one.
- [ ] Rotating `INTEGRATION_ENCRYPTION_KEY` via the re-encryption tool preserves all stored credentials.
- [ ] Admin sees sync-coverage ("X of Y assignees connected/syncing") per connection/project.
- [ ] Redmine outage → failed pushes redriven by the retry worker after recovery; none silently lost.
- [ ] Delivered as chained PRs, each with autonomous scope, verification, and rollback.
