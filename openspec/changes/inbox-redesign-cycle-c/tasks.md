# Tasks: inbox-redesign-cycle-c

> 4 phases + verificación final. Strict TDD enforced — cada IMPLEMENT task está precedido por el TEST task que cubre la misma superficie. El backend debe completarse antes de tocar frontend.
>
> Referencia de diseño: `design.md` §1-8. Specs: `specs/added/` + `specs/modified/`.

---

## Phase A — Backend foundation (Prisma + bridge + service helpers + routes)

> Orden interno estricto: modelo → bridge → parser → updateComment → route PATCH → wiring en Comment/Issue → computeAvgLeadDays → resolveActiveCycle → bridge KPIs → dashboard extension.

### A1 — Mention model + migration

- [x] A1.1 TEST — Verificar que el schema Prisma incluye el modelo `Mention` con todos sus campos, FKs, unique constraint y 3 índices — Archivo: `packages/api/prisma/__tests__/mention-schema.test.ts` (snapshot del output de `prisma validate` o comparar `schema.prisma` contra la forma esperada). — Refs: REQ-MENTION-001 — Acceptance: test describe la shape completa del modelo y pasa en verde (schema ya actualizado en A1.2).
- [x] A1.2 IMPLEMENT — Agregar `model Mention` a `packages/api/prisma/schema.prisma` (campos, FKs, unique `(commentId, mentionedMemberId)`, 3 índices, back-relations en Workspace/Issue/Comment/Member) y ejecutar `pnpm --filter @kanon/api prisma migrate dev --name add_mention` — Refs: design §2.1 — Acceptance: migración aplica sin errores, `npx prisma validate` pasa, tablas `mentions` existe en DB de desarrollo con los índices listados.

### A2 — Bridge Zod schemas

- [x] A2.1 TEST — Test de round-trip parse/serialize para `activeCycleKPIsSchema`: parsear un objeto válido pasa, `avgLeadDays: null` es aceptado, `avgLeadDays: 0` (no null) es aceptado como número válido — Archivo: `packages/bridge/src/__tests__/dashboard.test.ts` — Refs: REQ-INBOX-CYCLE-002, design §2.2 — Acceptance: todos los escenarios de validación Zod pasan.
- [x] A2.2 TEST — Test de round-trip para `mentionDashboardItemSchema`: parsear objeto válido pasa, `commentId: null` es aceptado, `commentId: "uuid"` es aceptado — Archivo: `packages/bridge/src/__tests__/dashboard.test.ts` (mismo archivo, suite adicional) — Refs: REQ-MENTION-007, design §2.3 — Acceptance: parse con null y con uuid pasan; parse con string vacío falla.
- [x] A2.3 TEST — Test de round-trip para `dashboardResponseSchema`: composite con `activeCycle: null` y `activeCycle: ActiveCycleKPIs` pasan; `mentions: []` y `mentions: [MentionDashboardItem]` pasan; `multipleActiveProjects: boolean` requerido — Archivo: `packages/bridge/src/__tests__/dashboard.test.ts` — Refs: REQ-API-DASHBOARD-002, REQ-API-DASHBOARD-005, design §2.4 — Acceptance: todos los casos Zod pasan.
- [x] A2.4 IMPLEMENT — Crear `packages/bridge/src/dashboard.ts` con `activeCycleKPIsSchema`, `mentionDashboardItemSchema`, `dashboardResponseSchema` y sus exports de tipos; re-exportar desde `packages/bridge/src/index.ts` — Refs: design §2.2-2.4, §5 tabla API surface — Acceptance: `pnpm --filter @kanon/bridge build` (o typecheck) pasa sin errores; A2.1-A2.3 pasan.

### A3 — Mention parser (parseAndUpsertMentions)

- [x] A3.1 TEST — `parseAndUpsertMentions`: extrae exactamente las @menciones que coinciden con usernames activos del workspace (case-sensitive) — Archivo: `packages/api/src/modules/mentions/__tests__/service.test.ts` — Refs: REQ-MENTION-002 escenarios 1-3 — Acceptance: mock de `prisma.member.findMany` retorna alice+bob; body `"@alice @bob"` genera createMany con 2 entries; body `"@phantom"` no llama createMany.
- [x] A3.2 TEST — `parseAndUpsertMentions`: excluye auto-menciones (`mentionedMemberId === mentionedByMemberId`) — Archivo: mismo — Refs: REQ-MENTION-005 escenarios 1-3 — Acceptance: alice menciona `"@alice"` → no mention rows creados; alice menciona `"@bob @alice"` → solo 1 row para bob.
- [x] A3.3 TEST — `parseAndUpsertMentions`: idempotencia DELETE+INSERT — re-save del mismo body produce el mismo estado final sin duplicados — Archivo: mismo — Refs: design §3.3 algoritmo, REQ-MENTION-003 escenario 1 — Acceptance: llamar 2 veces con el mismo body+commentId resulta en exactamente 1 row por mencionado (el deleteMany previo limpia antes del insert).
- [x] A3.4 TEST — `parseAndUpsertMentions` (update removes mentions): body cambia de `"@alice algo"` a `"ok"` → fila de alice desaparece — Archivo: mismo — Refs: REQ-MENTION-003 escenario 2 — Acceptance: mock recibe deleteMany con `commentId = "cmt-1"`, luego no recibe createMany (targets vacíos).
- [x] A3.5 TEST — `parseAndUpsertMentions` (description mode): `commentId = null` → deleteMany usa `{ issueId, commentId: null }` y no `{ commentId }` — Archivo: mismo — Refs: REQ-MENTION-004 escenario 1, design §3.3 — Acceptance: spy de deleteMany recibe `where: { issueId: "iss-1", commentId: null }`.
- [x] A3.6 IMPLEMENT — Crear `packages/api/src/modules/mentions/service.ts` con `parseAndUpsertMentions(args)` según algoritmo de design §3.3 (regex `/@(\w+)/g`, resolve members, exclude self, buildContext, DELETE+INSERT dentro de tx si se pasa) — Refs: design §3.3 — Acceptance: A3.1-A3.5 pasan; el archivo exporta `parseAndUpsertMentions`.

### A4 — updateComment service

- [x] A4.1 TEST — `updateComment(commentId, body, memberId)`: persiste el nuevo body en DB (mock de `prisma.comment.update`), crea un activityLog `edited`, llama `parseAndUpsertMentions` con el nuevo body y el `commentId` correcto — Archivo: `packages/api/src/modules/comment/__tests__/service.test.ts` — Refs: REQ-MENTION-003 escenarios 1-2, design §3.3 tabla call sites — Acceptance: spies de prisma.comment.update, activityLog.create y parseAndUpsertMentions reciben los argumentos esperados.
- [x] A4.2 TEST — `updateComment`: solo el autor puede actualizar (memberId debe coincidir con `comment.memberId`) — lanza error 403 si difiere — Archivo: mismo — Refs: design §3.3 (`requireIssueRole`, auth) — Acceptance: mock retorna comment con `memberId = "m-other"`; updateComment lanza `ForbiddenError` o equivalente cuando memberId es distinto.
- [x] A4.3 IMPLEMENT — Agregar `updateComment(commentId: string, body: string, memberId: string): Promise<Comment>` a `packages/api/src/modules/comment/service.ts`: valida autoría, `prisma.comment.update`, activityLog `edited`, llama `parseAndUpsertMentions` en try/catch best-effort (patrón `recordCycleScopeEvent`) — Refs: design §3.3, §5 tabla API surface — Acceptance: A4.1-A4.2 pasan; función exportada.

### A5 — PATCH /api/comments/:id route

- [x] A5.1 TEST — `PATCH /api/comments/:id` con body válido retorna 200 y el comment actualizado — Test con `fastify.inject()` — Archivo: `packages/api/src/modules/comment/__tests__/routes.test.ts` — Refs: design §3.3, §5 — Acceptance: inject POST→create comment, luego PATCH→update body; respuesta 200 con `body` actualizado.
- [x] A5.2 TEST — `PATCH /api/comments/:id`: usuario no-autor recibe 403 — Archivo: mismo — Refs: design §3.3 auth — Acceptance: inject como usuario B sobre comment creado por usuario A → 403.
- [x] A5.3 TEST — `PATCH /api/comments/:id`: body vacío o ausente retorna 400 — Archivo: mismo — Refs: validación Zod — Decisión: el error handler del proyecto devuelve 400 (no 422) para errores Zod; documentado en apply-progress.
- [x] A5.4 IMPLEMENT — Registrar `PATCH /api/comments/:id` en `packages/api/src/modules/comment/routes.ts`: Zod body `{ body: z.string().min(1) }`, resuelve member via comment→workspace lookup, llama `updateComment(commentId, body, member.id)`, retorna 200 con comment — Refs: design §3.3, §5 — Acceptance: A5.1-A5.3 pasan.

### A6 — Wire parseAndUpsertMentions en Comment.create + Issue.create + Issue.update

- [x] A6.1 TEST — `createComment` llama `parseAndUpsertMentions` con el `commentId` correcto después de crear el comment — Archivo: `packages/api/src/modules/comment/__tests__/service.test.ts` — Refs: REQ-MENTION-003 escenario 1 (creación), design §3.3 tabla call sites — Acceptance: spy de `parseAndUpsertMentions` es llamado con `{ commentId: comment.id, body, issueId, workspaceId, authorMemberId }`.
- [x] A6.2 TEST — `createIssue` llama `parseAndUpsertMentions` con `commentId: null` cuando `description` no es null ni vacío; NO llama cuando `description` es null — Archivo: `packages/api/src/modules/issue/__tests__/service.test.ts` — Refs: REQ-MENTION-004 escenarios 1+3 — Acceptance: dos tests: uno con description → spy llamado con commentId=null; otro sin description → spy no llamado.
- [x] A6.3 TEST — `updateIssue` llama `parseAndUpsertMentions` con `commentId: null` cuando el patch incluye `description`; NO llama cuando el patch no incluye `description` — Archivo: mismo — Refs: REQ-MENTION-004 escenario 2 — Acceptance: spy de parseAndUpsertMentions llamado solo cuando `body.description !== undefined`.
- [x] A6.4 IMPLEMENT — Modificar `packages/api/src/modules/comment/service.ts` → `createComment`: agregar llamada `parseAndUpsertMentions` en try/catch después de `prisma.comment.create` — Refs: design §3.3 tabla call sites — Acceptance: A6.1 pasa; createComment sigue funcionando cuando parseAndUpsertMentions lanza (best-effort).
- [x] A6.5 IMPLEMENT — Modificar `packages/api/src/modules/issue/service.ts` → `createIssue` y `updateIssue`: agregar llamada `parseAndUpsertMentions` con `commentId: null` cuando `description` presente — Refs: design §3.3 tabla call sites — Acceptance: A6.2-A6.3 pasan.

### A7 — computeAvgLeadDays

- [x] A7.1 TEST — `computeAvgLeadDays`: ciclo sin issues → `null` sin emitir query a activityLogs — Archivo: `packages/api/src/modules/cycle/__tests__/service.test.ts` — Refs: REQ-CYCLE-LEAD-TIME-001 escenario 1, REQ-CYCLE-LEAD-TIME-002 escenario 2 — Acceptance: mock de `prisma.issue.findMany` retorna `[]`; spy de `prisma.activityLog.findMany` NOT called; resultado es `null`.
- [x] A7.2 TEST — `computeAvgLeadDays`: 1 issue con evento state_changed→done, done_at - createdAt = 5.5 días → retorna `5.5` — Archivo: mismo — Refs: REQ-CYCLE-LEAD-TIME-001 escenario 2 — Acceptance: mock retorna 1 issue y 1 activityLog con `details.newValue = "done"`; resultado es `5.5`.
- [x] A7.3 TEST — `computeAvgLeadDays`: 3 issues, 2 con evento (deltas: 2d, 4d), 1 sin evento → retorna `3.0` (promedio de 2 y 4; tercero excluido) — Archivo: mismo — Refs: REQ-CYCLE-LEAD-TIME-001 escenario 3, REQ-INBOX-CYCLE-003 escenario 1 — Acceptance: resultado es exactamente `3.0`.
- [x] A7.4 TEST — `computeAvgLeadDays`: 1 issue con done_at = createdAt (delta = 0 horas) → retorna `0.0` (no null) — Archivo: mismo — Refs: REQ-CYCLE-LEAD-TIME-003 escenario 3, design §3.1 edge handling — Acceptance: resultado es `0` (zero, not null).
- [x] A7.5 TEST — `computeAvgLeadDays` (anti N+1): 50 issues → exactamente 1 query a activityLogs — Archivo: mismo — Refs: REQ-INBOX-CYCLE-004 escenario 1, REQ-CYCLE-LEAD-TIME-002 escenario 1 — Acceptance: spy de `prisma.activityLog.findMany` llamado exactamente 1 vez con `issueId: { in: [...] }`.
- [x] A7.6 IMPLEMENT — Agregar `computeAvgLeadDays(cycleId: string): Promise<number | null>` a `packages/api/src/modules/cycle/service.ts` según algoritmo de design §3.1 (batch issues + batch activityLogs → in-memory lastDoneByIssue Map → promedio de deltas) — Refs: design §3.1 — Acceptance: A7.1-A7.5 pasan; función exportada.

### A8 — resolveActiveCycleForWorkspace

- [x] A8.1 TEST — `resolveActiveCycleForWorkspace`: workspace sin ciclos activos → retorna `null` — Archivo: `packages/api/src/modules/cycle/__tests__/service.test.ts` — Refs: REQ-INBOX-CYCLE-001 escenario 2, design §3.2 — Acceptance: mock de `prisma.cycle.findMany` retorna `[]`; resultado es `null`.
- [x] A8.2 TEST — `resolveActiveCycleForWorkspace`: workspace con 2 proyectos con ciclos activos (startDates: "2026-04-21" y "2026-05-01") → retorna el de "2026-05-01" con `multipleActiveProjects: true` — Archivo: mismo — Refs: REQ-INBOX-CYCLE-001 escenario 1, REQ-API-DASHBOARD-005 escenario 1 — Acceptance: resultado tiene `cycle.startDate` = "2026-05-01" y `multipleActiveProjects = true`.
- [x] A8.3 TEST — `resolveActiveCycleForWorkspace`: tiebreaker con misma startDate → retorna el de id lexicográfico menor — Archivo: mismo — Refs: REQ-INBOX-CYCLE-001 (`id ASC` tiebreaker), design §3.2 — Acceptance: mock retorna 2 cycles misma startDate, ids "b..." y "a..."; resultado tiene el de id "a...".
- [x] A8.4 TEST — `resolveActiveCycleForWorkspace`: workspace con exactamente 1 ciclo activo → `multipleActiveProjects: false` — Archivo: mismo — Refs: REQ-API-DASHBOARD-005 escenario 2 — Acceptance: resultado tiene `multipleActiveProjects = false`.
- [x] A8.5 IMPLEMENT — Agregar `resolveActiveCycleForWorkspace(workspaceId: string)` a `packages/api/src/modules/cycle/service.ts` según algoritmo de design §3.2 (una sola query con orderBy startDate DESC, id ASC; Set de projectIds para flag) — Refs: design §3.2 — Acceptance: A8.1-A8.4 pasan; función exportada.

### A9 — Dashboard route extension (integration tests + implementation)

- [ ] A9.1 TEST — Dashboard: workspace con 0 ciclos activos → `activeCycle: null`, `multipleActiveProjects: false` — Archivo: `packages/api/src/modules/dashboard/__tests__/dashboard-cycle-c.integration.test.ts` (nuevo archivo, usando `fastify.inject`) — Refs: REQ-API-DASHBOARD-002 escenario 2, REQ-API-DASHBOARD-005 escenario 3 — Acceptance: inject GET /api/workspaces/:id/dashboard → 200, body.activeCycle === null, body.multipleActiveProjects === false.
- [ ] A9.2 TEST — Dashboard: workspace con 1 ciclo activo → `activeCycle` populado con shape completa `ActiveCycleKPIs`, `multipleActiveProjects: false` — Archivo: mismo — Refs: REQ-API-DASHBOARD-002 escenario 1, REQ-INBOX-CYCLE-002 escenario 1 — Acceptance: todos los campos de `activeCycle` presentes con tipos correctos (id string, donePct number 0-100, avgLeadDays number|null, burnup number[]).
- [ ] A9.3 TEST — Dashboard: workspace con 2 ciclos activos en proyectos distintos → `activeCycle` es el de startDate más reciente, `multipleActiveProjects: true` — Archivo: mismo — Refs: REQ-API-DASHBOARD-002 escenario 3, REQ-API-DASHBOARD-005 escenario 1 — Acceptance: activeCycle.startDate = la fecha más reciente; multipleActiveProjects = true.
- [ ] A9.4 TEST — Dashboard: alice tiene 3 menciones en W1 → `mentions` retorna 3 items con shape `MentionDashboardItem` — Archivo: mismo — Refs: REQ-API-DASHBOARD-003 escenario 1, REQ-MENTION-007 escenario 1 — Acceptance: mentions.length === 3; cada item tiene todos los campos requeridos.
- [ ] A9.5 TEST — Dashboard: aislamiento multi-tenant — alice llama W1 dashboard, tiene menciones en W1 y W2 → solo ve las de W1 — Archivo: mismo (o `mentions-isolation.integration.test.ts`) — Refs: REQ-API-DASHBOARD-004 escenario 1, REQ-MENTION-006 escenario 2 — Acceptance: mentions.length === conteo de W1 únicamente.
- [ ] A9.6 TEST — Dashboard: bob llama W1 dashboard donde solo hay menciones para alice → `mentions: []` — Archivo: mismo — Refs: REQ-API-DASHBOARD-003 escenario 3, REQ-MENTION-006 escenario 3 — Acceptance: body.mentions es array vacío `[]`.
- [ ] A9.7 TEST — Dashboard: comment creado con `@alice` → comment en response + 1 Mention row en DB → llamada al dashboard de alice retorna esa mención — Archivo: mismo (test de integración end-to-end en API) — Refs: REQ-MENTION-002 escenario 1, REQ-MENTION-003 escenario 1, design §3.4 — Acceptance: flujo create-comment-with-mention → get-dashboard verifica mención en respuesta.
- [ ] A9.8 IMPLEMENT — Extender el handler de `GET /api/workspaces/:id/dashboard` en `packages/api/src/modules/dashboard/routes.ts`: añadir `resolveActiveCycleForWorkspace`, `computeAvgLeadDays`, `getCycle` y query de mentions al `Promise.all`; componer `activeCycle: ActiveCycleKPIs | null` y `mentions: MentionDashboardItem[]`; añadir `multipleActiveProjects` al return — Refs: design §3.4 — Acceptance: A9.1-A9.7 pasan; handler retorna los 3 campos nuevos.

---

## Phase B — Frontend KAN-27 (CurrentCycleCard + Sparkline)

> Prerequisito: Phase A completa. El bridge ya exporta `ActiveCycleKPIs`; el dashboard endpoint ya retorna `activeCycle`.

### B1 — DashboardData type extension

- [ ] B1.1 TEST — `useDashboardQuery`: el tipo `DashboardData` inferido del schema bridge incluye `activeCycle: ActiveCycleKPIs | null` y `multipleActiveProjects: boolean` — Archivo: `packages/web/src/features/inbox/__tests__/use-dashboard-query.test.ts` — Refs: REQ-INBOX-CYCLE-007, design §2.4 — Acceptance: test de tipos TypeScript (o runtime con un objeto de prueba): `data.activeCycle` puede ser null; `data.multipleActiveProjects` es boolean; `data.mentions` es `MentionDashboardItem[]` (no `unknown[]`).
- [ ] B1.2 IMPLEMENT — Modificar `packages/web/src/features/inbox/use-dashboard-query.ts`: reemplazar la interfaz `DashboardData` manual por `z.infer<typeof dashboardResponseSchema>` importado desde `@kanon/bridge`; mantener el mismo `queryKey` (`dashboardKeys.detail(workspaceId)`) — Refs: design §2.4, REQ-INBOX-CYCLE-007 — Acceptance: B1.1 pasa; `pnpm --filter @kanon/web typecheck` sin errores nuevos relacionados con DashboardData.

### B2 — Sparkline subcomponente

- [ ] B2.1 TEST — `Sparkline`: con `values=[0,1,3,5,6]` renderiza un elemento `<svg>` con `data-testid="sparkline"` que contiene un `<path>` (no vacío) — Archivo: `packages/web/src/features/inbox/__tests__/current-cycle-card.test.tsx` — Refs: REQ-INBOX-CYCLE-005 escenario 1, design §4.1 — Acceptance: `getByTestId("sparkline")` existe; su HTML incluye un atributo `d` no vacío en el path.
- [ ] B2.2 TEST — `Sparkline`: con `values=[]` renderiza el SVG sin lanzar error (path vacío o "M 0,36") — Archivo: mismo — Refs: REQ-INBOX-CYCLE-002 escenario 1 (burnup puede ser array vacío en ciclo nuevo) — Acceptance: render no lanza; SVG existe en DOM.
- [ ] B2.3 IMPLEMENT — Implementar `Sparkline` como subcomponente local en `packages/web/src/features/inbox/current-cycle-card.tsx` (no exportado): normaliza values a espacio [0,280]×[0,36], genera `<path>` lineal `M x0,y0 L xi,yi …` + cierre de área, stroke `var(--accent)`, fill `var(--accent-2)` — Refs: design §4.1 — Acceptance: B2.1-B2.2 pasan.

### B3 — CurrentCycleCard (estados: normal, avgLead null, activeCycle null)

- [ ] B3.1 TEST — `CurrentCycleCard`: con `activeCycle` normal renderiza sparkline, `donePct`, `avgLeadDays`, `velocity` en sus testids correctos — Archivo: `packages/web/src/features/inbox/__tests__/current-cycle-card.test.tsx` — Refs: REQ-INBOX-CYCLE-005 escenario 1 — Acceptance: `getByTestId("sparkline")` existe; `getByTestId("done-pct-value")` texto "62%"; `getByTestId("avg-lead-value")` texto "3.4d"; `getByTestId("velocity-value")` texto "+2".
- [ ] B3.2 TEST — `CurrentCycleCard`: con `avgLeadDays: null` muestra `"—"` en `data-testid="avg-lead-value"` (no "0d" ni "nulld") — Archivo: mismo — Refs: REQ-INBOX-CYCLE-005 escenario 2, REQ-INBOX-CYCLE-002 MUST NOT — Acceptance: `getByTestId("avg-lead-value")` tiene texto exactamente `"—"`.
- [ ] B3.3 TEST — `CurrentCycleCard`: con `activeCycle = null` renderiza `data-testid="current-cycle-empty"` y NO renderiza ningún `<svg>` — Archivo: mismo — Refs: REQ-INBOX-CYCLE-005 escenario 3 — Acceptance: `getByTestId("current-cycle-empty")` existe; `queryByRole("img")` (o `querySelectorAll("svg")`) retorna 0 elementos.
- [ ] B3.4 IMPLEMENT — Crear `packages/web/src/features/inbox/current-cycle-card.tsx` con `CurrentCycleCard(props: CurrentCycleCardProps)`: 3 estados (null → empty, avgLead null → "—", normal → datos), subtítulo con fecha, `data-testid` en todos los spans especificados — Refs: design §4.1 — Acceptance: B3.1-B3.3 pasan.

### B4 — Subtítulo con nombre de proyecto (multipleActiveProjects)

- [ ] B4.1 TEST — `CurrentCycleCard`: cuando `multipleActiveProjects = true`, el subtítulo en `data-testid="cycle-subtitle"` incluye `"(projectName)"` — Archivo: mismo — Refs: REQ-INBOX-CYCLE-006 escenarios 1 y 3 — Acceptance: `getByTestId("cycle-subtitle")` texto incluye "(Phoenix)" cuando `projectName="Phoenix"` y `multipleActiveProjects=true`.
- [ ] B4.2 TEST — `CurrentCycleCard`: cuando `multipleActiveProjects = false`, el subtítulo NO incluye paréntesis — Archivo: mismo — Refs: REQ-INBOX-CYCLE-006 escenario 2 — Acceptance: `getByTestId("cycle-subtitle")` texto NO contiene "(" ni ")".
- [ ] B4.3 IMPLEMENT — Agregar lógica del subtítulo en `current-cycle-card.tsx`: template `{cycleName} · {format(startDate)} – {format(endDate)}` con sufijo ` ({projectName})` condicional — Refs: design §4.1 subtitle logic — Acceptance: B4.1-B4.2 pasan.

### B5 — Integración de CurrentCycleCard en inbox-view.tsx

- [ ] B5.1 TEST — `InboxView`: renderiza `CurrentCycleCard` como primera RailCard del right rail — Archivo: `packages/web/src/features/inbox/__tests__/inbox-view.test.tsx` — Refs: REQ-INBOX-CYCLE-007 escenario 3, design §4.1 data flow — Acceptance: el componente renderizado incluye el testid `"current-cycle-card"` o `"current-cycle-empty"` según el estado del dashboard mock; NO emite request adicional (MSW mock del dashboard no recibe segunda llamada).
- [ ] B5.2 IMPLEMENT — Modificar `packages/web/src/features/inbox/inbox-view.tsx`: importar `CurrentCycleCard`; añadirlo como primer `<RailCard>` en el right rail pasando `activeCycle={data?.activeCycle ?? null}` y `multipleActiveProjects={data?.multipleActiveProjects ?? false}` — Refs: design §4.1 data flow — Acceptance: B5.1 pasa; el Inbox no introduce nueva TanStack Query key.

---

## Phase C — Frontend KAN-29 (Mentions section + Issue detail highlight)

> Prerequisito: Phase A completa (bridge schema con `MentionDashboardItem`); B1 completo (DashboardData tipado).

### C1 — MentionRow componente

- [ ] C1.1 TEST — `MentionRow`: renderiza `mentionedByUsername`, `context`, `issueTitle` visibles en el DOM — Archivo: `packages/web/src/features/inbox/__tests__/mention-row.test.tsx` — Refs: REQ-MENTION-008 escenario 1 — Acceptance: render con `{ mentionedByUsername: "alice", context: "@bob revisa esto", issueTitle: "Fix login", commentId: "cmt-1" }`; todos los textos presentes.
- [ ] C1.2 TEST — `MentionRow`: click llama `navigate` con `{ to: "/issue/$key", params: { key }, search: { from: "inbox", highlight: "mention", commentId: "cmt-1" } }` — Archivo: mismo — Refs: REQ-MENTION-008 escenario 2 — Acceptance: spy de `navigate` recibió argumentos exactos incluyendo `commentId`.
- [ ] C1.3 TEST — `MentionRow`: cuando `commentId = null`, navigate NO incluye `commentId` en search — Archivo: mismo — Refs: REQ-MENTION-008 escenario 3 — Acceptance: spy de navigate recibe `search: { from: "inbox", highlight: "mention" }` sin clave `commentId`.
- [ ] C1.4 IMPLEMENT — Crear `packages/web/src/features/inbox/mention-row.tsx` con `MentionRow(props: MentionRowProps)`: button con click handler, layout horizontal (avatar initials + username + context + issueTitle), usa `navigate` de TanStack Router con conditional commentId — Refs: design §4.2 — Acceptance: C1.1-C1.3 pasan.

### C2 — MentionsSection en inbox-view.tsx

- [ ] C2.1 TEST — `InboxView` con `mentions: []` → sección Mentions muestra "No mentions." (EmptyHint) — Archivo: `packages/web/src/features/inbox/__tests__/inbox-view.test.tsx` — Refs: REQ-MENTION-007 escenario 3, design §4.2 section render — Acceptance: texto "No mentions." presente; no se renderizan filas `MentionRow`.
- [ ] C2.2 TEST — `InboxView` con `mentions: [mention1, mention2]` → sección Mentions renderiza 2 filas `MentionRow` — Archivo: mismo — Refs: REQ-API-DASHBOARD-003 escenario 1 (frontend) — Acceptance: 2 botones de MentionRow en el DOM.
- [ ] C2.3 IMPLEMENT — Modificar `packages/web/src/features/inbox/inbox-view.tsx`: reemplazar bloque placeholder de Mentions con map de `data.mentions` a `<MentionRow>` con `onOpen` handler; manejar estado vacío con `<EmptyHint>` — Refs: design §4.2 section render — Acceptance: C2.1-C2.2 pasan.

### C3 — Issue route validateSearch extension

- [ ] C3.1 TEST — Issue route `validateSearch`: `?highlight=mention&commentId=cmt-42` → `search.highlight === "mention"` y `search.commentId === "cmt-42"` — Archivo: `packages/web/src/routes/__tests__/issue-search-params.test.ts` (o inline en route spec si existe patrón) — Refs: REQ-MENTION-009, design §4.3 validateSearch — Acceptance: `validateSearch({ highlight: "mention", commentId: "cmt-42" })` retorna el objeto tipado correcto.
- [ ] C3.2 TEST — Issue route `validateSearch`: `?from=inbox` sin `highlight` → `search.highlight === undefined` y `search.commentId === undefined` — Archivo: mismo — Refs: REQ-MENTION-009 escenario 3 — Acceptance: highlight y commentId son undefined.
- [ ] C3.3 TEST — Issue route `validateSearch`: valor `highlight` distinto de "mention" → `search.highlight === undefined` — Archivo: mismo — Refs: design §4.3 validateSearch — Acceptance: `validateSearch({ highlight: "something-else" })` → highlight undefined.
- [ ] C3.4 IMPLEMENT — Extender `validateSearch` en `packages/web/src/routes/_authenticated/issue.tsx`: añadir `highlight: "mention" | undefined` y `commentId: string | undefined` al objeto retornado, con guards de tipo (literal string comparison para highlight) — Refs: design §4.3 — Acceptance: C3.1-C3.3 pasan; TypeScript types correctos.

### C4 — CommentsHighlightView + AgentThread highlight injection

- [ ] C4.1 TEST — `CommentsHighlightView`: scroll-to y `data-highlighted="true"` en el comment con `id === commentId` cuando `highlightCommentId` coincide — Archivo: `packages/web/src/features/issue-detail/__tests__/comments-highlight-view.test.tsx` — Refs: REQ-MENTION-009 escenario 1 — Acceptance: render con lista de comments y `highlightCommentId="cmt-42"`; el elemento con `data-comment-id="cmt-42"` tiene `data-highlighted="true"`; `scrollIntoView` fue llamado (mock de `Element.prototype.scrollIntoView`).
- [ ] C4.2 TEST — `CommentsHighlightView`: `highlightCommentId` que no existe en la lista → no lanza error, ningún elemento tiene `data-highlighted="true"` — Archivo: mismo — Refs: REQ-MENTION-009 escenario 2 — Acceptance: render sin error; `document.querySelector("[data-highlighted='true']")` retorna null.
- [ ] C4.3 TEST — Issue detail (behavior matrix row 4): AgentThread vacío + `highlight=mention` + `commentId` → right pane muestra `data-testid="comments-list"` en lugar de `data-testid="agent-thread"` — Archivo: `packages/web/src/routes/__tests__/issue-detail-pane.test.tsx` — Refs: REQ-MENTION-010 escenario 1 — Acceptance: `getByTestId("comments-list")` existe; `queryByTestId("agent-thread")` es null.
- [ ] C4.4 TEST — Issue detail (behavior matrix row 2): AgentThread con mensajes + `highlight=mention` + `commentId` → right pane muestra AgentThread (`data-testid="agent-thread"`) — Archivo: mismo — Refs: REQ-MENTION-010 escenario 2 — Acceptance: `getByTestId("agent-thread")` existe.
- [ ] C4.5 TEST — Issue detail (behavior matrix row 3): AgentThread vacío + sin `highlight=mention` → right pane muestra AgentThread (comportamiento actual) — Archivo: mismo — Refs: REQ-MENTION-010 escenario 3 — Acceptance: `getByTestId("agent-thread")` existe; `queryByTestId("comments-list")` es null.
- [ ] C4.6 IMPLEMENT — Crear `packages/web/src/features/issue-detail/comments-highlight-view.tsx` con `CommentsHighlightView({ comments, highlightCommentId })`: renderiza lista de comments con `data-comment-id={c.id}`, en mount hace `scrollIntoView` + `data-highlighted="true"` en el matching element + `setTimeout(1000, () => set data-highlighted="false")` — Refs: design §4.3, §4.3 highlight visual — Acceptance: C4.1-C4.2 pasan.
- [ ] C4.7 IMPLEMENT — Modificar `packages/web/src/routes/_authenticated/issue.tsx`: leer `highlight` y `commentId` de `useSearch()`, calcular `showCommentsInsteadOfThread`, renderizar `CommentsHighlightView` o `AgentThread` condicionalmente según la behavior matrix de design §4.3 — Refs: design §4.3 — Acceptance: C4.3-C4.5 pasan.

### C5 — Multi-tenant isolation contract test (frontend/integration)

- [ ] C5.1 CONTRACT — Test de contrato multi-tenant en API: alice con menciones en W1 y W2 → GET /api/workspaces/W1/dashboard retorna solo menciones de W1 — Archivo: `packages/api/src/modules/dashboard/__tests__/mentions-isolation.integration.test.ts` — Refs: REQ-MENTION-006, REQ-API-DASHBOARD-004 escenarios 1-3 — Acceptance: test de integración con fastify.inject + test DB seeds: 3 menciones W1, 2 menciones W2 para alice; response W1 tiene `mentions.length === 3`; response W2 tiene `mentions.length === 2`; ninguna cruza workspaces.

---

## Phase D — Frontend KAN-28 + cosmetic fixes

> Prerequisito: A completo (para tipos). B-C pueden estar en progreso en paralelo, pero este phase no los bloquea.

### D1 — ProjectPickerPopover

- [ ] D1.1 TEST — `ProjectPickerPopover` con 0 proyectos: `children` recibe `disabled = true`; llamar `open()` no monta ningún popover — Archivo: `packages/web/src/features/inbox/__tests__/project-picker-popover.test.tsx` — Refs: REQ-INBOX-QUICK-004 escenario 1-2, design §4.4 behavior — Acceptance: render con `projects=[]`; el children callback recibe `disabled=true`; click en trigger → no hay elemento con `role="menu"` en DOM.
- [ ] D1.2 TEST — `ProjectPickerPopover` con 1 proyecto: `open()` invoca `onSelect("X")` directamente sin montar popover — Archivo: mismo — Refs: REQ-INBOX-QUICK-003 escenario 1 — Acceptance: spy de `onSelect` llamado con "X"; no hay elemento con `role="menu"` en DOM.
- [ ] D1.3 TEST — `ProjectPickerPopover` con 2 proyectos: `open()` muestra popover con ambas opciones; click en una → `onSelect(key)` y popover se cierra — Archivo: mismo — Refs: REQ-INBOX-QUICK-003 escenario 2-3 — Acceptance: después de `open()`, `role="menu"` visible; click en "B" → `onSelect("B")` llamado; popover ya no visible.
- [ ] D1.4 IMPLEMENT — Crear `packages/web/src/features/inbox/project-picker-popover.tsx` con `ProjectPickerPopover(props)` según design §4.4: render-prop pattern, 3 casos (0→disabled+noop, 1→short-circuit, 2+→popover con `role="menu"` + buttons) — Refs: design §4.4 — Acceptance: D1.1-D1.3 pasan.

### D2 — Nuevas QuickRows + eliminación de fila "Search"

- [ ] D2.1 TEST — Quick Actions: exactamente 4 filas `data-testid="quick-action-row"` en orden (new-issue, ask-kanon, dep-graph, plan-cycle) — Archivo: `packages/web/src/features/inbox/__tests__/inbox-view.test.tsx` — Refs: REQ-INBOX-QUICK-005 escenario 1 — Acceptance: `getAllByTestId("quick-action-row")` retorna array de 4; en orden: data-action="new-issue", "ask-kanon", "dep-graph", "plan-cycle"; NO hay fila "search".
- [ ] D2.2 TEST — Quick Actions con 0 proyectos: las 4 filas presentes; dep-graph y plan-cycle tienen `aria-disabled="true"` — Archivo: mismo — Refs: REQ-INBOX-QUICK-005 escenario 2, REQ-INBOX-QUICK-004 escenario 1 — Acceptance: `getByTestId("quick-dep-graph")` tiene `aria-disabled="true"`; `getByTestId("quick-plan-cycle")` tiene `aria-disabled="true"`.
- [ ] D2.3 TEST — Click en "Open dependency graph" con 1 proyecto → `navigate({ to: "/dependencies/$projectKey", params: { projectKey: "PHOENIX" } })` — Archivo: mismo — Refs: REQ-INBOX-QUICK-001 escenario 1 — Acceptance: spy de navigate llamado con los parámetros exactos; sin popover visible.
- [ ] D2.4 TEST — Click en "Plan next cycle" con 1 proyecto → `navigate({ to: "/cycles/$projectKey", params: { projectKey: "ATLAS" } })` — Archivo: mismo — Refs: REQ-INBOX-QUICK-002 escenario 1 — Acceptance: spy de navigate llamado con los parámetros correctos; sin popover visible.
- [ ] D2.5 IMPLEMENT — Modificar `packages/web/src/features/inbox/inbox-view.tsx`: remover fila "Search" existente; añadir las 2 nuevas `QuickRow` dentro de `ProjectPickerPopover` (dep-graph + plan-cycle) según template de design §4.4; usar `useProjectsQuery(workspaceId)` para obtener proyectos activos — Refs: design §4.4, REQ-INBOX-QUICK-005 — Acceptance: D2.1-D2.4 pasan; nota en commit message que "Search" sigue accesible vía ⌘K y topbar lupa.

### D3 — /inbox validateSearch: blocked param

- [ ] D3.1 TEST — Inbox route `validateSearch`: `?blocked=true` → `search.blocked === true`; sin param → `search.blocked === undefined` — Archivo: `packages/web/src/routes/__tests__/inbox-search-params.test.ts` — Refs: design §4.5 (risk: `/inbox` route debe aceptar `blocked` opcional), REQ-PALETTE-AI-002 escenario 1 — Acceptance: validateSearch con `{ blocked: "true" }` → `{ blocked: true }`; sin blocked → `{ blocked: undefined }` (no lanza).
- [ ] D3.2 IMPLEMENT — Agregar `blocked: z.boolean().optional()` al `validateSearch` de la ruta `/inbox` en `packages/web/src/routes/_authenticated/inbox.tsx` (o equivalente) — Refs: design §4.5, §6 risks — Acceptance: D3.1 pasa; el param es aceptado sin rendering effect (no se filtra UI en este change).

### D4 — Command palette AI mode honest navigations

- [ ] D4.1 TEST — Palette "Plan next cycle": `onSelect` llama `navigate({ to: "/cycles/$projectKey", params: { projectKey: "ATLAS" } })` primero, luego `onClose()` (orden verificado con spies) — Archivo: `packages/web/src/components/__tests__/command-palette.test.tsx` — Refs: REQ-PALETTE-AI-001 escenarios 1-2 — Acceptance: `navigateSpy` llamado antes de `onCloseSpy` (verificable via `mock.invocationCallOrder`).
- [ ] D4.2 TEST — Palette "Find blockers": `onSelect` llama `navigate({ to: "/inbox", search: { blocked: true } })` primero, luego `onClose()` — Archivo: mismo — Refs: REQ-PALETTE-AI-002 escenarios 1-2 — Acceptance: spy de navigate recibe `search: { blocked: true }`; orden navigate → onClose.
- [ ] D4.3 TEST — Palette "Draft digest": `onSelect` llama `navigate({ to: "/inbox" })` primero, luego `onClose()` — Archivo: mismo — Refs: REQ-PALETTE-AI-003 escenarios 1-2 — Acceptance: spy de navigate recibe destino `/inbox`; orden navigate → onClose.
- [ ] D4.4 TEST — Código fuente de las 3 acciones contiene comentarios `// TODO(KAN-` — Archivo: mismo (test de tipo "snapshot" o verificación textual del `onSelect.toString()` o simplemente snapshot del componente que incluye el comentario en la representación) — Refs: REQ-PALETTE-AI-001 escenario 3, REQ-PALETTE-AI-002 escenario 3, REQ-PALETTE-AI-003 escenario 3 — Acceptance: snapshot del componente incluye "TODO(KAN-" en los 3 handlers.
- [ ] D4.5 IMPLEMENT — Modificar `packages/web/src/components/command-palette.tsx` líneas ~80-84: reemplazar los 3 `onSelect: onClose` por handlers que llaman `navigate(...)` con destino real, luego `onClose()`, con comentario `// TODO(KAN-50): swap navigation for MCP roundtrip when wiring lands` — Refs: design §4.5, REQ-PALETTE-AI-001/002/003 — Acceptance: D4.1-D4.4 pasan.

### D5 — AgentThread copy + snapshot update

- [ ] D5.1 TEST — `AgentThread`: input con `data-testid="agent-thread-input"` tiene `placeholder="View only · agents act via MCP"` y atributo `disabled` presente — Archivo: `packages/web/src/features/issue-detail/__tests__/agent-thread.test.tsx` — Refs: REQ-AGENT-THREAD-001 escenario 1 — Acceptance: `getByTestId("agent-thread-input")` tiene atributo `placeholder` = "View only · agents act via MCP" y `disabled` = "".
- [ ] D5.2 TEST — Snapshot de `AgentThread` actualizado: regenerar con `-u` y verificar que el nuevo snapshot contiene "View only · agents act via MCP" — Archivo: mismo — Refs: REQ-AGENT-THREAD-001 escenario 2 — Acceptance: test de snapshot falla en la primera ejecución; al correr `vitest -u` el nuevo snapshot contiene el copy correcto.
- [ ] D5.3 TEST — `AgentThread` con 0 mensajes MCP: input sigue mostrando `"View only · agents act via MCP"` (copy no cambia con el estado del thread) — Archivo: mismo — Refs: REQ-AGENT-THREAD-001 escenario 3 — Acceptance: render con `messages=[]` → placeholder igual.
- [ ] D5.4 IMPLEMENT — Modificar `packages/web/src/features/issue-detail/agent-thread.tsx` líneas ~119-136: cambiar `div title=` a `"View only — agents act via MCP. See KAN-50 for upcoming Ask Kanon roundtrip."`; cambiar `input placeholder=` a `"View only · agents act via MCP"`; añadir `data-testid="agent-thread-input"` al input — Refs: design §4.6 — Acceptance: D5.1-D5.3 pasan; es exactamente 3 líneas modificadas.

---

## Phase E — Verify

- [ ] E.1 SMOKE — Ejecutar `pnpm --filter @kanon/api test` — Acceptance: 0 failures, 0 skipped (o skips previamente existentes sin regresión nueva).
- [ ] E.2 SMOKE — Ejecutar `pnpm --filter @kanon/bridge test` — Acceptance: 0 failures; A2.1-A2.3 incluidos.
- [ ] E.3 SMOKE — Ejecutar `pnpm --filter @kanon/web test` — Acceptance: 0 failures; snapshots actualizados si D5.2 completado.
- [ ] E.4 SMOKE — Ejecutar `pnpm --filter @kanon/api typecheck` (si existe el script) — Acceptance: 0 errores TypeScript en el package api.
- [ ] E.5 SMOKE — Ejecutar `pnpm --filter @kanon/web typecheck` — Acceptance: 0 errores TypeScript; en particular, `DashboardData` correctamente inferido desde bridge.
- [ ] E.6 SMOKE — Ejecutar `pnpm --filter @kanon/bridge typecheck` — Acceptance: 0 errores; exports de `activeCycleKPIsSchema`, `mentionDashboardItemSchema`, `dashboardResponseSchema` visibles.

### Manual smoke (ejecutar después de E.5 pasa)

1. **Orden del right rail**: Abrir Inbox. El right rail muestra 3 cards en orden vertical: Current cycle / Active agents / Quick actions. Verificar que "Current cycle" es la PRIMERA tarjeta.
2. **KPIs del ciclo activo**: Con un workspace que tiene un ciclo activo con issues done, verificar que Done % coincide con el porcentaje esperado según la vista de cycles; Avg lead muestra un número con "d"; Velocity muestra "+N".
3. **Avg lead nulo**: Con un ciclo activo sin issues done (o done sin evento `state_changed → done`), verificar que Avg lead muestra "—" y no "0d" ni "NaNd".
4. **Subtítulo multi-proyecto**: Con workspace con >1 ciclo activo en proyectos distintos, verificar que el subtítulo del CurrentCycleCard incluye el nombre del proyecto entre paréntesis (ej. "(Atlas)").
5. **Sparkline**: CurrentCycleCard muestra el gráfico SVG de área. Con burnup vacío (ciclo recién creado), el SVG está presente pero sin path visible (sin errores en consola).
6. **Mention create flow**: Usuario A crea un Comment con body "@bobi gracias" en cualquier issue. Usuario B (username "bobi") abre su Inbox → sección Mentions muestra 1 entrada con el nombre de A, el snippet "@bobi gracias" y el título del issue. Click en la entrada → navega a `/issue/$key?from=inbox&highlight=mention&commentId=<id>`. En el issue detail, si el AgentThread de ese issue está vacío, el right pane muestra los comments con el comment correspondiente resaltado y visible en viewport.
7. **Mention update removal**: Usuario A edita el mismo comment a "gracias" (sin @). Recargar el Inbox de Usuario B → la entrada de mención desaparece.
8. **Auto-mención excluida**: Usuario A (username "userabc") crea un comment "@userabc recordatorio". El Inbox de Usuario A NO muestra ninguna nueva entrada en Mentions.
9. **Quick actions — dep graph (1 proyecto)**: Click en "Open dependency graph" → navega directamente a `/dependencies/PROJECTKEY` sin mostrar popover.
10. **Quick actions — dep graph (>1 proyecto)**: En workspace con 2+ proyectos activos, click en "Open dependency graph" → aparece popover con lista de proyectos; click en uno → navega a `/dependencies/PROJECTKEY`.
11. **Quick actions — plan cycle**: Click en "Plan next cycle" → navega a `/cycles/PROJECTKEY` (con o sin popover según cantidad de proyectos).
12. **Quick actions — 0 proyectos activos**: Con workspace sin proyectos activos, "Open dependency graph" y "Plan next cycle" muestran `aria-disabled` y tooltip "No active project"; click no navega.
13. **Palette honesty**: Abrir command palette (Ask Kanon / ⌘J). Hacer click en "Plan the next cycle" → navega a `/cycles/PROJECTKEY` y palette se cierra. Click en "Find issues blocking the cycle" → navega a `/inbox?blocked=true` y palette se cierra. Click en "Draft a digest for #standup" → navega a `/inbox` y palette se cierra. Ninguno abre un LLM ni hace una petición AI.
14. **AgentThread copy**: Abrir cualquier issue. Right pane → campo de input deshabilitado muestra "View only · agents act via MCP" como placeholder. Tooltip del contenedor dice "View only — agents act via MCP. See KAN-50 for upcoming Ask Kanon roundtrip.".
15. **Sin regresiones en existing**: Abrir una issue sin parámetros de URL → right pane muestra AgentThread normalmente. Crear un issue sin description → sin errores. Actualizar un issue cambiando solo el título → sin mención creada.
