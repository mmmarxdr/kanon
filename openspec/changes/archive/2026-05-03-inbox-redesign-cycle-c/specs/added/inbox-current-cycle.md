# Capability: inbox-current-cycle

## Purpose

Renderizar la primera `RailCard` del Inbox con los KPIs del ciclo activo del workspace (sparkline burnup + Done % / Avg lead / Velocity), resolviendo el ciclo activo cross-project y exponiendo `avgLeadDays` como métrica nueva.

## Requirements

### REQ-INBOX-CYCLE-001 — Resolución del ciclo activo para el workspace

**MUST**: El backend DEBE resolver el "active cycle" del workspace como el ciclo con `status = "active"` y `startDate` más reciente entre todos los proyectos del workspace. Si hay empate exacto de `startDate`, se elige el de menor `id` lexicográfico.

**MUST NOT**: No se DEBE exponer más de un ciclo activo en el campo `activeCycle` del dashboard response, aunque el workspace tenga múltiples proyectos con ciclos activos simultáneos.

**Scenarios**:
1. **Given** un workspace con dos proyectos, cada uno con un ciclo activo (startDates: "2026-04-21" y "2026-05-01") **When** se llama `GET /api/workspaces/:id/dashboard` **Then** la respuesta incluye `activeCycle` correspondiente al ciclo con startDate "2026-05-01".
2. **Given** un workspace sin ningún ciclo activo en ningún proyecto **When** se llama `GET /api/workspaces/:id/dashboard` **Then** la respuesta incluye `activeCycle: null` (campo presente pero nulo, no ausente).
3. **Given** un workspace con un solo proyecto y un ciclo activo **When** se llama `GET /api/workspaces/:id/dashboard` **Then** `activeCycle.id` coincide con el id del único ciclo activo del workspace.

---

### REQ-INBOX-CYCLE-002 — Shape de `ActiveCycleKPIs` en la respuesta del dashboard

**MUST**: El campo `activeCycle` en la respuesta del dashboard DEBE tener la siguiente shape cuando el ciclo existe:

```
{
  id: string,
  name: string,
  projectName: string,
  startDate: string (ISO date),
  endDate: string (ISO date),
  completed: number,
  scope: number,
  donePct: number,       // Math.round(completed/scope * 100), 0 cuando scope = 0
  velocity: number,
  avgLeadDays: number | null,
  burnup: number[]       // array de completions diarias acumuladas
}
```

**MUST NOT**: El campo `avgLeadDays` NO DEBE ser `0` cuando no hay issues elegibles — DEBE ser `null`.

**Scenarios**:
1. **Given** un ciclo activo con scope=10, completed=6, velocity=3, sin issues done con evento `state_changed → done` **When** se llama `GET /api/workspaces/:id/dashboard` **Then** `activeCycle.donePct = 60`, `activeCycle.avgLeadDays = null`, `activeCycle.burnup` es un array de números.
2. **Given** un ciclo activo con scope=0, completed=0 **When** se llama `GET /api/workspaces/:id/dashboard` **Then** `activeCycle.donePct = 0` (sin división por cero).
3. **Given** `activeCycle = null` **When** el cliente deserializa la respuesta con el schema Zod de `ActiveCycleKPIs` **Then** la validación no lanza error (campo es `ActiveCycleKPIs | null`).

---

### REQ-INBOX-CYCLE-003 — Cómputo de `avgLeadDays`

**MUST**: `computeAvgLeadDays(cycleId)` DEBE calcular el promedio de `(done_at - issue.createdAt)` expresado en días decimales, considerando únicamente los issues del ciclo que tienen un evento `state_changed → done` en `activityLogs`.

**MUST NOT**: Issues sin evento `state_changed → done` en `activityLogs` NO DEBEN contribuir al promedio, ni siquiera como 0 o con fallback a `cycle.startDate`.

**Scenarios**:
1. **Given** un ciclo con 3 issues done, solo 2 con evento `state_changed → done` en activityLogs (dones_at: T+2d y T+4d sobre createdAt respectivos) **When** se invoca `computeAvgLeadDays` **Then** retorna `3.0` (promedio de 2 y 4, el tercer issue se excluye).
2. **Given** un ciclo sin ningún issue con evento `state_changed → done` **When** se invoca `computeAvgLeadDays` **Then** retorna `null`.
3. **Given** un ciclo con exactamente 1 issue done con evento `state_changed → done` (done_at - createdAt = 5.5 días) **When** se invoca `computeAvgLeadDays` **Then** retorna `5.5`.

---

### REQ-INBOX-CYCLE-004 — Carga de `activityLogs` en batch (sin N+1)

**MUST**: La implementación de `computeAvgLeadDays` DEBE pre-cargar todos los `activityLogs` donde `issueId IN (ids de issues del ciclo)` AND `newState = 'done'` en una única query antes de iterar sobre los issues.

**MUST NOT**: NO se DEBE emitir una query de `activityLogs` por cada issue individual del ciclo.

**Scenarios**:
1. **Given** un ciclo con 50 issues done **When** se invoca `computeAvgLeadDays` **Then** el número de queries a `activityLogs` es exactamente 1, independientemente del número de issues.
2. **Given** un ciclo con 0 issues **When** se invoca `computeAvgLeadDays` **Then** retorna `null` sin emitir ninguna query a `activityLogs`.
3. **Given** un ciclo con 5 issues done con eventos en activityLogs **When** se invoca `computeAvgLeadDays` **Then** el resultado es el promedio correcto y los logs de DB muestran una sola query `WHERE issueId IN (...)`.

---

### REQ-INBOX-CYCLE-005 — Componente `CurrentCycleCard`

**MUST**: El componente `CurrentCycleCard` DEBE renderizar dentro de un `RailCard` los siguientes elementos visibles:
- Un sparkline SVG (viewBox `0 0 280 36`) generado desde `activeCycle.burnup[]`.
- Tres valores mini-KPI: Done % (sufijo `%`), Avg lead (sufijo `d` o `—` si null), Velocity (prefijo `+` si positivo).
- Un subtítulo con formato `cycleName · startDate – endDate`.

**MUST NOT**: El componente NO DEBE renderizarse cuando `activeCycle` es `null` — en su lugar se DEBE renderizar un estado vacío (skeleton o placeholder con texto "No active cycle").

**Scenarios**:
1. **Given** `activeCycle` con `donePct=62`, `avgLeadDays=3.4`, `velocity=2`, `burnup=[0,1,3,5,6]` **When** se renderiza `CurrentCycleCard` **Then** el DOM contiene un elemento `<svg>` con `data-testid="sparkline"`, texto `"62%"`, texto `"3.4d"`, texto `"+2"`.
2. **Given** `activeCycle` con `avgLeadDays=null` **When** se renderiza `CurrentCycleCard` **Then** el elemento con `data-testid="avg-lead-value"` muestra el texto `"—"`, no `"0d"` ni `"nulld"`.
3. **Given** `activeCycle = null` **When** se renderiza `CurrentCycleCard` **Then** el DOM contiene `data-testid="current-cycle-empty"` y no contiene ningún elemento `<svg>`.

---

### REQ-INBOX-CYCLE-006 — Subtítulo con nombre de proyecto cuando hay >1 ciclo activo multi-proyecto

**MUST**: Cuando el workspace tiene más de un proyecto con ciclo activo simultáneo (aunque solo uno se muestre), el subtítulo del `CurrentCycleCard` DEBE incluir el nombre del proyecto entre paréntesis: `cycleName · startDate – endDate (projectName)`.

**MUST NOT**: Cuando el workspace tiene exactamente un proyecto con ciclo activo, el nombre del proyecto NO DEBE aparecer en el subtítulo.

**Scenarios**:
1. **Given** workspace con 2 proyectos con ciclos activos, el mostrado pertenece al proyecto "Phoenix" **When** se renderiza `CurrentCycleCard` **Then** el elemento `data-testid="cycle-subtitle"` contiene el texto `"(Phoenix)"`.
2. **Given** workspace con 1 solo proyecto con ciclo activo **When** se renderiza `CurrentCycleCard` **Then** el elemento `data-testid="cycle-subtitle"` no contiene paréntesis ni nombre de proyecto.
3. **Given** `activeCycle.projectName = "Atlas"` y el dashboard responde con `multipleActiveProjects: true` **When** se renderiza `CurrentCycleCard` **Then** el subtítulo incluye `"(Atlas)"` como sufijo.

---

### REQ-INBOX-CYCLE-007 — Integración con `dashboardKeys.detail(workspaceId)` (sin nueva query key)

**MUST**: El `CurrentCycleCard` DEBE consumir el campo `activeCycle` del hook `useDashboardQuery(workspaceId)` existente. NO se DEBE crear un nuevo TanStack Query key para los datos del ciclo activo.

**MUST NOT**: NO se DEBE llamar a `GET /api/cycles/:id` desde el Inbox para obtener los datos del ciclo activo — el dato llega vía el dashboard endpoint.

**Scenarios**:
1. **Given** el TanStack Query cache tiene datos frescos del dashboard con `activeCycle` populado **When** se monta `CurrentCycleCard` **Then** el componente renderiza sin emitir ninguna request adicional de red (verificable vía MSW / `fetchMock.calls().length`).
2. **Given** el cache del dashboard expira (staleTime superado) y se hace un refetch **When** el refetch completa **Then** `activeCycle` en el cache se actualiza y `CurrentCycleCard` re-renderiza con los nuevos datos.
3. **Given** `useDashboardQuery` retorna `{ activeCycle: null }` **When** se renderiza el Inbox **Then** el rail muestra `data-testid="current-cycle-empty"` en lugar del sparkline.
