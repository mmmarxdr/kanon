# Capability: inbox-quick-actions-v2

## Purpose

Completar la sección Quick Actions del Inbox con dos nuevas filas ("Open dependency graph" y "Plan next cycle") que naveguen a destinos reales via resolución de `projectKey`, incluyendo un `ProjectPickerPopover` para workspaces con múltiples proyectos activos.

## Requirements

### REQ-INBOX-QUICK-001 — Fila "Open dependency graph"

**MUST**: La sección Quick Actions del Inbox DEBE incluir una fila con icono `Icon.Graph`, label "Open dependency graph", que al hacer click navegue a `/dependencies/$projectKey` con el `projectKey` del proyecto activo resuelto.

**MUST NOT**: La fila NO DEBE navegar directamente sin `projectKey` — no existe una ruta de dependency graph workspace-scoped.

**Scenarios**:
1. **Given** el workspace tiene exactamente 1 proyecto activo con `key = "PHOENIX"` **When** el usuario hace click en "Open dependency graph" **Then** `navigate({ to: "/dependencies/$projectKey", params: { projectKey: "PHOENIX" } })` es invocado sin mostrar ningún popover.
2. **Given** el workspace tiene 2 proyectos activos **When** el usuario hace click en "Open dependency graph" **Then** se abre el `ProjectPickerPopover` listando los 2 proyectos; al seleccionar uno `navigate` es invocado con ese `projectKey`.
3. **Given** el workspace tiene 0 proyectos activos **When** se renderiza la fila "Open dependency graph" **Then** el elemento tiene `aria-disabled="true"` y un tooltip con texto "No active project" visible al hacer hover.

---

### REQ-INBOX-QUICK-002 — Fila "Plan next cycle"

**MUST**: La sección Quick Actions del Inbox DEBE incluir una fila con icono `Icon.Road`, estilo `ai` (color `var(--ai)` o clase equivalente), label "Plan next cycle", que al hacer click navegue a `/cycles/$projectKey` con el `projectKey` resuelto.

**MUST NOT**: La fila "Plan next cycle" NO DEBE abrir un command palette ni disparar ninguna acción MCP — navega directamente a la vista de cycles (decisión D1).

**Scenarios**:
1. **Given** el workspace tiene exactamente 1 proyecto activo con `key = "ATLAS"` **When** el usuario hace click en "Plan next cycle" **Then** `navigate({ to: "/cycles/$projectKey", params: { projectKey: "ATLAS" } })` es invocado sin mostrar popover.
2. **Given** el workspace tiene 3 proyectos activos **When** el usuario hace click en "Plan next cycle" **Then** se abre `ProjectPickerPopover` listando los 3 proyectos; al seleccionar uno `navigate` es invocado con ese `projectKey`.
3. **Given** el workspace tiene 0 proyectos activos **When** se renderiza la fila "Plan next cycle" **Then** el elemento tiene `aria-disabled="true"` y un tooltip con texto "No active project".

---

### REQ-INBOX-QUICK-003 — `ProjectPickerPopover`: short-circuit cuando hay 1 proyecto

**MUST**: `ProjectPickerPopover` DEBE hacer short-circuit (invocar `onSelect` con el único `projectKey` directamente, sin montar el popover) cuando el workspace tiene exactamente 1 proyecto activo.

**MUST NOT**: El popover NO DEBE renderizarse en el DOM cuando hay exactamente 1 proyecto activo — la selección es automática e invisible para el usuario.

**Scenarios**:
1. **Given** `ProjectPickerPopover` recibe una lista de 1 proyecto (key="X") y el usuario hace click en el trigger **When** el click se dispara **Then** `onSelect("X")` es invocado inmediatamente, sin que aparezca ningún elemento de popover en el DOM.
2. **Given** `ProjectPickerPopover` recibe una lista de 2 proyectos (keys="A" y "B") **When** el usuario hace click en el trigger **Then** el popover es visible en el DOM, mostrando ambos proyectos como opciones seleccionables.
3. **Given** `ProjectPickerPopover` recibe una lista de 2 proyectos y el usuario selecciona "B" **When** la selección ocurre **Then** `onSelect("B")` es invocado y el popover se cierra (no visible en DOM).

---

### REQ-INBOX-QUICK-004 — Estado deshabilitado con 0 proyectos activos

**MUST**: Cuando el workspace tiene 0 proyectos activos, las filas "Open dependency graph" y "Plan next cycle" DEBEN estar deshabilitadas con tooltip visible "No active project".

**MUST NOT**: Las filas deshabilitadas NO DEBEN invocar `navigate` ni montar el `ProjectPickerPopover` al hacer click.

**Scenarios**:
1. **Given** `useProjectsQuery` retorna una lista vacía de proyectos activos **When** se renderiza la sección Quick Actions **Then** los elementos `data-testid="quick-dep-graph"` y `data-testid="quick-plan-cycle"` tienen `aria-disabled="true"`.
2. **Given** las filas están deshabilitadas y el usuario hace click en "Open dependency graph" **When** el click se dispara **Then** `navigate` no es invocado y el popover no se monta.
3. **Given** las filas están deshabilitadas y el usuario hace hover sobre "Plan next cycle" **When** el tooltip aparece **Then** contiene el texto "No active project" (exacto o equivalente honesto).

---

### REQ-INBOX-QUICK-005 — Orden de las filas Quick Actions

**MUST**: La sección Quick Actions DEBE renderizar las 4 filas en el siguiente orden vertical:
1. New issue (kbd `C`)
2. Ask Kanon (kbd `⌘J`)
3. Open dependency graph
4. Plan next cycle

**MUST NOT**: Las nuevas filas NO DEBEN reemplazar ni desplazar las filas existentes "New issue" y "Ask Kanon" — se añaden al final.

**Scenarios**:
1. **Given** el Inbox está montado con un workspace activo **When** se renderiza la sección Quick Actions **Then** hay exactamente 4 hijos `data-testid="quick-action-row"` en el orden: new-issue, ask-kanon, dep-graph, plan-cycle.
2. **Given** el workspace tiene 0 proyectos activos **When** se renderiza la sección **Then** siguen siendo 4 filas en el mismo orden, pero dep-graph y plan-cycle tienen `aria-disabled="true"`.
3. **Given** se hace snapshot del componente Quick Actions con 1 proyecto activo **When** el snapshot se regenera **Then** el orden de filas en el snapshot coincide con el orden especificado.
