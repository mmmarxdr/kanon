# Capability: agent-thread-readonly (modified)

## Purpose

Delta de requisitos sobre `AgentThread`: el input deshabilitado DEBE mostrar un copy honesto que refleje el modo read-only real del componente, eliminando el placeholder que prometía interactividad futura ("Direct prompts to agents arrive in Phase 3").

> Nota: Este archivo complementa el spec existente de `agent-thread-readonly`. Solo se especifica el requisito delta sobre el copy del input.

## Requirements

### REQ-AGENT-THREAD-001 — Copy honesto en el input deshabilitado de `AgentThread`

**MUST**: El input deshabilitado del componente `AgentThread` DEBE mostrar el placeholder o título `"View only · agents act via MCP"` (o una variante aprobada equivalente que comunique: el panel es de solo lectura y los agentes operan externamente vía MCP, no a través de este input).

**MUST NOT**: El input NO DEBE mostrar el placeholder `"Direct prompts to agents arrive in Phase 3"` ni ningún otro texto que implique que en el futuro se podrá escribir ahí, ni mensajes vagos como "Coming soon".

**Scenarios**:
1. **Given** el componente `AgentThread` se renderiza en el issue detail **When** el DOM es inspeccionado **Then** el elemento `data-testid="agent-thread-input"` (o el input con `disabled` attribute) tiene `placeholder="View only · agents act via MCP"` y el atributo `disabled` está presente.
2. **Given** el snapshot existente de `AgentThread` se regenera tras el cambio **When** se corre el test de snapshot **Then** el snapshot falla (diferencia esperada) y al actualizarlo con `-u` el nuevo snapshot contiene `"View only · agents act via MCP"` en lugar del copy anterior.
3. **Given** el componente `AgentThread` se renderiza con 0 mensajes MCP (thread vacío) **When** el DOM es inspeccionado **Then** el input sigue mostrando `"View only · agents act via MCP"` — el copy no cambia según el estado del thread.
