# Capability: inbox-mentions

## Purpose

Detectar, almacenar y renderizar menciones `@username` de usuarios entre miembros del workspace, permitiendo al mencionado navegar al contexto exacto (issue + comment) desde el Inbox.

## Requirements

### REQ-MENTION-001 — Modelo `Mention` en Prisma

**MUST**: El schema Prisma DEBE incluir un modelo `Mention` con al menos los siguientes campos:

```
model Mention {
  id                  String   @id @default(cuid())
  workspaceId         String
  issueId             String
  commentId           String?  // null si la mención es en description del issue
  mentionedMemberId   String
  mentionedByMemberId String
  context             String   // fragmento de texto que contiene la @mención
  read                Boolean  @default(false)
  createdAt           DateTime @default(now())
}
```

**MUST NOT**: El modelo NO DEBE tener campos que rompan con la aditividad de la migración — no se DEBEN alterar tablas existentes (`Issue`, `Comment`, `Member`) con columnas obligatorias (NOT NULL sin default) en la misma migración.

**Scenarios**:
1. **Given** la migración `add_mention` se aplica a una base de datos con datos existentes de `Issue` y `Comment` **When** se ejecuta la migración **Then** la base de datos no arroja errores y las tablas `Issue` y `Comment` mantienen todas sus filas intactas.
2. **Given** un `Mention` creado con `commentId = null` (mención en description) **When** se consulta `Mention.findMany()` **Then** el registro existe con `commentId = null` y `issueId` populado.
3. **Given** se droppea la tabla `Mention` en un rollback **When** se consultan `Issue` y `Comment` **Then** ambas tablas funcionan sin error (no hay FK inversa obligatoria que rompa).

---

### REQ-MENTION-002 — Parser `@username`: regex y resolución contra miembros del workspace

**MUST**: El parser de menciones DEBE usar la expresión regular `/@(\w+)/g` para extraer candidatos de `@mención` del texto, y DEBE resolver cada candidato contra los `username`s de los miembros activos del workspace. Solo las coincidencias exactas con un `username` existente DEBEN generar una fila `Mention`.

**MUST NOT**: Candidatos `@algo` que no coincidan con ningún `username` de miembro activo del workspace NO DEBEN generar fila `Mention`. El parser NO DEBE hacer lookups de username case-insensitive a menos que se decida explícitamente — la resolución por defecto es case-sensitive.

**Scenarios**:
1. **Given** el workspace tiene miembro con `username = "alice"` y el body del comment es `"@alice gracias"` **When** se crea el comment **Then** existe exactamente 1 fila `Mention` con `mentionedMemberId = alice.memberId` y `context = "@alice gracias"`.
2. **Given** el workspace no tiene ningún miembro con `username = "phantom"` y el body del comment contiene `"@phantom"` **When** se crea el comment **Then** no se crea ninguna fila `Mention`.
3. **Given** el body del comment contiene `"@alice @bob gracias"` y ambos son miembros **When** se crea el comment **Then** se crean 2 filas `Mention`, una para alice y otra para bob, ambas con el mismo `commentId`.

---

### REQ-MENTION-003 — Trigger parse-on-write en Comment create y update

**MUST**: El Comment service DEBE ejecutar el parser de menciones y hacer upsert en `Mention` inmediatamente después de crear o actualizar un `Comment.body`.

**MUST NOT**: El parser NO DEBE ejecutarse en reads, deletes ni en operaciones sobre `Comment` que no modifiquen `body`.

**Scenarios**:
1. **Given** un comment existente sin menciones es actualizado cambiando body de `"ok"` a `"@alice revisa esto"` **When** se completa el update **Then** existe 1 fila `Mention` nueva para alice con el `commentId` correspondiente.
2. **Given** un comment con mención a alice es actualizado eliminando la @mención del body **When** se completa el update **Then** la fila `Mention` anterior para ese `commentId` y `mentionedMemberId = alice.memberId` DEBE borrarse o marcarse como inválida (la mención ya no existe en el texto actual).
3. **Given** se hace `GET /comments/:id` (read) **When** retorna el comment **Then** no se ejecuta ningún parser de menciones y el conteo de filas en `Mention` no cambia.

---

### REQ-MENTION-004 — Trigger parse-on-write en Issue create y update (description)

**MUST**: El Issue service DEBE ejecutar el parser de menciones y hacer upsert en `Mention` inmediatamente después de crear o actualizar un `Issue.description`, con `commentId = null`.

**MUST NOT**: El parser NO DEBE ejecutarse sobre el campo `title` del Issue, solo sobre `description`.

**Scenarios**:
1. **Given** se crea un Issue con `description = "@bob por favor revisa los criterios"` **When** se completa la creación **Then** existe 1 fila `Mention` con `commentId = null`, `issueId` del nuevo issue, `mentionedMemberId = bob.memberId`.
2. **Given** se actualiza un Issue cambiando `title` de `"@alice task"` a `"@alice updated task"` sin cambiar `description` **When** se completa el update **Then** no se crea ni modifica ninguna fila `Mention`.
3. **Given** se crea un Issue con `description = null` **When** se completa la creación **Then** no se ejecuta el parser y no se crea ninguna fila `Mention`.

---

### REQ-MENTION-005 — Exclusión de auto-menciones

**MUST**: El parser DEBE excluir menciones donde `mentionedMemberId === mentionedByMemberId`. Un usuario no puede mencionarse a sí mismo y generar una fila `Mention`.

**MUST NOT**: El servicio NO DEBE crear filas `Mention` donde `mentionedMemberId` y `mentionedByMemberId` sean el mismo miembro, incluso si el `@username` del autor aparece en su propio texto.

**Scenarios**:
1. **Given** alice (memberId="m-alice") crea un comment con body `"@alice recordatorio"` **When** se procesa el comment **Then** no se crea ninguna fila `Mention` para alice.
2. **Given** alice crea un comment con body `"@bob @alice recuerden esto"` **When** se procesa el comment **Then** se crea 1 fila `Mention` para bob y ninguna para alice.
3. **Given** bob crea un comment con body `"@bob"` **When** se procesa el comment **Then** no se crea ninguna fila `Mention`.

---

### REQ-MENTION-006 — Aislamiento multi-tenant en la query de menciones del dashboard

**MUST**: El dashboard endpoint DEBE retornar únicamente las menciones donde `mentionedMemberId = memberId del usuario autenticado en ese workspace`. Las menciones de otros miembros NO DEBEN aparecer en la respuesta.

**MUST NOT**: La query de `Mention` NO DEBE omitir el filtro `workspaceId` — incluso si dos workspaces tienen miembros con el mismo `username`, las menciones DEBEN estar aisladas por workspace.

**Scenarios**:
1. **Given** alice es miembro en workspace W1 y hay menciones para alice y bob en W1 **When** alice llama `GET /api/workspaces/W1/dashboard` **Then** `mentions` contiene solo las menciones donde `mentionedMemberId = alice.memberId` y `workspaceId = W1`.
2. **Given** alice es miembro en workspace W1 y W2, y tiene menciones en ambos **When** alice llama `GET /api/workspaces/W1/dashboard` **Then** `mentions` solo contiene menciones de W1, no de W2.
3. **Given** bob llama `GET /api/workspaces/W1/dashboard` y en W1 solo hay menciones para alice **When** retorna la respuesta **Then** `mentions: []` (array vacío).

---

### REQ-MENTION-007 — Shape de `Mention` en la respuesta del dashboard

**MUST**: Cada elemento del array `mentions` en la respuesta del dashboard DEBE tener la siguiente shape:

```
{
  id: string,
  issueKey: string,
  issueTitle: string,
  commentId: string | null,
  mentionedByUsername: string,
  context: string,
  createdAt: string (ISO datetime)
}
```

**Scenarios**:
1. **Given** una `Mention` válida en DB **When** se llama `GET /api/workspaces/:id/dashboard` **Then** el objeto en `mentions[]` tiene todos los campos del shape anterior y ninguno es `undefined`.
2. **Given** una mención en `description` del issue (no en comment) **When** se incluye en la respuesta **Then** `commentId` es `null`, no es string vacío ni ausente.
3. **Given** 0 menciones para el usuario autenticado en ese workspace **When** retorna el dashboard **Then** `mentions` es `[]`, no `null` ni `undefined`.

---

### REQ-MENTION-008 — Componente `MentionRow`: renderizado y navegación

**MUST**: El componente `MentionRow` DEBE renderizar una fila dentro de la sección Mentions del Inbox mostrando visiblemente el `mentionedByUsername`, un fragmento de `context` y el `issueTitle`. Al hacer click, DEBE navegar a `/issue/$key?from=inbox&highlight=mention&commentId=<id>`.

**MUST NOT**: `MentionRow` NO DEBE navegar con `window.location.href` — DEBE usar el router de la aplicación (TanStack Router `navigate`).

**Scenarios**:
1. **Given** una `Mention` con `mentionedByUsername="alice"`, `context="@bob revisa esto"`, `issueTitle="Fix login"`, `commentId="cmt-1"` **When** se renderiza `MentionRow` **Then** el DOM contiene texto visible `"alice"`, texto `"@bob revisa esto"` y texto `"Fix login"`.
2. **Given** el usuario hace click en el `MentionRow` **When** se dispara el click **Then** `navigate` es llamado con `{ to: "/issue/$key", params: { key: issueKey }, search: { from: "inbox", highlight: "mention", commentId: "cmt-1" } }`.
3. **Given** `commentId = null` (mención en description) **When** el usuario hace click **Then** `navigate` es llamado con `search: { from: "inbox", highlight: "mention" }` sin `commentId`.

---

### REQ-MENTION-009 — Issue detail: scroll-to y highlight del comment cuando `highlight=mention&commentId=<id>`

**MUST**: Cuando el issue detail se monta con `?highlight=mention&commentId=<id>` en el search param, el right pane DEBE hacer scroll automáticamente al comment cuyo `id` coincida con `commentId` y DEBE aplicar un highlight visual (clase CSS o `data-highlighted="true"`) en ese elemento.

**MUST NOT**: El scroll y highlight NO DEBEN dispararse si `highlight` no es `"mention"` en el search param, para no interferir con otros usos del right pane.

**Scenarios**:
1. **Given** issue detail montado con `?highlight=mention&commentId=cmt-42` y el comment `cmt-42` está en el right pane **When** el componente completa su mount **Then** el elemento con `data-comment-id="cmt-42"` tiene `data-highlighted="true"` y está visible en el viewport (scroll completado).
2. **Given** issue detail montado con `?highlight=mention&commentId=cmt-99` pero `cmt-99` no existe en la lista de comments **When** el componente completa su mount **Then** no hay error en consola, ningún elemento tiene `data-highlighted="true"`, el pane muestra los comments normalmente.
3. **Given** issue detail montado con `?from=inbox` pero sin `highlight=mention` **When** el componente completa su mount **Then** ningún comment tiene `data-highlighted="true"` y no se hace scroll automático.

---

### REQ-MENTION-010 — Issue detail: fallback cuando `AgentThread` está vacío

**MUST**: Cuando el issue detail se renderiza con `?highlight=mention&commentId=<id>` y el `AgentThread` del issue está vacío (sin mensajes MCP), el right pane DEBE mostrar la lista de comments del issue en lugar del AgentThread vacío.

**MUST NOT**: El right pane NO DEBE mostrar el AgentThread vacío cuando hay un `commentId` de mención activo — el usuario espera ver el contexto de la mención.

**Scenarios**:
1. **Given** un issue con AgentThread vacío (0 mensajes MCP) y `?highlight=mention&commentId=cmt-5` en la URL **When** se renderiza el issue detail **Then** el right pane muestra `data-testid="comments-list"` en lugar de `data-testid="agent-thread"`.
2. **Given** un issue con AgentThread con mensajes y `?highlight=mention&commentId=cmt-5` **When** se renderiza el issue detail **Then** el right pane muestra ambos: el comment destacado (con `data-highlighted="true"`) y el AgentThread debajo (o en orden según el diseño).
3. **Given** un issue con AgentThread vacío y sin `highlight=mention` en la URL **When** se renderiza el issue detail **Then** el right pane muestra el AgentThread (comportamiento actual sin cambios).
