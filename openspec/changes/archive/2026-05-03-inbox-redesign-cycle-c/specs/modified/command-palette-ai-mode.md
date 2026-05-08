# Capability: command-palette-ai-mode (modified)

## Purpose

Delta de requisitos sobre el modo AI del Command Palette: las 3 sugerencias hardcoded DEBEN navegar a destinos reales en lugar de solo llamar `onClose`. Cada `onSelect` llama `navigate(destino)` y luego cierra el palette.

> Nota: Este archivo complementa el spec existente de `command-palette-ai-mode`. Solo se especifican los requisitos delta sobre las 3 sugerencias hardcoded.

## Requirements

### REQ-PALETTE-AI-001 — Sugerencia "Plan next cycle" navega a `/cycles/$projectKey`

**MUST**: La sugerencia hardcoded "Plan next cycle" en el modo AI del Command Palette DEBE, al ser seleccionada, invocar `navigate({ to: "/cycles/$projectKey", params: { projectKey } })` con el `projectKey` del proyecto activo resuelto, Y LUEGO cerrar el palette. El código DEBE incluir un comentario `// TODO(KAN-50): wire to MCP roundtrip` o equivalente apuntando al spike futuro.

**MUST NOT**: El `onSelect` de "Plan next cycle" NO DEBE limitarse a llamar `onClose()` sin navegar — eso es "teatro" que la propuesta explícitamente elimina.

**Scenarios**:
1. **Given** el Command Palette está en modo AI y el workspace tiene 1 proyecto activo con key="ATLAS" **When** el usuario selecciona "Plan next cycle" **Then** `navigate` es invocado con `{ to: "/cycles/$projectKey", params: { projectKey: "ATLAS" } }` y el palette desaparece del DOM.
2. **Given** el usuario selecciona "Plan next cycle" **When** `onSelect` se ejecuta **Then** el orden de operaciones es: `navigate(...)` primero, luego `onClose()` — el test verifica el orden con spies.
3. **Given** el código fuente del `onSelect` de "Plan next cycle" **When** se lee el archivo **Then** contiene un comentario `// TODO(KAN-` (cualquier número de issue) que referencia el spike de MCP roundtrip.

---

### REQ-PALETTE-AI-002 — Sugerencia "Find blockers" navega al Inbox con filtro `blocked=true`

**MUST**: La sugerencia hardcoded "Find blockers" en el modo AI DEBE, al ser seleccionada, invocar `navigate` hacia el Inbox con `search: { blocked: true }` (o hacia el dashboard con `?blocked=true` si el filtro de blockers ya existe en esa vista — verificar antes del apply). El código DEBE incluir un `// TODO(KAN-XX)` para el spike futuro. Luego DEBE cerrar el palette.

**MUST NOT**: El `onSelect` de "Find blockers" NO DEBE limitarse a llamar `onClose()` sin navegar.

**Scenarios**:
1. **Given** el Command Palette está en modo AI **When** el usuario selecciona "Find blockers" **Then** `navigate` es invocado con un destino que incluye `blocked: true` en el search (Inbox o dashboard según lo que exista), y el palette se cierra.
2. **Given** el usuario selecciona "Find blockers" **When** `onSelect` se ejecuta **Then** el orden es: `navigate(...)` primero, luego `onClose()` — verificable con spies ordenados.
3. **Given** el código fuente del `onSelect` de "Find blockers" **When** se lee el archivo **Then** contiene un comentario `// TODO(KAN-` que referencia el spike de MCP roundtrip (mismo pattern que los otros dos `onSelect`s).

---

### REQ-PALETTE-AI-003 — Sugerencia "Draft digest" navega al Inbox

**MUST**: La sugerencia hardcoded "Draft digest" en el modo AI DEBE, al ser seleccionada, invocar `navigate({ to: "/inbox" })` (o equivalente al Inbox route), Y LUEGO cerrar el palette. El código DEBE incluir un `// TODO(KAN-XX)` para el spike futuro.

**MUST NOT**: El `onSelect` de "Draft digest" NO DEBE limitarse a llamar `onClose()` sin navegar.

**Scenarios**:
1. **Given** el Command Palette está en modo AI **When** el usuario selecciona "Draft digest" **Then** `navigate` es invocado con destino `/inbox` (o el nombre de la ruta del Inbox en TanStack Router) y el palette desaparece del DOM.
2. **Given** el usuario selecciona "Draft digest" **When** `onSelect` se ejecuta **Then** el orden es: `navigate(...)` primero, luego `onClose()` — verificable con spies.
3. **Given** el código fuente del `onSelect` de "Draft digest" **When** se lee el archivo **Then** contiene un comentario `// TODO(KAN-` que referencia el spike futuro.
