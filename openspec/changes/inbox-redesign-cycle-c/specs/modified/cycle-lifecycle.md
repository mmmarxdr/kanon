# Capability: cycle-lifecycle (modified)

## Purpose

Delta de requisitos sobre el cycle service: añadir el helper `computeAvgLeadDays(cycleId)` que calcula el promedio de días de lead time para los issues done del ciclo, excluyendo issues sin evento `state_changed → done` en activityLogs.

> Nota: Este archivo complementa el spec existente de `cycle-lifecycle`. Solo se especifican los requisitos delta.

## Requirements

### REQ-CYCLE-LEAD-TIME-001 — Helper `computeAvgLeadDays(cycleId): number | null`

**MUST**: El cycle service DEBE exponer un helper `computeAvgLeadDays(cycleId: string): Promise<number | null>` que retorne el promedio de `(done_at - issue.createdAt)` en días decimales para los issues del ciclo que tengan al menos un evento `type = "state_changed"` con `newState = "done"` en la tabla `activityLogs`. `done_at` DEBE tomarse del `createdAt` del evento más reciente que cumpla ese criterio para cada issue.

**MUST NOT**: Issues sin evento `state_changed → done` en `activityLogs` NO DEBEN contribuir al promedio. El helper NO DEBE usar `cycle.startDate` ni ningún fallback como proxy de `done_at` o `started_at`.

**Scenarios**:
1. **Given** un ciclo con 0 issues done con evento `state_changed → done` **When** se invoca `computeAvgLeadDays(cycleId)` **Then** retorna `null`.
2. **Given** un ciclo con 1 issue done, su `createdAt` es T y su evento `state_changed → done` tiene `createdAt` = T+5.5 días **When** se invoca `computeAvgLeadDays(cycleId)` **Then** retorna `5.5`.
3. **Given** un ciclo con 3 issues done: issue A (done_at - createdAt = 2d, tiene evento), issue B (done_at - createdAt = 4d, tiene evento), issue C (no tiene evento `state_changed → done`) **When** se invoca `computeAvgLeadDays(cycleId)` **Then** retorna `3.0` (promedio de 2 y 4; issue C se excluye completamente).

---

### REQ-CYCLE-LEAD-TIME-002 — Carga batch de `activityLogs` (anti N+1)

**MUST**: La implementación de `computeAvgLeadDays` DEBE cargar todos los `activityLogs` relevantes en una única query: `WHERE issueId IN (<ids de todos los issues del ciclo>) AND type = "state_changed" AND newState = "done"`. Luego DEBE agrupar los eventos en memoria para calcular el promedio.

**MUST NOT**: La implementación NO DEBE hacer una query separada de `activityLogs` por cada issue individual.

**Scenarios**:
1. **Given** un ciclo con 100 issues **When** se invoca `computeAvgLeadDays(cycleId)` **Then** el número de queries ejecutadas a la tabla `activityLogs` es exactamente 1.
2. **Given** un ciclo con 0 issues (scope=0) **When** se invoca `computeAvgLeadDays(cycleId)` **Then** retorna `null` sin emitir ninguna query a `activityLogs`.
3. **Given** un ciclo con N issues donde M tienen evento y (N-M) no tienen evento **When** se invoca `computeAvgLeadDays(cycleId)` **Then** el promedio se calcula solo sobre los M issues con evento y la query batch retorna solo los logs de esos M issues.

---

### REQ-CYCLE-LEAD-TIME-003 — Integración de `avgLeadDays` en `ActiveCycleKPIs`

**MUST**: El resultado de `computeAvgLeadDays` DEBE ser incluido como campo `avgLeadDays: number | null` en el objeto `ActiveCycleKPIs` que el dashboard endpoint compone para el campo `activeCycle`.

**MUST NOT**: `avgLeadDays` NO DEBE ser `0` cuando el resultado es `null` — la distinción entre "no hay datos" (`null`) y "lead time medido como 0 días" (`0`) es semánticamente crítica.

**Scenarios**:
1. **Given** `computeAvgLeadDays` retorna `null` para el ciclo activo **When** el dashboard endpoint compone `activeCycle` **Then** `activeCycle.avgLeadDays === null`.
2. **Given** `computeAvgLeadDays` retorna `3.5` para el ciclo activo **When** el dashboard endpoint compone `activeCycle` **Then** `activeCycle.avgLeadDays === 3.5`.
3. **Given** todos los issues done del ciclo tienen evento `state_changed → done` pero el `done_at - createdAt` es 0 horas (issue creado y cerrado el mismo segundo) **When** se invoca `computeAvgLeadDays` **Then** retorna `0.0` (no `null`) porque hay datos válidos — el lead time es simplemente 0.
