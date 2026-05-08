# Verify Report: inbox-redesign-cycle-c

> Phase E verification · Date: 2026-05-02 (initial) · Updated 2026-05-03 (post-fix)

---

## Verdict

**PASS WITH NOTES** — Tests pasan al 100% (487 API / 231 bridge / 358 web). Los 2 CRITICAL del verify inicial se resolvieron:

1. **CRITICAL-1 (bridge no compilado)** → resuelto vía path alias `@kanon/bridge → ../bridge/src/index.ts` en `packages/api/tsconfig.json` y `packages/web/tsconfig.json`. Decisión: opción (b), evita necesitar `pnpm --filter @kanon/bridge build` (respeta la regla "never build after changes"). Trade-off documentado: typecheck resuelve directamente desde source del bridge en lugar de `dist/`. Más limpio a largo plazo y consistente con el alias que ya tenía `vitest.config.ts`.
2. **CRITICAL-2 (McpProposal import)** → restaurada la línea `import type { McpProposal } from "@/types/proposal"` en `use-dashboard-query.ts`.

**Errores de typecheck adicionales detectados y resueltos** (12 de 17):
- `inbox-view.tsx` (5): casts `as Issue[]`, `as McpProposal[]`, `as ActiveAgentSession[]` aplicados al destructuring de `data?.assigned/proposals/agents` (el bridge schema deja estos como `unknown[]` por diseño — solo tipa fuerte lo nuevo).
- Test fixtures (3): `comments-highlight-view.test.tsx` y `issue-detail-pane.test.tsx` — `Comment` requiere `author.id` y `updatedAt`; `source` debe usar el enum `CommentSource`. Fixtures actualizadas.
- `mention-row.test.tsx` (1): `Object is possibly 'undefined'` en `mockNavigate.mock.calls[0]` — agregado optional chaining `?.[0]` y `expect(callArgs).toBeDefined()`.

**Errores restantes (5)** todos en `packages/web/src/routes/__tests__/issue-search-params.test.ts` — los tests llaman `validateSearch(input)` directamente pero en TanStack Router 1.x `validateSearch` puede ser un Validator object, no callable. **Tracked en KAN-51** (low priority, separate research). Tests siguen GREEN; solo typecheck del archivo falla.

Notas de contexto: typecheck no estaba enforced antes de este cycle (KAN-26 — "Fix TS4023 errors in web router" — sigue en backlog). Los 5 errores remanentes son del approach del test, no de implementación.

---

## Layer 1 — Task Completeness

| Phase | Tasks marcadas [x] | Total | Estado |
|---|---|---|---|
| A | 40/40 | 40 | COMPLETA |
| B | 12/12 | 12 | COMPLETA |
| C | 17/17 | 17 | COMPLETA |
| D | 17/17 | 17 | COMPLETA |
| E | 6/6 | 6 | EJECUTADO (2 checks FAIL — ver Layer 2) |

Todas las tasks de fases A–D están marcadas `[x]`. No hay tasks sin completar en las fases de implementación.

---

## Layer 2 — Test Suite + Typecheck (post-fix update 2026-05-03)

| Comando | Resultado | Conteo |
|---|---|---|
| `pnpm --filter @kanon/api test` | **PASS** | 487 passed, 1 skipped (pre-existente) |
| `pnpm --filter @kanon/bridge test` | **PASS** | 231 passed, 0 failures |
| `pnpm --filter @kanon/web test` | **PASS** | 358 passed, 5 todo (pre-existentes), 0 failures |
| `pnpm --filter @kanon/api typecheck` | **SKIPPED** (sin script "typecheck") | — |
| `pnpm --filter @kanon/api exec tsc --noEmit` | **PASS** (post-fix) | exit 0 |
| `pnpm --filter @kanon/bridge exec tsc --noEmit` | **PASS** | exit 0 |
| `pnpm --filter @kanon/web typecheck` | **PARTIAL** (post-fix) | 5 errores remanentes — **todos en KAN-51** |

### Resolución aplicada (post-fix 2026-05-03)

**Decisión (b)** del usuario: agregar path alias `@kanon/bridge → ../bridge/src/index.ts` en `packages/api/tsconfig.json` y `packages/web/tsconfig.json`. Esto evita necesitar `pnpm --filter @kanon/bridge build` (respeta la regla "never build after changes"). El resolver de TypeScript ahora apunta directamente al source del bridge, igual que el alias que ya existía en `vitest.config.ts`.

**Resultado**:
- API typecheck: 1 error TS2305 → 0 errores ✅
- Web typecheck: 17 errores → 5 errores (todos en `issue-search-params.test.ts`)
- Tests: sin cambios (siguen 487 / 231 / 358)

**Errores restantes (5)**: todos `TS2349 'This expression is not callable'` en `packages/web/src/routes/__tests__/issue-search-params.test.ts` líneas 21, 36, 47, 56, 57. Los tests llaman `validateSearch(input)` directamente, pero en TanStack Router 1.x ese campo puede ser un Validator object no-callable. **Tracked en KAN-51** (low, separate research). Tests siguen GREEN; solo el typecheck del archivo falla.

### Salida verbatim — `pnpm --filter @kanon/api exec tsc --noEmit` (FAIL)

```
src/modules/dashboard/routes.ts(6,15): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'ActiveCycleKPIs'.
```

**Causa raíz**: `packages/bridge/dist/` no contiene `dashboard.js` / `dashboard.d.ts`. El bridge fue modificado en Batch 1 (nuevo archivo `dashboard.ts`) pero NUNCA fue compilado. El API importa `ActiveCycleKPIs` como `import type` desde `@kanon/bridge`, que en runtime se resuelve a `dist/index.d.ts`, que no tiene la re-export.

**Fix**: `pnpm --filter @kanon/bridge build` (una sola vez genera `dist/dashboard.d.ts`). Los tests de vitest no se ven afectados porque usan un alias de resolve directo al source.

### Salida verbatim — `pnpm --filter @kanon/web typecheck` (FAIL)

Errores agrupados por causa:

**Grupo A — Bridge no compilado (misma causa raíz, 10 errores):**
```
src/features/inbox/__tests__/current-cycle-card.test.tsx(16,15): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'ActiveCycleKPIs'.
src/features/inbox/__tests__/use-dashboard-query.test.ts(12,15): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'ActiveCycleKPIs'.
src/features/inbox/__tests__/use-dashboard-query.test.ts(12,32): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'MentionDashboardItem'.
src/features/inbox/__tests__/use-dashboard-query.test.ts(76,13): error TS2339:
  Property 'dashboardResponseSchema' does not exist on type '{...}'.
src/features/inbox/current-cycle-card.tsx(18,15): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'ActiveCycleKPIs'.
src/features/inbox/mention-row.tsx(2,15): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'MentionDashboardItem'.
src/features/inbox/use-dashboard-query.ts(4,15): error TS2305:
  Module '"@kanon/bridge"' has no exported member 'DashboardData'.
src/features/inbox/use-dashboard-query.ts(8,15/32/54): error TS2305:
  (ActiveCycleKPIs, MentionDashboardItem, DashboardData ausentes del dist)
```

**Grupo B — Import McpProposal eliminado en Batch 5 (2 errores, source real):**
```
src/features/inbox/use-dashboard-query.ts(40,16): error TS2304:
  Cannot find name 'McpProposal'.
src/features/inbox/use-dashboard-query.ts(61,16): error TS2304:
  Cannot find name 'McpProposal'.
```
**Causa**: El Batch 5 reemplazó la interfaz `DashboardData` por `z.infer<typeof dashboardResponseSchema>` pero eliminó el import `import type { McpProposal } from "@/types/proposal"`. El tipo sigue siendo usado en las mutaciones `useApplyProposalMutation` y `useDismissProposalMutation`.
**Fix**: Restaurar `import type { McpProposal } from "@/types/proposal";` en `use-dashboard-query.ts`.

**Grupo C — Errores en test files (5 errores, no bloquean runtime pero sí typecheck):**
```
src/features/inbox/inbox-view.tsx(127,27): error TS7006:
  Parameter 'issue' implicitly has an 'any' type.
  (y similares para 'p', 'm', 'a' en los maps de proposals/mentions/agents)
src/features/inbox/__tests__/mention-row.test.tsx(80,22): error TS2532:
  Object is possibly 'undefined'.
src/features/issue-detail/__tests__/comments-highlight-view.test.tsx(33,3): error TS2741:
  Property 'id' is missing in type '{ username: string; }' but required in type
  '{ id: string; username: string; }'. (Comment.author requiere id)
src/routes/__tests__/issue-detail-pane.test.tsx(35,3): error TS2322:
  Type 'string' is not assignable to type 'CommentSource'.
src/routes/__tests__/issue-detail-pane.test.tsx(37,3): error TS2741:
  Same issue (author.id missing)
src/routes/__tests__/issue-search-params.test.ts(21,20): error TS2349:
  Not all constituents of type '...' are callable.
  (validateSearch tiene tipo union; el test lo llama directamente sin cast)
```

**Nota sobre inbox-view.tsx implicit any**: El tipo `DashboardData` actualmente es `unknown`-typed para `assigned`, `proposals`, y `agents` (por diseño del bridge — sección §2.4 del design). El `strict: true` del tsconfig de web dispara TS7006 en los callbacks de `.map()`. Esto es un efecto secundario del Grupo A (si bridge compila, DashboardData tendrá los tipos reales y el error podría resolverse).

---

## Layer 3 — Grep Verifications

| Check | Esperado | Actual | Estado |
|---|---|---|---|
| `grep -c 'TODO(KAN-50)' command-palette.tsx` | exactamente 3 | 3 | PASS |
| `grep -n 'placeholder="View only · agents act via MCP"' agent-thread.tsx` | exactamente 1 línea | 1 (línea 125) | PASS |
| `grep -n 'data-action=' inbox-view.tsx` | ≥4 líneas; sin `data-action="search"` | 5 líneas (new-issue, ask-kanon, dep-graph, plan-cycle, plus QuickRow template on line 517); sin "search" | PASS |
| `grep -rn 'mentions: \[\]' packages/api/src/modules/dashboard/` (non-test) | 0 hits | 0 | PASS |
| `grep -n 'Direct prompts to agents arrive in Phase 3' packages/web/src/` | 0 líneas | 0 | PASS |
| `grep -n 'archived' command-palette.tsx` | (informativo) | 1 línea (línea 40): cast defensivo `(p as { archived?: boolean }).archived` | INFO |
| `grep -n 'model Mention' packages/api/prisma/schema.prisma` | 1 línea | 1 (línea 387) | PASS |

**Nota grep 3**: `data-action="search"` no aparece en el archivo. Las 5 líneas con `data-action=` son: new-issue (228), ask-kanon (237), dep-graph (253), plan-cycle (274), y la línea 517 que es el QuickRow component interno que usa `data-action={dataAction}` como prop passthrough — correcto.

---

## Layer 4 — Spec Sample Audit

### Capability: inbox-current-cycle

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-INBOX-CYCLE-001 | Multi-project resolver picks most recent startDate | **PASS** — `resolveActiveCycleForWorkspace` tests en `cycle/__tests__/service.test.ts`: A8.2 verifica startDate más reciente; A8.3 verifica tiebreaker por id ASC |
| REQ-INBOX-CYCLE-001 | null cuando sin ciclos activos | **PASS** — A8.1 pasa |
| REQ-INBOX-CYCLE-002 | shape completa ActiveCycleKPIs en bridge schema | **PASS** — A2.1 verifica todos los campos; bridge typecheck pasa |
| REQ-INBOX-CYCLE-002 | avgLeadDays null ≠ 0 | **PASS** — A7.1 verifica `null` cuando 0 issues con evento |
| REQ-INBOX-CYCLE-003 | promedio de 2 y 4, excluyendo issue sin evento → 3.0 | **PASS** — A7.3 pasa |
| REQ-INBOX-CYCLE-004 | anti-N+1: 50 issues → exactamente 1 query a activityLogs | **PASS** — A7.5 verifica spy de activityLog.findMany llamado 1 vez |
| REQ-INBOX-CYCLE-005 | CurrentCycleCard normal: sparkline + donePct + avgLeadDays + velocity | **PASS** — B3.1 pasa (358 web tests pasan) |
| REQ-INBOX-CYCLE-005 | avgLeadDays null → "—" en avg-lead-value | **PASS** — B3.2 pasa |
| REQ-INBOX-CYCLE-005 | activeCycle null → current-cycle-empty, sin SVG | **PASS** — B3.3 pasa |
| REQ-INBOX-CYCLE-006 | multipleActiveProjects=true → "(Phoenix)" en cycle-subtitle | **PASS** — B4.1 pasa |
| REQ-INBOX-CYCLE-006 | multipleActiveProjects=false → sin paréntesis | **PASS** — B4.2 pasa |
| REQ-INBOX-CYCLE-007 | CurrentCycleCard sin nueva query key | **PASS** — B5 tests verifican que no se emiten requests adicionales (setQueryData preseeded) |

### Capability: inbox-mentions

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-MENTION-001 | Modelo Mention en schema.prisma | **PASS** — grep: `model Mention` en línea 387; test A1.1 pasa |
| REQ-MENTION-002 | Parser extrae exactas coincidencias (@alice+@bob → 2 rows, @phantom → 0) | **PASS** — A3.1 pasa |
| REQ-MENTION-003 | DELETE+INSERT diff on update | **PASS** — A3.3 y A3.4 verifican idempotencia y remoción |
| REQ-MENTION-004 | Trigger en Issue.create/update con description; commentId=null | **PASS** — A6.2-A6.3 pasan |
| REQ-MENTION-005 | Self-mention exclusion | **PASS** — A3.2 pasa; alice@alice genera 0 rows |
| REQ-MENTION-006 | Multi-tenant isolation | **PASS** — C5.1 contract test (`mentions-isolation.integration.test.ts`): alice W1+W2 → solo W1 en dashboard W1 |
| REQ-MENTION-007 | Shape MentionDashboardItem en response | **PASS** — A9.4 pasa (shape completa verificada) |
| REQ-MENTION-008 | MentionRow renderiza username+context+issueTitle | **PASS** — C1.1 pasa |
| REQ-MENTION-008 | click navega con commentId | **PASS** — C1.2 pasa |
| REQ-MENTION-008 | click sin commentId omite commentId del search | **PASS** — C1.3 pasa |
| REQ-MENTION-009 | scroll-to + data-highlighted="true" para commentId coincidente | **PASS** — C4.1 pasa |
| REQ-MENTION-009 | commentId inexistente → sin error, sin elemento highlighted | **PASS** — C4.2 pasa |
| REQ-MENTION-010 | AgentThread vacío + highlight+commentId → comments-list en right pane | **PASS** — C4.3 pasa |
| REQ-MENTION-010 | AgentThread con mensajes + highlight+commentId → agent-thread | **PASS** — C4.4 pasa |

### Capability: inbox-quick-actions-v2

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-INBOX-QUICK-001 | 1 proyecto → navega directamente a /dependencies/PROJECTKEY | **PASS** — D2.3 pasa |
| REQ-INBOX-QUICK-002 | 1 proyecto → navega a /cycles/PROJECTKEY | **PASS** — D2.4 pasa |
| REQ-INBOX-QUICK-003 | 1 proyecto → short-circuit sin popover | **PASS** — D1.2 pasa |
| REQ-INBOX-QUICK-003 | 2 proyectos → popover visible, click → onSelect | **PASS** — D1.3 pasa |
| REQ-INBOX-QUICK-004 | 0 proyectos → dep-graph y plan-cycle tienen aria-disabled="true" | **PASS** — D2.2 pasa |
| REQ-INBOX-QUICK-005 | Orden: new-issue, ask-kanon, dep-graph, plan-cycle; sin "search" | **PASS** — D2.1 pasa; grep confirma ausencia de `data-action="search"` |

### Capability: dashboard-endpoint

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-API-DASHBOARD-002 | activeCycle presente (null cuando sin ciclos) | **PASS** — A9.1 pasa |
| REQ-API-DASHBOARD-002 | activeCycle populado con shape completa (1 ciclo activo) | **PASS** — A9.2 pasa |
| REQ-API-DASHBOARD-003 | mentions real desde DB (no hardcoded []) | **PASS** — A9.4 pasa; grep confirma `mentions: []` ausente en source |
| REQ-API-DASHBOARD-004 | Aislamiento multi-tenant mentions | **PASS** — A9.5 + C5.1 pasan |
| REQ-API-DASHBOARD-005 | multipleActiveProjects: true cuando 2+ proyectos activos | **PASS** — A9.3 pasa |

### Capability: cycle-lifecycle

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-CYCLE-LEAD-TIME-001 | 0 issues con evento → null | **PASS** — A7.1 pasa |
| REQ-CYCLE-LEAD-TIME-001 | 1 issue, delta 5.5d → retorna 5.5 | **PASS** — A7.2 pasa |
| REQ-CYCLE-LEAD-TIME-001 | 3 issues, 2 con evento (2d+4d), 1 sin evento → 3.0 | **PASS** — A7.3 pasa |
| REQ-CYCLE-LEAD-TIME-002 | anti-N+1: 1 query batch a activityLogs | **PASS** — A7.5 pasa |
| REQ-CYCLE-LEAD-TIME-003 | delta=0 → 0.0 (no null) | **PASS** — A7.4 pasa |

### Capability: command-palette-ai-mode

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-PALETTE-AI-001 | "Plan next cycle" navega a /cycles/$projectKey antes que onClose | **PASS** — D4.1 pasa (orden verificado con spies) |
| REQ-PALETTE-AI-001 | Código contiene `TODO(KAN-50)` | **PASS** — grep retorna 3 hits en command-palette.tsx |
| REQ-PALETTE-AI-002 | "Find blockers" navega a /inbox?blocked=true | **PASS** — D4.2 pasa |
| REQ-PALETTE-AI-003 | "Draft digest" navega a /inbox | **PASS** — D4.3 pasa |

### Capability: agent-thread-readonly

| REQ | Escenario auditado | Resultado |
|---|---|---|
| REQ-AGENT-THREAD-001 | placeholder="View only · agents act via MCP" + disabled | **PASS** — D5.1 pasa; grep confirma línea 125 de agent-thread.tsx |
| REQ-AGENT-THREAD-001 | Old copy "Direct prompts to agents arrive in Phase 3" eliminado | **PASS** — grep retorna 0 hits |
| REQ-AGENT-THREAD-001 | Copy no cambia con 0 mensajes MCP | **PASS** — D5.3 pasa |

### Resumen de specs

| Capability | REQs cubiertos | Resultado |
|---|---|---|
| inbox-current-cycle | REQ-INBOX-CYCLE-001..007 | PASS |
| inbox-mentions | REQ-MENTION-001..010 | PASS |
| inbox-quick-actions-v2 | REQ-INBOX-QUICK-001..005 | PASS |
| dashboard-endpoint | REQ-API-DASHBOARD-002..005 | PASS |
| cycle-lifecycle | REQ-CYCLE-LEAD-TIME-001..003 | PASS |
| command-palette-ai-mode | REQ-PALETTE-AI-001..003 | PASS |
| agent-thread-readonly | REQ-AGENT-THREAD-001 | PASS |

**CRITICAL: 2** (typecheck API + typecheck web) | **WARNING: 0** | **SUGGESTION: 2**

### CRITICAL-1 — Bridge dist no compilado

**Descripción**: `packages/bridge/src/dashboard.ts` (Batch 1) nunca fue compilado. El `dist/` no contiene `dashboard.d.ts` ni la re-export `ActiveCycleKPIs` / `MentionDashboardItem` / `DashboardData`. Esto hace fallar `tsc --noEmit` en ambos `@kanon/api` y `@kanon/web`.

**Archivos afectados**:
- `packages/bridge/dist/` (falta dashboard.d.ts)
- `packages/api/src/modules/dashboard/routes.ts` (línea 6)
- `packages/web/src/features/inbox/use-dashboard-query.ts`, `current-cycle-card.tsx`, `mention-row.tsx`

**Remediación**: Ejecutar `pnpm --filter @kanon/bridge build` (genera el dist). Los tests seguirán pasando — vitest usa alias al source. Esta es la remediación mínima.

### CRITICAL-2 — `McpProposal` import eliminado en use-dashboard-query.ts

**Descripción**: El Batch 5 reemplazó la interfaz `DashboardData` y los imports del archivo, pero eliminó `import type { McpProposal } from "@/types/proposal"`. El tipo sigue siendo usado en las funciones `useApplyProposalMutation` y `useDismissProposalMutation`.

**Archivo afectado**: `packages/web/src/features/inbox/use-dashboard-query.ts` (líneas 40 y 61)

**Remediación**: Agregar la siguiente línea al inicio de los imports en `use-dashboard-query.ts`:
```ts
import type { McpProposal } from "@/types/proposal";
```

### SUGGESTION-1 — Errores TS en test files

**Descripción**: Varios test files tienen errores TS menores que fallan en `tsc` pero pasan en vitest (jsdom + aliases diferentes). Incluye: `author.id` faltante en fixtures de `Comment`, `CommentSource` type no inferido correctamente en `makeComment`, `validateSearch` union type no callable directamente, `mockNavigate.mock.calls[0][0]` potencialmente undefined.

**Archivos**: `comments-highlight-view.test.tsx`, `issue-detail-pane.test.tsx`, `issue-search-params.test.ts`, `mention-row.test.tsx`.

**Remediación**: Añadir `id: "member-id"` a los objetos `author` en fixtures, y castear `validateSearch` a `(s: Record<string, unknown>) => IssueRouteSearch` en los tests de validateSearch.

### SUGGESTION-2 — ProjectPickerPopover no es keyboard-accessible

**Descripción**: No tiene focus-trap ni navegación por teclado. El popover de 2+ proyectos solo es accesible por mouse. Referenciado en apply-progress Batch 7.

**Remediación**: Seguimiento en issue separado (out of scope de este change).

---

## Layer 5 — Manual Smoke Checklist (ACCIÓN REQUERIDA DEL USUARIO)

Los siguientes ítems requieren un humano en el browser. Ejecutar en orden antes de merge:

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

---

## Files Changed Summary (from apply-progress Batches 1–7)

### Backend — Phase A

- `packages/api/prisma/schema.prisma` — modelo Mention + back-relations en Workspace/Issue/Comment/Member
- `packages/api/prisma/migrations/20260502232848_add_mention/migration.sql` — CREATE TABLE mentions + 3 índices + 4 FKs
- `packages/api/prisma/__tests__/mention-schema.test.ts` — test DMMF + pg_indexes (A1.1)
- `packages/api/src/modules/mentions/service.ts` — NEW: parseAndUpsertMentions (A3.6)
- `packages/api/src/modules/mentions/__tests__/service.test.ts` — 9 tests (A3.1–A3.5)
- `packages/api/src/modules/comment/service.ts` — updateComment + wiring parseAndUpsertMentions en createComment (A4.3, A6.4)
- `packages/api/src/modules/comment/schema.ts` — CommentIdParam + UpdateCommentBody (A5.4)
- `packages/api/src/modules/comment/routes.ts` — PATCH /api/comments/:id (A5.4)
- `packages/api/src/modules/comment/__tests__/service.test.ts` — 8+4 tests (A4.1–A4.2, A6.1)
- `packages/api/src/modules/comment/__tests__/routes.test.ts` — 7 tests (A5.1–A5.3)
- `packages/api/src/modules/issue/service.ts` — wiring parseAndUpsertMentions en createIssue + updateIssue (A6.5)
- `packages/api/src/modules/issue/__tests__/service.test.ts` — 8 tests (A6.2–A6.3)
- `packages/api/src/modules/cycle/service.ts` — computeAvgLeadDays + resolveActiveCycleForWorkspace (A7.6, A8.5)
- `packages/api/src/modules/cycle/__tests__/service.test.ts` — 15 tests (A7.1–A7.5, A8.1–A8.4)
- `packages/api/src/modules/dashboard/routes.ts` — activeCycle + mentions + multipleActiveProjects (A9.8)
- `packages/api/src/modules/dashboard/__tests__/dashboard-cycle-c.integration.test.ts` — 10 tests (A9.1–A9.7)
- `packages/api/src/modules/dashboard/__tests__/mentions-isolation.integration.test.ts` — 3 tests (C5.1)

### Bridge — Phase A

- `packages/bridge/src/dashboard.ts` — NEW: activeCycleKPIsSchema, mentionDashboardItemSchema, dashboardResponseSchema (A2.4)
- `packages/bridge/src/index.ts` — re-exports de los 3 schemas + 3 tipos (A2.4)
- `packages/bridge/src/__tests__/dashboard.test.ts` — 23 tests (A2.1–A2.3)

### Frontend — Phases B + C + D

- `packages/web/src/features/inbox/use-dashboard-query.ts` — DashboardData desde bridge; re-exports (B1.2) [WARNING: McpProposal import faltante]
- `packages/web/src/features/inbox/current-cycle-card.tsx` — NEW: Sparkline + CurrentCycleCard (B2.3, B3.4, B4.3)
- `packages/web/src/features/inbox/mention-row.tsx` — NEW: MentionRow con navigate condicional (C1.4)
- `packages/web/src/features/inbox/project-picker-popover.tsx` — NEW: render-prop, 3 casos (D1.4)
- `packages/web/src/features/inbox/inbox-view.tsx` — CurrentCycleCard + MentionsSection + 4 QuickRows + Search removed (B5.2, C2.3, D2.5)
- `packages/web/src/features/issue-detail/comments-highlight-view.tsx` — NEW: scroll + highlight (C4.6)
- `packages/web/src/features/issue-detail/agent-thread.tsx` — div title + input placeholder + data-testid (D5.4)
- `packages/web/src/routes/_authenticated/issue.tsx` — validateSearch extendido + RightPaneContent exportado + behavior matrix (C3.4, C4.7)
- `packages/web/src/routes/_authenticated/inbox.tsx` — validateInboxSearch exportado + blocked param (D3.2)
- `packages/web/src/components/command-palette.tsx` — 3 AI handlers con navigate + TODO(KAN-50) (D4.5)
- Test files web: 8+ nuevos archivos de test (B1.1, B2.1–2, B3.1–3, B4.1–2, B5.1–3, C1.1–3, C2.1–2, C3.1–4, C4.1–5, D1.1–3, D2.1–4, D3.1, D4.1–4, D5.1–3)

### Post-fix typecheck commit (2026-05-03)

- `packages/api/tsconfig.json` — añadido `paths: { "@kanon/bridge": ["../bridge/src/index.ts"] }` (resuelve CRITICAL-1)
- `packages/web/tsconfig.json` — mismo path alias (resuelve CRITICAL-1)
- `packages/web/src/features/inbox/use-dashboard-query.ts` — restaurado `import type { McpProposal } from "@/types/proposal"` (resuelve CRITICAL-2)
- `packages/web/src/features/inbox/inbox-view.tsx` — casts `as Issue[]`, `as McpProposal[]`, `as ActiveAgentSession[]` para destructuring desde `unknown[]` del bridge schema (resuelve 5 errores TS7006)
- `packages/web/src/features/inbox/__tests__/mention-row.test.tsx` — optional chaining `?.[0]` + `expect(callArgs).toBeDefined()` (resuelve TS2532)
- `packages/web/src/features/issue-detail/__tests__/comments-highlight-view.test.tsx` — fixture `Comment` con `author.id`, `updatedAt` (resuelve TS2741)
- `packages/web/src/routes/__tests__/issue-detail-pane.test.tsx` — fixture `Comment` con `author.id`, `updatedAt`, `source: Comment["source"]` typing (resuelve TS2322 + TS2741)

**Issue de follow-up creado**: KAN-51 — `Fix typecheck errors in issue-search-params.test.ts (TanStack Router validateSearch API)` (low priority, 5 errores TS2349 remanentes).
