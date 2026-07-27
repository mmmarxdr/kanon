# Tasks
|Σ P/T/D|2,980/4,400/320=7,700|max|350 High|
|Delivery strategy|auto-chain|Chain|feature-branch-chain|
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

A=`feat/external-pm-integrations` draft->main; children chain. B=`feat/external-pm-bindings-hardening` draft->main after A+immutable zero-unresolved proof; B1->B. Gate:plans-isolated;.atl/.codegraph-excluded. One-child;B proof-gated. `C=packages/api/src/modules/integrations`; `P=packages/api/prisma/schema.prisma`; `I=packages/api/src/modules/issue`; `Y=packages/api/src/modules/cycle`; `W=packages/web/src/features/integrations`; `A=pnpm --filter @kanon/api test --`; `D=pnpm --filter @kanon/api test:db:setup`; `E=pnpm e2e`; `AT(f)=A C/f`; `DT(f)=D && A C/f`; `WT(f)=pnpm --filter @kanon/web test -- W/f`; R=expected-fail; `F=extract/dedupe/rename+V`; `Hdb=Prisma-transaction-rollback`; `Hm=redmine-mock-response`; `Hc=undici-DNS-private-reject`; `M1l=packages/api/prisma/migrations/20260720_pm_lifecycle_binding/migration.sql`; `M1i=packages/api/prisma/migrations/20260721_pm_identity_health/migration.sql`; `M1w=packages/api/prisma/migrations/20260722_pm_work_outbox/migration.sql`; `M1a=packages/api/prisma/migrations/20260723_pm_inbound_application_conflict/migration.sql`; `M2=packages/api/prisma/migrations/20260724_pm_binding_hardening/migration.sql`; `X={HC:C/providers/redmine/http-client.ts,HA:C/providers/redmine/adapter.ts,HR:C/routes.ts,HS:C/service.ts,HL:C/sync-listener.ts,HW:C/worker.ts,HP:C/inbound/service.ts,RO:docs/adr/0012-external-pm-integrations-redmine.md,EE:packages/e2e/tests/external-pm-integrations.spec.ts}`; e=P/T/D.

Migration naming correction (maintainer-approved, forward-only): A1.3–A1.5 and B1.1 use unique monotonically later prefixes so Prisma migration order follows their dependency chain; committed A1.2 remains unchanged.

## A
- [x] A1.1 📍`feat/pm-182-types -> feat/external-pm-integrations` K182 R:AT(core/types.test.ts){omit} G:C/core/types.ts V:AT(core/types.test.ts) F:C/core/types.ts H:N/A-pure RB:C/core/types.ts; e=80/130/10=220.
- [x] A1.2 📍`feat/pm-182-life -> feat/pm-182-types` K182 R:DT(lifecycle.test.ts){draft} G:P+M1l V:DT(lifecycle.test.ts) F:M1l H:Hdb RB:additive-M1l; e=120/140/10=270.
- [x] A1.3 📍`feat/pm-182-id -> feat/pm-182-life` K182 R:DT(identity.test.ts){fresh} G:P+M1i V:DT(identity.test.ts) F:M1i H:Hdb RB:additive-M1i; e=90/130/10=230.
- [x] A1.4 📍`feat/pm-182-work -> feat/pm-182-id` K182 R:DT(work.test.ts){lane} G:P+M1w V:DT(work.test.ts) F:M1w H:Hdb RB:additive-M1w; e=120/160/10=290.
- [x] A1.5 📍`feat/pm-182-app -> feat/pm-182-work` K182 R:DT(application.test.ts){tuple} G:P+M1a V:DT(application.test.ts) F:M1a H:Hdb RB:additive-M1a; e=110/150/10=270.
- [x] A1.6 📍`feat/pm-182-backfill -> feat/pm-182-app` K182 R:DT(backfill.test.ts){zero} G:C/backfill.ts V:DT(backfill.test.ts) F:C/backfill.ts H:Hdb RB:fix-forward; e=70/90/20=180.
  - [x] A1.6a core slice — `feat/pm-182-backfill-core -> feat/pm-182-app`: deterministic tenant-safe backfill only; snapshot result, not an immutable zero-unresolved proof.
  - [x] Final gate slice — `feat/pm-182-backfill -> feat/pm-182-backfill-core`: advisory/writer coordination and the final proof; this completes A1.6.
- [ ] A1.7 📍`feat/pm-182-outbox -> feat/pm-182-backfill` K182 R:DT(outbox.int.test.ts){atomic} G:C/outbox.ts captureIntegrationWorkTx/scanner V:DT(outbox.int.test.ts) F:C/outbox.ts H:Hdb RB:C/outbox.ts; e=130/190/10=330.
- [ ] A1.8 📍`feat/pm-182-tx -> feat/pm-182-outbox` K182 R:DT(issue-tx.test.ts){tx} G:C/issue-tx.ts V:DT(issue-tx.test.ts) F:C/issue-tx.ts H:Hdb RB:C/issue-tx.ts; e=100/140/10=250.
- [ ] A1.9 📍`feat/pm-182-issue -> feat/pm-182-tx` K182 R:DT(issue-writers.test.ts){create} G:I/service.ts V:DT(issue-writers.test.ts) F:extract(I/service.ts)+V H:Hdb RB:I/service.ts/revert-tx-capture; e=90/140/10=240.
- [ ] A1.10 📍`feat/pm-182-group -> feat/pm-182-issue` K182 R:DT(group.test.ts){batch} G:I/service.ts V:DT(group.test.ts) F:dedupe(I/service.ts)+V H:Hdb RB:I/service.ts/revert-group-capture; e=80/130/10=220.
- [ ] A1.11 📍`feat/pm-182-cycle -> feat/pm-182-group` K182 R:DT(cycle.test.ts){delete} G:Y/service.ts+Y/delete-cycle.ts V:DT(cycle.test.ts) F:extract(Y/service.ts)+V H:Hdb RB:Y/service.ts+Y/delete-cycle.ts/revert-capture; e=110/160/10=280.
- [ ] A1.12 📍`feat/pm-182-auto -> feat/pm-182-cycle` K182 R:AT(auto.test.ts){shutdown} G:C/scheduler.ts+packages/api/src/app.ts V:AT(auto.test.ts) F:extract(C/scheduler.ts)+V H:clock-stop RB:C/scheduler.ts+packages/api/src/app.ts/revert-registration; e=80/120/10=210.
- [ ] A2.1 📍`feat/pm-183-ssrf -> feat/pm-182-auto` K183 R:AT(net-guard.test.ts){rebind} G:HC V:AT(net-guard.test.ts) F:extract(HC)+V H:Hc RB:HC/revert-connector; e=140/200/10=350.
- [ ] A2.2 📍`feat/pm-183-http -> feat/pm-183-ssrf` K183 R:AT(http.test.ts){timeout} G:HC+packages/api/package.json+pnpm-lock.yaml V:AT(http.test.ts) F:dedupe(HC)+V H:Hm RB:HC/revert-client; e=120/170/10=300.
- [ ] A2.3 📍`feat/pm-183-adapter -> feat/pm-183-http` K183 R:AT(adapter.test.ts){marker} G:HA V:AT(adapter.test.ts) F:extract(HA)+V H:Hm RB:HA/revert-adapter; e=130/180/10=320.
- [ ] A3.1 📍`feat/pm-184-life -> feat/pm-183-adapter` K184 R:DT(lifecycle.test.ts){owner} G:HR+HS V:DT(lifecycle.test.ts) F:extract(HR)+V H:Hdb RB:HR/revert-registration; e=110/170/10=290.
- [ ] A3.2 📍`feat/pm-184-creds -> feat/pm-184-life` K184 R:DT(credentials.test.ts){reverse} G:HS+RO V:DT(credentials.test.ts) F:dedupe(HS)+V H:Hdb RB:old/new-keys; e=120/190/20=330.
- [ ] A4.1 📍`feat/pm-185-enqueue -> feat/pm-184-creds` K185 R:DT(listener.test.ts){actor-http} G:HL+packages/api/src/app.ts V:DT(listener.test.ts) F:extract(HL)+V H:clock RB:HL/revert-registration; e=110/180/10=300.
- [ ] A4.2 📍`feat/pm-185-claims -> feat/pm-185-enqueue` K185 R:DT(claims.test.ts){fence} G:C/claims.ts V:DT(claims.test.ts) F:dedupe(C/claims.ts)+V H:Hdb RB:C/claims.ts/revert-claim; e=100/160/10=270.
- [ ] A4.3 📍`feat/pm-185-retry -> feat/pm-185-claims` K185 R:DT(retry.test.ts){dead} G:HW+packages/api/src/app.ts V:DT(retry.test.ts) F:extract(HW)+V H:Hdb RB:HW/revert-registration; e=100/130/10=240.
- [ ] A4.4 📍`feat/pm-185-ambiguity -> feat/pm-185-retry` K185 R:DT(ambiguity.test.ts){conflict} G:HW V:DT(ambiguity.test.ts) F:dedupe(HW)+V H:Hdb RB:HW/revert-ambiguity; e=100/150/10=260.
- [ ] A5.1 📍`feat/pm-192-poll -> feat/pm-185-ambiguity` K192 R:DT(inbound-replay.test.ts){lease} G:HP+packages/api/src/app.ts V:DT(inbound-replay.test.ts) F:extract(HP)+V H:Hm RB:HP/revert-registration; e=130/200/10=340.
- [ ] A5.2 📍`feat/pm-192-conflict -> feat/pm-192-poll` K192 R:DT(conflict.test.ts){echo} G:HP V:DT(conflict.test.ts) F:dedupe(HP)+V H:Hdb RB:HP/revert-origin; e=110/160/10=280.
- [ ] A5.3 📍`feat/pm-192-close -> feat/pm-192-conflict` K192 R:DT(inbound-close.test.ts){time} G:HP V:DT(inbound-close.test.ts) F:extract(HP)+V H:Hdb RB:HP/revert-close; e=120/180/10=310.
- [ ] A6.1 📍`feat/pm-186-api -> feat/pm-192-close` K186 R:DT(coverage.test.ts){degraded} G:HR+packages/shared/src/integrations.ts V:DT(coverage.test.ts) F:extract(HR)+V H:Hdb RB:HR/revert-endpoints; e=120/170/10=300.
- [ ] A6.2 📍`feat/pm-186-owner -> feat/pm-186-api` K186 R:WT(owner.test.tsx){admin} G:W/owner.tsx V:WT(owner.test.tsx) F:W/owner.tsx H:TestingLibrary RB:W/owner.tsx; e=100/170/10=280.
- [ ] A6.3 📍`feat/pm-186-member -> feat/pm-186-owner` K186 R:WT(member.test.tsx){member} G:W/member.tsx+EE+RO V:WT(member.test.tsx)&&E F:extract(W/member.tsx)+V H:Playwright-close RB:W/member.tsx+EE+RO/revert-fixture-docs-preserve-data; e=120/210/20=350.
## B
- [ ] B1.1 📍`feat/pm-bindings-m2 -> feat/external-pm-bindings-hardening` K182 R:DT(binding-hardening.test.ts){restrict} G:P+M2 V:DT(binding-hardening.test.ts) F:M2 H:immutable-proof RB:fix-forward; e=70/100/20=190.
PMIC-01{canonical,inbound}->A1.1; PMIC-02{omit,set,clear,confirmed,rejected}->A1.1/A3.1; PMIC-03{cipher,fail}->A3.2; PMCN-01{draft,bind,403}->A3.1; PMCN-02{bootstrap,no-fallback,rollback,disable}->A3.1; PMCN-03{public,rebind,no-persist}->A2.1; PMCN-04{rotate,detect}->A3.2; PMOS-01{actor,missing}->A4.1; PMOS-02{timeout,persist}->A4.4/A1.4; PMOS-03{redrive,dead,requeue}->A4.3; PMOS-04{irrelevant,burst}->A4.1; PMOS-05{actual}->A2.3; PMIS-01{close,time,audit,blocker,unlinked}->A5.1/A5.3; PMIS-02{replay,both}->A5.1/A5.2; PMIS-03{echo,later}->A5.2; PMIS-04{delete}->A1.11; PMAU-01{complete,incomplete}->A6.2; PMAU-02{connect,clear}->A6.3; PMAU-03{ratios,uncovered,degraded,readonly}->A6.1. Shared-build pre-consumer;no-general-builds.
