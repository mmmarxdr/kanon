# Proposal: inbox-redesign-cycle-c

## Why

El rediseño de Cycle C deja al Inbox como el cockpit diario del dev: un panel de izquierda con secciones accionables y un right rail de tres `RailCard` (current cycle, active agents, quick actions). Hoy el Inbox solo cubre dos de las tres tarjetas, las quick actions están incompletas y la sección Mentions está stubeada como `mentions: []`. El resultado es una superficie incoherente con el design bundle (`view-inbox.jsx`) y con la promesa AI-native: el dev no ve el pulso del ciclo activo, no puede saltar al dependency graph ni planear el próximo ciclo desde el Inbox, y las @-menciones de compañeros simplemente no existen como evento navegable.

Además, dos piezas vecinas mienten al usuario: el `AgentThread` muestra "Direct prompts to agents arrive in Phase 3" (no se va a cablear nunca por ahí — los agentes actúan vía MCP) y las 3 sugerencias AI del Command Palette tienen `onSelect: onClose` (teatro). Cycle C cierra esa brecha entregando KAN-27/28/29 con una fundación de mentions reusable y dejando explícitamente parqueado el cableado real de Ask Kanon → MCP roundtrip para Cycle E (ver "Future work").

## What changes

**packages/api**
- Nuevo modelo Prisma `Mention` (denormalizado, parse-on-write) con migración aditiva.
- Comment service y Issue service: parsear `@username` al crear/actualizar `body`/`description` y upsert en `Mention`.
- Cycle service: helper `computeAvgLeadDays(cycleId)` — promedia `done_at - issue.createdAt` sobre issues con evento `state_changed → done` en `activityLogs`. Issues sin ese evento se EXCLUYEN.
- Dashboard route (`GET /api/workspaces/:id/dashboard`): añade `activeCycle?: ActiveCycleKPIs` (resuelto como el active cycle con `startDate` más reciente entre proyectos del workspace) y reemplaza `mentions: []` por consulta real a `Mention where mentionedMemberId = currentMember`.

**packages/bridge**
- Schemas Zod nuevos: `Mention`, `ActiveCycleKPIs` (`{ id, name, startDate, endDate, completed, scope, donePct, velocity, avgLeadDays, burnup }`).

**packages/web**
- `CurrentCycleCard` (KAN-27): primera `RailCard` del Inbox, con `Sparkline` SVG (280×36 sobre `burnup[]`) y mini-strip Done % / Avg lead / Velocity.
- Quick actions (KAN-28): nuevas filas "Open dependency graph" (`Icon.Graph` → `/dependencies/$projectKey` con `ProjectPickerPopover` si hay >1 proyecto) y "Plan next cycle" (`Icon.Road`, `ai`-styled → `/cycles/$projectKey`, decisión D1).
- Sección Mentions (KAN-29): tipa `DashboardData.mentions: Mention[]`, renderiza `MentionRow` (variante de `InboxRow` que muestra `@author · context-snippet`) y navega a `/issue/$key?from=inbox&highlight=mention&commentId=<id>`.
- Issue detail: cuando `AgentThread` esté vacío, el right pane muestra el comments list con highlight + scroll-to del comment cuya `id` coincida con `commentId` del search param (decisión 7).
- `AgentThread`: cambiar el `title` del input disabled a "View only · agents act via MCP" (decisión 5, una línea).
- Command Palette AI mode: las 3 sugerencias hardcoded dejan de ser `onSelect: onClose` y navegan ("Plan next cycle" → `/cycles/$projectKey`, "Find blockers" → dashboard con `?blocked=true` (verificar filtro; fallback a Inbox), "Draft digest" → Inbox). Cada navegación lleva `// TODO(KAN-XX)` apuntando al spike futuro de MCP roundtrip (decisión 6).

## Approach summary

**Sequencing — backend primero, frontend KAN-27 → KAN-29 → KAN-28.** Las tres issues comparten el endpoint `dashboard` y dos de ellas (KAN-27, KAN-29) requieren cambios de schema/cómputo en API. Empezamos por Prisma + migración `Mention` y por extender el dashboard endpoint con `activeCycle` y `mentions` reales — esto desbloquea el frontend completo de un solo round-trip.

**Reuse aggressivo.** `getCycle()` ya devuelve `burnup`, `completed`, `scope`, `velocity`; solo agregamos `avgLeadDays`. El Inbox ya consume `dashboardKeys.detail(workspaceId)` — extendemos la query, no creamos una nueva. El issue detail ya tiene un right pane de 380px con Properties + AgentThread; reusamos ese contenedor para el highlight de mentions sin agregar columnas. El `InboxRow` actual cubre el patrón visual de `MentionRow` (variante con prop `mention`).

**Honestidad sobre AgentThread y Ask Kanon.** Decidimos NO cablear MCP roundtrip en este cycle porque es 2-3 semanas de trabajo (streaming + tool-use loop sobre 43 tools + UI Apply/Reject + BYO key + rate limiting) — desproporcionado para Cycle C. En su lugar, dos cambios mínimos eliminan el teatro: el placeholder honesto del AgentThread (1 línea) y las 3 navegaciones reales del palette AI mode (cada una con `// TODO(KAN-XX)` para el spike futuro). Ask Kanon y AgentThread quedan visualmente intactos pero ya no mienten.

**Lead time como cómputo nuevo.** Es la única novedad algorítmica. El patrón ya existe en `computeBurnup` (scan de `activityLogs` por cycle issues); replicamos ese shape. Issues sin evento `state_changed → done` se excluyen del promedio (no fallback a `cycle.startDate`) — decisión 1.

**Project resolution para quick actions.** El Inbox es workspace-scoped; el dependency graph y cycles view son project-scoped. Resolvemos con `ProjectPickerPopover` que hace short-circuit cuando hay un solo proyecto (mayoría de casos en early adopters).

## Affected requirements (delta capabilities)

Capabilities afectadas (nombres en kebab-case, contrato con sdd-spec):

**New capabilities**
- `inbox-current-cycle` — REQ-INBOX-CYCLE-001..N: rail card con sparkline + mini KPIs, resolución de active cycle multi-project, cómputo y exposición de `avgLeadDays`.
- `inbox-mentions` — REQ-MENTION-001..N: modelo `Mention`, parse-on-write desde Comment/Issue, query del dashboard, render de `MentionRow`, highlight + scroll-to en issue detail vía URL search params.
- `inbox-quick-actions-v2` — REQ-INBOX-QUICK-001..N: filas "Open dependency graph" y "Plan next cycle" con resolución de projectKey (popover) y navegaciones D1.

**Modified capabilities**
- `dashboard-endpoint` — REQ-API-DASHBOARD-001 (existente): añade `activeCycle?` y `mentions: Mention[]` a la response.
- `cycle-lifecycle` — REQ-CYCLE-LEAD-TIME-001 (nuevo dentro del spec existente): `computeAvgLeadDays` helper en cycle service.
- `command-palette-ai-mode` — REQ-PALETTE-AI-001 (existente): las 3 sugerencias hardcoded MUST navegar a destinos reales, NOT `onClose`.
- `agent-thread-readonly` — REQ-AGENT-THREAD-001 (existente): copy del input disabled refleja modo read-only honesto.

## Out of scope

- Cablear Ask Kanon a un MCP roundtrip real (LLM calls, streaming, tool-use loop, BYO key config, rate limiting). Es un spike separado para Cycle E.
- Nuevas vistas para roles PM / Delivery / C-Level. Parqueado en roadmap item `0864e023-7f19-4a65-aeb1-47c0efacf3a4`.
- UI de "mark as read" / unread badge / bulk-mark-all-read sobre `Mention`. La tabla SOPORTA `read: Boolean` para enabling futuro, pero la UI no se entrega aquí.
- AgentThread interactivo más allá del cambio de copy. No se agregan acciones, no se acepta input.
- Dependency graph workspace-scoped (sin projectKey). Se mantiene el endpoint existente project-scoped + popover.
- Highlight de mentions con animación / persistencia de "última mención vista". Solo highlight visual + scroll-to inicial.

## Future work (not in this change)

- **`[Spike] Wire Ask Kanon to MCP roundtrip with BYO key`** (high priority, target Cycle E) — cabeza de playa con devs antes de extender a otros roles. Cubre streaming, tool-use loop sobre las 43 tools MCP, UI Apply/Reject, BYO key config y rate limiting. La orquestación creará este issue por separado; este proposal solo lo referencia.
- **Roadmap item `0864e023-7f19-4a65-aeb1-47c0efacf3a4`** (Web-native AI for non-developer roles · horizon `later` · effort 5 / impact 5) — long-term parent del Ask Kanon evolution para PM/Delivery/Exec que nunca abrirán un cliente MCP. Costo modelado: $3-5/mes equipo chico, ~$100/mes empresa mediana (70 devs + PMs). El bottleneck NO es costo, es esfuerzo de implementación.
- **Mention "mark as read" + unread badge UI** — la tabla `Mention` ya queda con `read: Boolean` para habilitar esto sin migración futura.
- **KAN-30+ AgentThread interactivity** — solo si/cuando el spike de Ask Kanon lande y haya un canal para enviar prompts desde Kanon hacia agentes MCP.
- **Highlight scroll-to v2** — animación de pulse, "última mención vista" persistida, navegación entre mentions con teclado.

## Risks

- **Lead time computation novelty.** Primer cómputo en Kanon que itera `activityLogs` para promediar deltas temporales. Riesgo de N+1 sobre cycles con muchos issues; mitigamos pre-cargando todos los `activityLogs where issueId IN (...) AND newState = 'done'` en una sola query y agrupando en memoria. Caso borde: cycle sin issues con evento `done` → retornar `null` y la card oculta el mini "Avg lead" en lugar de mostrar `0d` engañoso.
- **Dashboard payload growth.** Agregar `activeCycle` (incluye `burnup[]` ~14 floats) + `mentions[]` puede 2x el tamaño de la response. Mitigación: el dashboard ya está cacheado por TanStack Query con `staleTime`; medimos antes y después y, si supera 50KB, consideramos lazy-load del `burnup` (separar a un endpoint follow-up). Aceptable en este cycle.
- **Prisma migration coordination.** Migración de `Mention` es aditiva (nueva tabla, FKs nullable a `Member`/`Issue`/`Comment`), pero requiere coordinar deploy API antes de web. Rollback plan: la tabla puede dropearse sin afectar Comments/Issues existentes — el parser solo INSERT/UPSERT, nunca lee de `Comment.body` para bloquear escritura.
- **Resolver de active cycle multi-project.** "Más reciente startDate" puede ser sorpresivo si el dev mira un proyecto distinto en su mente. Mitigación: `CurrentCycleCard` muestra `cycleName · startDate – endDate` (subtitle) Y el nombre del proyecto entre paréntesis si el workspace tiene >1 proyecto activo.
- **`ProjectPickerPopover` UX.** Si workspace tiene 0 proyectos activos, las quick actions de KAN-28 deben deshabilitarse con tooltip ("No active project"). Edge a cubrir en specs.
- **Honesty cosmetics drift.** Cambiar copy del AgentThread y palette AI mode sin cambios funcionales puede confundir si los `// TODO(KAN-XX)` apuntan a un issue que aún no existe al merge time. Mitigación: el spike "Wire Ask Kanon to MCP roundtrip" se crea ANTES del PR de KAN-28 (orquestador lo gestiona).

## Acceptance signals

- Inbox right rail muestra 3 cards en el orden del design (current cycle, active agents, quick actions). La primera tarjeta renderiza sparkline + Done % + Avg lead + Velocity desde el active cycle del workspace. Avg lead muestra `—` si no hay issues elegibles, no `0d`.
- Quick actions card lista 4 filas (New issue / Ask Kanon / Open dependency graph / Plan next cycle). Click en "Open dependency graph" navega a `/dependencies/$projectKey`; con >1 proyecto, abre popover de selección. Click en "Plan next cycle" navega a `/cycles/$projectKey` con la misma resolución.
- Crear un Comment con `"@alice gracias"` genera una fila `Mention` para alice con `context = "@alice gracias"`. La sección Mentions del Inbox de alice muestra esa entrada y al click navega a `/issue/$key?from=inbox&highlight=mention&commentId=<id>`. En el issue detail, el right pane scrollea al comment y lo resalta.
- `GET /api/workspaces/:id/dashboard` retorna `activeCycle` con shape `ActiveCycleKPIs` y `mentions` con shape `Mention[]`. Tests de integración `fastify.inject()` cubren los dos campos. Tests unitarios cubren `computeAvgLeadDays` con 0/1/N issues done y con/sin evento `state_changed`.
- AgentThread input disabled muestra "View only · agents act via MCP" (o copy aprobado). Snapshot test actualizado.
- Command Palette AI mode: las 3 sugerencias `Plan next cycle` / `Find blockers` / `Draft digest` ya no llaman `onClose` solo — invocan `navigate(...)` y luego cierran. Cada `onSelect` está cubierto por test que verifica el destino.
- Conventional commits scoped por package (`feat(api): ...`, `feat(web): ...`, `feat(bridge): ...`). Sin Co-Authored-By. Sin amend. Tests escritos antes de la implementación (Strict TDD activo).
