# Capability: dashboard-endpoint (modified)

## Purpose

Delta de requisitos sobre `GET /api/workspaces/:id/dashboard`: añadir los campos `activeCycle?: ActiveCycleKPIs` y `mentions: Mention[]` a la respuesta existente.

> Nota: Esta capability extiende `REQ-API-DASHBOARD-001` existente. Solo se especifican los requisitos delta — el contrato base (counts, assigned, proposals, agents) permanece sin cambios.

## Requirements

### REQ-API-DASHBOARD-002 — Campo `activeCycle` en la respuesta del dashboard

**MUST**: La respuesta de `GET /api/workspaces/:id/dashboard` DEBE incluir el campo `activeCycle` de tipo `ActiveCycleKPIs | null`. Cuando el workspace tiene al menos un ciclo activo, el campo DEBE estar populado con el ciclo de `startDate` más reciente. Cuando no hay ningún ciclo activo, DEBE ser `null`.

**MUST NOT**: El campo `activeCycle` NO DEBE estar ausente de la respuesta — siempre DEBE estar presente, ya sea con un valor o como `null`.

**Scenarios**:
1. **Given** workspace con un proyecto que tiene un ciclo activo **When** `GET /api/workspaces/:id/dashboard` **Then** HTTP 200, body contiene `activeCycle` con shape `{ id, name, projectName, startDate, endDate, completed, scope, donePct, velocity, avgLeadDays, burnup }` y todos los campos tienen el tipo correcto.
2. **Given** workspace sin ningún ciclo activo en ningún proyecto **When** `GET /api/workspaces/:id/dashboard` **Then** HTTP 200, body contiene `activeCycle: null` (clave presente, valor null).
3. **Given** workspace con 2 proyectos, uno con ciclo activo startDate "2026-04-01" y otro "2026-05-01" **When** `GET /api/workspaces/:id/dashboard` **Then** `activeCycle.startDate` es `"2026-05-01"` (el más reciente).

---

### REQ-API-DASHBOARD-003 — Campo `mentions` reemplaza el placeholder `[]`

**MUST**: La respuesta de `GET /api/workspaces/:id/dashboard` DEBE incluir el campo `mentions: Mention[]` con las menciones reales para el usuario autenticado en ese workspace, consultando la tabla `Mention` donde `mentionedMemberId = member del usuario en el workspace`.

**MUST NOT**: `mentions` NO DEBE ser un array hardcodeado vacío `[]` — DEBE venir de la base de datos. Tampoco DEBE ser `null` — si no hay menciones, DEBE ser `[]`.

**Scenarios**:
1. **Given** alice tiene 3 menciones en el workspace y llama al dashboard **When** `GET /api/workspaces/:id/dashboard` autenticada como alice **Then** HTTP 200, `mentions` es un array de 3 objetos con shape `{ id, issueKey, issueTitle, commentId, mentionedByUsername, context, createdAt }`.
2. **Given** alice no tiene ninguna mención en el workspace **When** `GET /api/workspaces/:id/dashboard` **Then** HTTP 200, `mentions: []` (array vacío, no null).
3. **Given** bob llama al dashboard del mismo workspace donde alice tiene menciones **When** `GET /api/workspaces/:id/dashboard` autenticado como bob **Then** `mentions` no contiene las menciones de alice — aislamiento correcto.

---

### REQ-API-DASHBOARD-004 — Aislamiento multi-tenant de `mentions` en el dashboard

**MUST**: Las menciones retornadas por el dashboard DEBEN estar filtradas por `workspaceId` además de por `mentionedMemberId`. Un miembro que pertenece a múltiples workspaces NO DEBE ver menciones de otros workspaces en la respuesta del dashboard de un workspace específico.

**MUST NOT**: La query de `Mention` NO DEBE omitir el filtro `workspaceId`, aunque el `mentionedMemberId` ya sea único globalmente.

**Scenarios**:
1. **Given** alice es miembro en W1 y W2, tiene menciones en ambos **When** alice llama `GET /api/workspaces/W1/dashboard` **Then** `mentions` contiene solo menciones donde `workspaceId = W1`.
2. **Given** workspace W1 tiene `workspaceId = "ws-1"` y W2 tiene `workspaceId = "ws-2"` **When** se ejecuta la query de mentions para W1 **Then** la query SQL/Prisma incluye `WHERE workspaceId = 'ws-1' AND mentionedMemberId = '<alice-member-id>'`.
3. **Given** dos usuarios con el mismo `username` en workspaces distintos (posible en early-adopter multi-tenant) **When** cada uno llama a su propio dashboard **Then** cada uno ve solo sus propias menciones en su workspace — no hay fuga cross-workspace.

---

### REQ-API-DASHBOARD-005 — `multipleActiveProjects` flag en la respuesta

**MUST**: La respuesta DEBE incluir el campo booleano `multipleActiveProjects: boolean` que indique si el workspace tiene más de un proyecto con ciclo activo simultáneo. El frontend usa este flag para decidir si mostrar el nombre del proyecto en el subtítulo del `CurrentCycleCard`.

**MUST NOT**: El flag NO DEBE ser calculado en el frontend — es responsabilidad del backend determinarlo en el mismo query que resuelve `activeCycle`.

**Scenarios**:
1. **Given** workspace con 2 proyectos, ambos con ciclos activos **When** `GET /api/workspaces/:id/dashboard` **Then** `multipleActiveProjects: true`.
2. **Given** workspace con 1 solo proyecto con ciclo activo **When** `GET /api/workspaces/:id/dashboard` **Then** `multipleActiveProjects: false`.
3. **Given** workspace sin ningún ciclo activo **When** `GET /api/workspaces/:id/dashboard` **Then** `activeCycle: null` y `multipleActiveProjects: false`.
