# Technical Design: inbox-redesign-cycle-c

> Phase: sdd-design · Date: 2026-05-02
> Inputs: proposal.md + 7 spec files + engram `sdd/inbox-redesign-cycle-c/decisions`.
> Stack: React 19 / Vite / Tailwind / TanStack Router + Query / zustand / vitest. Backend: Fastify 5 + Prisma 6 + Zod.

---

## 1. Architecture overview

Las 3 issues (KAN-27/28/29) y los dos cosmetic fixes (AgentThread copy + Command Palette AI) se entregan como UN cambio porque comparten 1 endpoint (`/api/workspaces/:id/dashboard`) y 1 migración aditiva (`Mention`). El backend rellena `activeCycle` y `mentions` en el mismo round-trip que ya consume el Inbox; el frontend solo lee del cache existente (`dashboardKeys.detail(workspaceId)`). Cero query keys nuevos.

**Sequencing (estricto, no paralelo entre fases):**

```
1. Prisma migration (add_mention)
   └→ packages/api/prisma/schema.prisma
   └→ packages/api/prisma/migrations/<ts>_add_mention/migration.sql

2. Bridge Zod schemas (Mention, ActiveCycleKPIs, DashboardResponse)
   └→ packages/bridge/src/dashboard.ts (NEW file)
   └→ exported from packages/bridge/src/index.ts

3. API service helpers (pure functions, fully unit-testable)
   ├→ computeAvgLeadDays(cycleId)            in cycle/service.ts
   ├→ resolveActiveCycleForWorkspace(wsId)    in cycle/service.ts (or new helper file)
   └→ parseAndUpsertMentions({...})           in mentions/service.ts (NEW module)

4. API service integration
   ├→ comment/service.ts → call parseAndUpsertMentions on createComment + (NEW) updateComment
   └→ issue/service.ts → call parseAndUpsertMentions on createIssue + updateIssue (description only)

5. API routes
   └→ dashboard/routes.ts → extend response with activeCycle, mentions, multipleActiveProjects
   └→ comment/routes.ts → add PATCH /api/comments/:id (NEW, needed by REQ-MENTION-003)

6. Web hook types
   └→ use-dashboard-query.ts → DashboardData extends with new fields, infer from bridge

7. Web components (in design-implementation order — KAN-27 first, then KAN-29, then KAN-28)
   ├→ CurrentCycleCard + Sparkline
   ├→ MentionRow + Mentions section render
   ├→ Issue detail right-pane: search params + scroll-to + comments fallback
   ├→ ProjectPickerPopover + 2 new QuickRow rows
   ├→ AgentThread copy fix
   └→ CommandPalette AI mode navigations
```

Cada paso del 1 al 7 es independiente del siguiente *en commits*, pero el estricto orden DAG es backend → bridge → frontend (no tocar frontend antes que el bridge schema esté disponible).

---

## 2. Data model

### 2.1 Mention table (NEW)

```prisma
model Mention {
  id                  String   @id @default(uuid()) @db.Uuid
  workspaceId         String   @map("workspace_id") @db.Uuid
  issueId             String   @map("issue_id") @db.Uuid
  commentId           String?  @map("comment_id") @db.Uuid       // null = mention en Issue.description
  mentionedMemberId   String   @map("mentioned_member_id") @db.Uuid
  mentionedByMemberId String   @map("mentioned_by_member_id") @db.Uuid
  context             String   @db.Text                          // fragmento con la @mention
  read                Boolean  @default(false)
  createdAt           DateTime @default(now()) @map("created_at")

  workspace        Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  issue            Issue     @relation(fields: [issueId], references: [id], onDelete: Cascade)
  comment          Comment?  @relation(fields: [commentId], references: [id], onDelete: Cascade)
  mentionedMember  Member    @relation("MentionedMember",   fields: [mentionedMemberId],   references: [id], onDelete: Cascade)
  mentionedByMember Member   @relation("MentionedByMember", fields: [mentionedByMemberId], references: [id], onDelete: Cascade)

  @@unique([commentId, mentionedMemberId], map: "uniq_mention_per_comment_member")
  @@index([workspaceId, mentionedMemberId, read, createdAt(sort: Desc)], map: "idx_mention_dashboard_query")
  @@index([issueId])
  @@index([commentId])
  @@map("mentions")
}
```

**Decisiones de modelado**

- **FKs requeridas (no nullable) excepto `commentId`**: `workspaceId`, `issueId`, `mentionedMemberId`, `mentionedByMemberId` son MUST porque sin ellos la fila no tiene sentido. `commentId` es nullable porque la mención puede vivir en `Issue.description` (REQ-MENTION-004).
- **`onDelete: Cascade` en todas las FKs**: Si se borra un workspace/issue/comment/member, la mención pierde sentido. Cascada limpia. Para member borrados (probable en el futuro) la mención desaparece — aceptable (no estamos haciendo histórico legal).
- **Unique compuesto `(commentId, mentionedMemberId)`**: previene duplicados cuando un comment se actualiza con el mismo body y se re-parsea (idempotencia, mitigación de risk #3 del proposal).
  - Para menciones en `Issue.description` (`commentId = null`), Postgres permite múltiples filas con `commentId = NULL` aunque haya unique compuesto. Para esos casos, el parser hace explicit DELETE antes del INSERT (ver §3.3 algoritmo) para garantizar idempotencia. Esto evita la complejidad de un partial unique index.
- **Índice compuesto para dashboard query**: `(workspaceId, mentionedMemberId, read, createdAt DESC)` cubre exactamente la query del dashboard (`WHERE workspaceId = ? AND mentionedMemberId = ? ORDER BY createdAt DESC`). El campo `read` queda incluido para habilitar futuro filtro de "no leídas" sin cambio de índice.
- **`context: String @db.Text`** en lugar de `VarChar(N)`: las menciones pueden incluir snippet largo (sentence completa); no acotamos prematuramente. Frontend trunca en render.

**Migración: `<timestamp>_add_mention`**

- Solo `CREATE TABLE mentions`, sus 4 FKs, y los 3 índices.
- NO altera `issues`, `comments`, `members`, `workspaces`.
- Rollback: `DROP TABLE mentions CASCADE` (la cascada limpia los FKs sin tocar tablas existentes).
- Aditivo: deploy API antes que web es seguro porque el campo `mentions: []` ya está hardcoded en el dashboard response actual; cuando la migración corra y el código nuevo arranque, simplemente empieza a poblarlo.

**Relations a agregar en otros modelos** (necesarias para la FK back-references):
- `Workspace`: `mentions Mention[]`
- `Issue`: `mentions Mention[]`
- `Comment`: `mentions Mention[]`
- `Member`: `mentionsReceived Mention[] @relation("MentionedMember")`, `mentionsSent Mention[] @relation("MentionedByMember")`

### 2.2 ActiveCycleKPIs (NEW shared type)

**Ubicación:** `packages/bridge/src/dashboard.ts` (archivo nuevo).

```ts
import { z } from "zod";

export const activeCycleKPIsSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  projectName: z.string(),
  startDate: z.string(),                            // ISO date
  endDate: z.string(),                              // ISO date
  completed: z.number().int().min(0),
  scope: z.number().int().min(0),
  donePct: z.number().int().min(0).max(100),        // round(completed/scope*100), 0 si scope=0
  velocity: z.number().int().min(0),
  avgLeadDays: z.number().nullable(),               // null si no hay issues elegibles (REQ-INBOX-CYCLE-002)
  burnup: z.array(z.number()),                       // cumulative completions per day
});
export type ActiveCycleKPIs = z.infer<typeof activeCycleKPIsSchema>;
```

### 2.3 Mention (NEW shared type — dashboard response shape)

```ts
export const mentionDashboardItemSchema = z.object({
  id: z.string().uuid(),
  issueKey: z.string(),
  issueTitle: z.string(),
  commentId: z.string().uuid().nullable(),          // null para menciones en description
  mentionedByUsername: z.string(),
  context: z.string(),
  createdAt: z.string(),                            // ISO datetime
});
export type MentionDashboardItem = z.infer<typeof mentionDashboardItemSchema>;
```

### 2.4 DashboardData extension

**Current shape** (`packages/web/src/features/inbox/use-dashboard-query.ts` líneas 16-27):

```ts
export interface DashboardData {
  counts: { openIssues; inProgress; awaitingReview; activeAgents };
  assigned: Issue[];
  mentions: unknown[];                              // hardcoded []
  proposals: McpProposal[];
  agents: ActiveAgentSession[];
}
```

**New shape** (deriva de Zod via `z.infer`):

```ts
import {
  activeCycleKPIsSchema,
  mentionDashboardItemSchema,
} from "@kanon/bridge";

export const dashboardResponseSchema = z.object({
  counts: z.object({
    openIssues: z.number().int(),
    inProgress: z.number().int(),
    awaitingReview: z.number().int(),
    activeAgents: z.number().int(),
  }),
  assigned: z.array(/* existing Issue schema or z.unknown() if not yet shared */),
  mentions: z.array(mentionDashboardItemSchema),     // NO MORE unknown[]
  proposals: z.array(/* McpProposal */),
  agents: z.array(/* ActiveAgentSession */),
  activeCycle: activeCycleKPIsSchema.nullable(),     // NEW (REQ-API-DASHBOARD-002)
  multipleActiveProjects: z.boolean(),               // NEW (REQ-API-DASHBOARD-005)
});
export type DashboardData = z.infer<typeof dashboardResponseSchema>;
```

**TanStack Query key**: SIN cambios. Sigue siendo `dashboardKeys.detail(workspaceId)`. NO se crea `dashboardKeys.activeCycle` ni `dashboardKeys.mentions` — todo viaja por la misma query (REQ-INBOX-CYCLE-007).

---

## 3. API design

### 3.1 `computeAvgLeadDays(cycleId): Promise<number | null>` (cycle service)

**Ubicación:** `packages/api/src/modules/cycle/service.ts` (al lado de `computeBurnup`).

**Signatura:**
```ts
export async function computeAvgLeadDays(cycleId: string): Promise<number | null>;
```

**Reality check del schema (CRÍTICO)** — la spec REQ-CYCLE-LEAD-TIME-001 dice `type = "state_changed" AND newState = "done"` pero el schema real de `ActivityLog` (líneas 348-362 de schema.prisma) tiene:
- Campo `action` (no `type`), enum `ActivityAction` con valor `state_changed`.
- Campo `details: Json?` que en `computeBurnup` se inspecciona como `details.newValue === "done"` (línea 161 de cycle/service.ts).

Por lo tanto, `newState = "done"` se traduce a `details->>'newValue' = 'done'` en SQL, o post-filtro en memoria sobre `details.newValue` cuando se cargan los logs.

**Algoritmo (anti N+1, REQ-INBOX-CYCLE-004 + REQ-CYCLE-LEAD-TIME-002):**

```ts
export async function computeAvgLeadDays(cycleId: string): Promise<number | null> {
  // 1. Cargar todos los issues del ciclo (id + createdAt). Si vacío → null.
  const issues = await prisma.issue.findMany({
    where: { cycleId },
    select: { id: true, createdAt: true },
  });
  if (issues.length === 0) return null;

  // 2. Una sola query batch: todos los activityLogs state_changed → done para esos issueIds.
  //    Filtrar newValue en memoria (más simple que JSONB query y suficientemente performante).
  const logs = await prisma.activityLog.findMany({
    where: {
      issueId: { in: issues.map((i) => i.id) },
      action: "state_changed",
    },
    select: { issueId: true, createdAt: true, details: true },
  });

  // 3. Agrupar el último (más reciente) state_changed → done por issue.
  const lastDoneByIssue = new Map<string, Date>();
  for (const log of logs) {
    const det = log.details as { newValue?: string } | null;
    if (det?.newValue !== "done") continue;
    const prev = lastDoneByIssue.get(log.issueId);
    if (!prev || log.createdAt > prev) lastDoneByIssue.set(log.issueId, log.createdAt);
  }

  // 4. Promediar deltas en días decimales sobre los issues con evento (excluye los que no).
  const ONE_DAY_MS = 86_400_000;
  const deltas: number[] = [];
  for (const issue of issues) {
    const doneAt = lastDoneByIssue.get(issue.id);
    if (!doneAt) continue;                                    // exclude (REQ-CYCLE-LEAD-TIME-001 MUST NOT)
    deltas.push((doneAt.getTime() - issue.createdAt.getTime()) / ONE_DAY_MS);
  }
  if (deltas.length === 0) return null;
  return deltas.reduce((s, d) => s + d, 0) / deltas.length;
}
```

**Edge handling resumido:**
- 0 issues en el cycle → `null` sin emitir query a `activityLogs` (early return).
- N issues, 0 con evento `state_changed → done` → `null`.
- Issue con `done_at - createdAt = 0` → `0.0` (no `null`). Se contabiliza, retorna 0 si es el único.
- Mixed (algunos con, algunos sin evento) → promedio sobre los que tienen.

### 3.2 `resolveActiveCycleForWorkspace` (cycle service)

**Ubicación:** `packages/api/src/modules/cycle/service.ts`.

**Signatura:**
```ts
export async function resolveActiveCycleForWorkspace(workspaceId: string): Promise<{
  cycle: { id: string; name: string; startDate: Date; endDate: Date; projectId: string };
  projectName: string;
  multipleActiveProjects: boolean;
} | null>;
```

**Algoritmo (REQ-INBOX-CYCLE-001):**

```ts
export async function resolveActiveCycleForWorkspace(workspaceId: string) {
  // 1. Una query: todos los cycles activos del workspace, joined con project (name).
  const activeCycles = await prisma.cycle.findMany({
    where: {
      state: "active",
      project: { workspaceId, archived: false },
    },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],            // tiebreaker lexicographic id
    select: {
      id: true, name: true, startDate: true, endDate: true, projectId: true,
      project: { select: { name: true } },
    },
  });

  if (activeCycles.length === 0) return null;

  // 2. Distintos projectId entre los activos → flag multipleActiveProjects.
  const distinctProjects = new Set(activeCycles.map((c) => c.projectId));
  const winner = activeCycles[0]!;
  return {
    cycle: { id: winner.id, name: winner.name, startDate: winner.startDate,
             endDate: winner.endDate, projectId: winner.projectId },
    projectName: winner.project.name,
    multipleActiveProjects: distinctProjects.size > 1,
  };
}
```

**Por qué una sola query**: O(N) cycles activos por workspace (típicamente 1-5). El `ORDER BY startDate DESC, id ASC` resuelve el tie-breaker (REQ-INBOX-CYCLE-001 menor id lexicográfico) en SQL — sin pasada extra en memoria.

### 3.3 Mention parser (NEW module)

**Ubicación:** `packages/api/src/modules/mentions/service.ts` (módulo nuevo). Razón: es shared entre Comment y Issue services (no duplicar). Module scope: solo el parser + helpers, sin rutas propias (las rutas están integradas en comment/issue/dashboard).

**Signatura principal:**

```ts
export async function parseAndUpsertMentions(args: {
  workspaceId: string;
  issueId: string;
  commentId: string | null;            // null si la fuente es Issue.description
  body: string;                         // texto completo a parsear
  authorMemberId: string;               // mentionedByMemberId
  tx?: Prisma.TransactionClient;        // permite participar en una outer tx
}): Promise<void>;
```

**Algoritmo:**

```ts
const MENTION_REGEX = /@(\w+)/g;

export async function parseAndUpsertMentions(args: {
  workspaceId: string;
  issueId: string;
  commentId: string | null;
  body: string;
  authorMemberId: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const client = args.tx ?? prisma;

  // 1. Extraer candidatos únicos del texto (preserva orden de primera aparición).
  const matches = Array.from(args.body.matchAll(MENTION_REGEX));
  const uniqueUsernames = [...new Set(matches.map((m) => m[1]!))];

  // 2. Resolver username → memberId dentro del workspace (case-sensitive, REQ-MENTION-002).
  //    Si uniqueUsernames vacío, saltar query.
  const resolved = uniqueUsernames.length === 0 ? [] : await client.member.findMany({
    where: { workspaceId: args.workspaceId, username: { in: uniqueUsernames } },
    select: { id: true, username: true },
  });

  // 3. Excluir auto-menciones (REQ-MENTION-005).
  const targets = resolved.filter((m) => m.id !== args.authorMemberId);

  // 4. Snippet de contexto para cada target (substring centrado en la primera mención).
  const buildContext = (username: string): string => {
    const idx = args.body.indexOf(`@${username}`);
    const start = Math.max(0, idx - 30);
    const end = Math.min(args.body.length, idx + username.length + 1 + 60);
    return args.body.slice(start, end).trim();
  };

  // 5. Idempotencia + actualización: borrar previas (de la misma source) y reinsertar.
  //    Para comentarios: unique (commentId, mentionedMemberId) ya impide duplicados,
  //    PERO la spec REQ-MENTION-003 también pide eliminar menciones que ya no están
  //    en el nuevo body. Estrategia simple y atómica: DELETE all + INSERT all dentro de tx.
  if (args.commentId !== null) {
    await client.mention.deleteMany({ where: { commentId: args.commentId } });
  } else {
    // Description-mode: identificada por (issueId, commentId IS NULL).
    await client.mention.deleteMany({ where: { issueId: args.issueId, commentId: null } });
  }

  if (targets.length === 0) return;
  await client.mention.createMany({
    data: targets.map((t) => ({
      workspaceId: args.workspaceId,
      issueId: args.issueId,
      commentId: args.commentId,
      mentionedMemberId: t.id,
      mentionedByMemberId: args.authorMemberId,
      context: buildContext(t.username),
    })),
  });
}
```

**Call sites (todos best-effort dentro de `try/catch` para no romper la mutación principal — patrón ya usado por `recordCycleScopeEvent`):**

| Service file | Function | Cuándo invocar | `commentId` |
|---|---|---|---|
| `comment/service.ts` | `createComment` | después de `prisma.comment.create` | `comment.id` |
| `comment/service.ts` | `updateComment` (NEW) | después de `prisma.comment.update` cuando `body` cambia | `comment.id` |
| `issue/service.ts` | `createIssue` | después de `prisma.issue.create` cuando `description` no es null/empty | `null` |
| `issue/service.ts` | `updateIssue` | después de `prisma.issue.update` cuando `body.description !== undefined` | `null` |

**Dependencia bloqueante:** `updateComment` NO existe hoy en el codebase (solo `createComment` y `listComments` en `packages/api/src/modules/comment/service.ts`). REQ-MENTION-003 scenario 1 requiere actualizar un comment existente. **Decisión técnica:** Este change INCLUYE la creación de:

- `commentService.updateComment(commentId, body, memberId)` — Prisma update + activityLog `edited` + parseAndUpsertMentions.
- `PATCH /api/comments/:id` (route con Zod body `{ body: string }` y `requireIssueRole("key", "member")` adaptado para que comments también validen pertenencia).

Si el equipo prefiere posponer `updateComment` a un cycle separado, REQ-MENTION-003 scenario 2 (eliminar mention al editar) queda parcialmente cubierto solo para comentarios nuevos — flagged como risk en §6.

**Update edge case (REQ-MENTION-003 scenario 2):** la estrategia "delete all + insert all dentro de la misma tx" cubre el requisito automáticamente: cuando un comment se reedita sin la `@alice`, alice deja de aparecer porque el delete sweep la quita y el insert sweep no la incluye. Atomicidad garantizada pasando `tx` desde el caller cuando se quiere participar en una transacción mayor (por ejemplo, dentro del `updateComment` que también escribe activityLog).

### 3.4 Dashboard route extension

**Ubicación:** `packages/api/src/modules/dashboard/routes.ts`.

**Current handler signature** (línea 25-32):
```ts
app.get("/:id/dashboard", { preHandler: [requireMember("id")], schema: { params: WorkspaceIdParam } },
  async (request) => { /* ... */ });
```

**New handler steps** (manteniendo el patrón `Promise.all` actual):

```ts
async (request) => {
  const workspaceId = request.params.id;
  const member = await prisma.member.findFirst({
    where: { workspaceId, userId: request.user.userId },
    select: { id: true },
  });
  const projects = await prisma.project.findMany({ where: { workspaceId, archived: false }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const [
    open, inProgress, awaitingReview, activeAgents, assignedRaw, proposalsRaw, agentSessionsRaw,
    activeCycleResult,                                                          // NEW
    mentionsRaw,                                                                // NEW
  ] = await Promise.all([
    /* ...existing 7 queries... */,
    resolveActiveCycleForWorkspace(workspaceId),                                // NEW
    member
      ? prisma.mention.findMany({
          where: { workspaceId, mentionedMemberId: member.id },                 // REQ-API-DASHBOARD-004 isolation
          orderBy: { createdAt: "desc" },
          take: 20,                                                              // cap payload
          include: {
            issue: { select: { key: true, title: true } },
            mentionedByMember: { select: { username: true } },
          },
        })
      : [],                                                                      // NEW
  ]);

  // Compose ActiveCycleKPIs (only if activeCycleResult !== null)
  let activeCycle: ActiveCycleKPIs | null = null;
  if (activeCycleResult) {
    const cycleDetail = await getCycle(activeCycleResult.cycle.id);              // reuse existing
    const avgLeadDays = await computeAvgLeadDays(activeCycleResult.cycle.id);    // NEW
    const donePct = cycleDetail.scope > 0
      ? Math.round((cycleDetail.completed / cycleDetail.scope) * 100) : 0;
    activeCycle = {
      id: cycleDetail.id,
      name: cycleDetail.name,
      projectName: activeCycleResult.projectName,
      startDate: cycleDetail.startDate.toISOString(),
      endDate: cycleDetail.endDate.toISOString(),
      completed: cycleDetail.completed,
      scope: cycleDetail.scope,
      donePct,
      velocity: cycleDetail.velocity ?? 0,                                        // null en cycles upcoming
      avgLeadDays,
      burnup: cycleDetail.burnup,
    };
  }

  return {
    counts: { openIssues: open, inProgress, awaitingReview, activeAgents },
    assigned: assignedRaw,
    mentions: mentionsRaw.map((m) => ({                                           // shape per REQ-MENTION-007
      id: m.id,
      issueKey: m.issue.key,
      issueTitle: m.issue.title,
      commentId: m.commentId,
      mentionedByUsername: m.mentionedByMember.username,
      context: m.context,
      createdAt: m.createdAt.toISOString(),
    })),
    proposals: proposalsRaw,
    agents: agentSessionsRaw.map(/* unchanged */),
    activeCycle,
    multipleActiveProjects: activeCycleResult?.multipleActiveProjects ?? false,
  };
}
```

**Performance:**
- N+1 risk evaluado: `getCycle` ya hace JOINs internos para issues y burnup (1 query). `computeAvgLeadDays` añade 2 queries (issues + activityLogs batch). Mention query añade 1 (con JOINs). Total nuevo: ~4 queries adicionales en el handler. Comparado con las 7 queries actuales en `Promise.all`, pasamos de ~7 a ~11. Aceptable.
- **Optimización opcional (NO en este change):** `resolveActiveCycleForWorkspace` y `getCycle` podrían fusionarse en una sola query custom; queda como follow-up si las métricas muestran latency > 200ms.
- **Payload size estimate:** `activeCycle` ~250 bytes (sin burnup) + `burnup[14 floats]` ~150 bytes = ~400 bytes. `mentions[20]` con context promedio 80 chars + metadata ~200 bytes/item = ~4KB. Total adicional al payload: ~4.5KB. La response actual ronda ~10-15KB con assigned + proposals + agents. Total nuevo ~15-20KB. Bajo el threshold de 50KB del proposal — no se requiere split.

---

## 4. Frontend design

### 4.1 CurrentCycleCard (KAN-27, REQ-INBOX-CYCLE-005..007)

**Ubicación:** `packages/web/src/features/inbox/current-cycle-card.tsx`.

**Signatura del componente:**

```ts
import type { ActiveCycleKPIs } from "@kanon/bridge";

interface CurrentCycleCardProps {
  activeCycle: ActiveCycleKPIs | null;
  multipleActiveProjects: boolean;
}

export function CurrentCycleCard(props: CurrentCycleCardProps): JSX.Element;
```

**Subcomponente `Sparkline`:** componente local privado (no exportado), inline. Renders `<svg viewBox="0 0 280 36">` con un single `<path>` monotone smooth area. Props:

```ts
interface SparklineProps { values: number[]; "data-testid"?: string }
function Sparkline({ values, ...rest }: SparklineProps): JSX.Element;
```

Algoritmo: normaliza `values` a [0, 36] vertical y [0, 280] horizontal, genera path `M x0,y0 L x1,y1 …` + `L 280,36 L 0,36 Z` para cerrar el área. Stroke `var(--accent)`, fill `var(--accent-2)` con opacity. NO librería externa (no recharts aquí — overkill para 14 puntos).

**Estados visibles:**

| Condición | Render | testid |
|---|---|---|
| `activeCycle === null` | Empty state: texto "No active cycle" | `current-cycle-empty` |
| `activeCycle != null`, sin issues elegibles para lead | Sparkline + Done% + `—` (avg lead) + velocity | `current-cycle-card` |
| `activeCycle != null`, normal | Sparkline + Done% + `Xd` (avg lead) + `+N` velocity | `current-cycle-card` |

**Subtitle logic:**
- Always: `{cycleName} · {format(startDate)} – {format(endDate)}`
- If `multipleActiveProjects === true`: append ` ({projectName})` (REQ-INBOX-CYCLE-006).
- Subtitle element tiene `data-testid="cycle-subtitle"`.

**Rendering rules específicas (cubren scenarios de specs):**
- `data-testid="sparkline"` en el `<svg>`.
- `data-testid="done-pct-value"` en span con texto `"{donePct}%"`.
- `data-testid="avg-lead-value"` en span con texto `"{avgLeadDays.toFixed(1)}d"` o `"—"` cuando null (REQ-INBOX-CYCLE-005 scenario 2).
- `data-testid="velocity-value"` en span con texto `velocity > 0 ? "+{velocity}" : "{velocity}"`.

**Data flow:** Lee directamente de `useDashboardQuery(workspaceId).data`. No emite request adicional (REQ-INBOX-CYCLE-007). El parent (`InboxView`) pasa `activeCycle={data?.activeCycle ?? null}` y `multipleActiveProjects={data?.multipleActiveProjects ?? false}`.

**Loading state:** cuando `useDashboardQuery` está cargando, el parent renderiza `<RailCard title="Current cycle"><Skeleton ... /></RailCard>`. Skeleton es shape simple (3 barras gris tabular-nums) — reutiliza patrón de `Stat` component (líneas 226-267 de inbox-view.tsx), o usa CSS `background: var(--bg-3); animation: pulse`.

### 4.2 MentionRow + Mentions section (KAN-29)

**Ubicación:** `packages/web/src/features/inbox/mention-row.tsx`.

**Decisión: net-new component (NO reuse `InboxRow`)**. Justificación: `InboxRow` actual (líneas 320-364 de inbox-view.tsx) toma `{ issue: Issue; onOpen }` y muestra `TypeGlyph + key + title + StatePip`. La mention row necesita mostrar `mentionedByUsername` + `context snippet` + `issueTitle` — un layout suficientemente distinto que forzar reuse genera más props condicionales que código nuevo. Ambos pueden coexistir en `inbox-view.tsx`.

**Signatura:**

```ts
import type { MentionDashboardItem } from "@kanon/bridge";

interface MentionRowProps {
  mention: MentionDashboardItem;
  onOpen: (mention: MentionDashboardItem) => void;
}

export function MentionRow(props: MentionRowProps): JSX.Element;
```

**Render** (REQ-MENTION-008): button con click → `onOpen(mention)`. Layout horizontal:
- `<Avatar initials={avatarInitials(mention.mentionedByUsername)} />`
- `<span>{mention.mentionedByUsername}</span>`
- `<span style={{ flex: 1 }}>{mention.context}</span>` (truncate via CSS)
- `<span className="mono">{mention.issueTitle}</span>` (right-aligned, ellipsis)

**Navigation target:**

```ts
const onOpen = (mention: MentionDashboardItem) => {
  void navigate({
    to: "/issue/$key",
    params: { key: mention.issueKey },
    search: mention.commentId !== null
      ? { from: "inbox", highlight: "mention", commentId: mention.commentId }
      : { from: "inbox", highlight: "mention" },
  });
};
```

Notar: cuando `commentId === null` (description mention), el search NO incluye `commentId` (REQ-MENTION-008 scenario 3). El issue detail entonces solo aplica highlight a la description (no a un comment específico).

**Section render** en `inbox-view.tsx`: reemplazar el bloque actual de "Mentions placeholder" (líneas 157-160) por:

```tsx
<Section title="Mentions" hint={data?.mentions?.length ? `${data.mentions.length}` : undefined}>
  {(data?.mentions ?? []).length === 0 ? (
    <EmptyHint>No mentions.</EmptyHint>
  ) : (
    (data?.mentions ?? []).map((m) => (
      <MentionRow key={m.id} mention={m} onOpen={handleOpenMention} />
    ))
  )}
</Section>
```

### 4.3 Issue detail right-pane sidebar enhancement (KAN-29 follow-up)

**Ubicación:** `packages/web/src/routes/_authenticated/issue.tsx`.

**Current layout** (línea ~440 inferred): el route component renderiza un grid `1fr 380px`. El right pane (líneas 549-593) tiene siempre `Properties + AgentThread`.

**Search params extension (REQ-MENTION-009):**

```ts
interface IssueRouteSearch {
  from?: string;
  highlight?: "mention";                // NEW (literal type, evita strings random)
  commentId?: string;                   // NEW (uuid as string, validar opcional)
}

validateSearch: (search) => ({
  from: typeof search.from === "string" ? search.from : undefined,
  highlight: search.highlight === "mention" ? "mention" as const : undefined,
  commentId: typeof search.commentId === "string" ? search.commentId : undefined,
}),
```

**Behavior matrix (REQ-MENTION-010):**

| AgentThread tiene mensajes? | URL `highlight=mention&commentId`? | Right pane render |
|---|---|---|
| Yes | No | AgentThread (current behavior) |
| Yes | Yes | AgentThread + scroll-to + highlight del comment cuyo `id === commentId` |
| No | No | AgentThread (empty state, current behavior) |
| No | Yes (con commentId) | **CommentList (NEW behavior)** + scroll-to + highlight del comment |
| No | Yes (sin commentId, mention en description) | AgentThread (empty state) — el highlight del description ya está visible en el main pane |

**Implementación:**

1. En `IssuePage` (después de las queries existentes):
   ```ts
   const { highlight, commentId } = issueRoute.useSearch();
   const allComments = comments ?? [];
   const agentComments = allComments.filter((c) => AGENT_SOURCES.has(c.source));
   const showCommentsInsteadOfThread =
     highlight === "mention" && commentId && agentComments.length === 0;
   ```

2. En el right pane, condicional:
   ```tsx
   {showCommentsInsteadOfThread ? (
     <CommentsHighlightView
       comments={allComments}
       highlightCommentId={commentId}
       data-testid="comments-list"
     />
   ) : (
     <AgentThread
       comments={allComments}
       isLoading={commentsLoading}
       highlightCommentId={highlight === "mention" ? commentId : undefined}
       data-testid="agent-thread"
     />
   )}
   ```

3. **`CommentsHighlightView` (NEW)** — small component co-located in issue.tsx (or `packages/web/src/features/issue-detail/comments-highlight-view.tsx`):
   - Renders all comments (read-only).
   - On mount, finds element with `data-comment-id={highlightCommentId}` and calls `.scrollIntoView({ block: "center", behavior: "auto" })` and toggles `data-highlighted="true"` for 1000ms.
   - If `highlightCommentId` no matches any comment, renders the list normalmente sin highlight (REQ-MENTION-009 scenario 2: no console errors).

4. **AgentThread highlight injection** — el `AgentMessage` interno (líneas 143-209 de agent-thread.tsx) recibe el `comment` y se renderiza envuelto en `<div data-comment-id={comment.id} data-highlighted={...}>`. Lógica idéntica de scroll-to + 1s pulse.

**Highlight visual:** CSS inline simple — sin librerías. `data-highlighted="true"` aplica `box-shadow: 0 0 0 2px var(--accent), inset 0 0 0 1px var(--accent); transition: box-shadow 1s`. Después de 1000ms via `setTimeout`, se setea `data-highlighted="false"` y el box-shadow desaparece.

### 4.4 Quick actions card update (KAN-28)

**Ubicación:** modificar `packages/web/src/features/inbox/inbox-view.tsx` (sección `Quick actions` líneas 192-211).

**Orden final de filas (REQ-INBOX-QUICK-005):**

```tsx
<RailCard title="Quick actions">
  <QuickRow icon={<Icon.Plus />} label="New issue" kbd="C" onClick={…} data-testid="quick-action-row" data-action="new-issue" />
  <QuickRow icon={<Icon.Spark style={{ color: "var(--ai)" }} />} label="Ask Kanon" kbd="⌘J" onClick={() => openPalette("ai")} data-testid="quick-action-row" data-action="ask-kanon" />
  <ProjectPickerPopover
    projects={projects}
    onSelect={(projectKey) => navigate({ to: "/dependencies/$projectKey", params: { projectKey } })}
    data-testid="quick-dep-graph"
  >
    {(open, disabled) => (
      <QuickRow icon={<Icon.Graph />} label="Open dependency graph" onClick={open} aria-disabled={disabled} data-testid="quick-action-row" data-action="dep-graph" />
    )}
  </ProjectPickerPopover>
  <ProjectPickerPopover
    projects={projects}
    onSelect={(projectKey) => navigate({ to: "/cycles/$projectKey", params: { projectKey } })}
    data-testid="quick-plan-cycle"
  >
    {(open, disabled) => (
      <QuickRow icon={<Icon.Road style={{ color: "var(--ai)" }} />} label="Plan next cycle" onClick={open} aria-disabled={disabled} data-testid="quick-action-row" data-action="plan-cycle" />
    )}
  </ProjectPickerPopover>
</RailCard>
```

**Search → "Search…" row (kbd `⌘K`)**: la fila actual existe entre Ask Kanon y las nuevas. **Decisión técnica:** la spec (REQ-INBOX-QUICK-005) lista 4 filas. La fila Search existente (línea 205-210 de inbox-view.tsx) NO está en la spec. Mantenerla rompería el orden requerido. **Resolución:** REMOVER la fila "Search" del Quick Actions (sigue accesible vía `⌘K` y la lupa del topbar). Si el usuario rechaza esta interpretación, el spec necesita un addendum — flagged como SUGGESTION en §6.

**Icons confirmados:** `Icon.Graph` y `Icon.Road` ya existen en `packages/web/src/components/ui/icons.tsx` (líneas 27-34 y 42-44). Cero net-new icons.

**`ProjectPickerPopover`:** componente nuevo en `packages/web/src/features/inbox/project-picker-popover.tsx`.

```ts
interface Project { key: string; name: string; }

interface ProjectPickerPopoverProps {
  projects: Project[];                                // active projects (no archived)
  onSelect: (projectKey: string) => void;
  children: (open: () => void, disabled: boolean) => React.ReactNode;
  "data-testid"?: string;
}

export function ProjectPickerPopover(props: ProjectPickerPopoverProps): JSX.Element;
```

**Behavior (REQ-INBOX-QUICK-003 + REQ-INBOX-QUICK-004):**
- `projects.length === 0` → `disabled = true`. El `children(open, true)` recibe disabled flag; el QuickRow renderiza con `aria-disabled` y tooltip `title="No active project"`. `open()` es no-op.
- `projects.length === 1` → cuando se llama `open()`, invoca `onSelect(projects[0].key)` directamente. NO se monta popover en DOM.
- `projects.length >= 2` → `open()` setea `isOpen=true`; renderiza `<div role="menu">` con un button por proyecto. Click en button → `onSelect(key)` + cierra.

**Source de `projects` en `InboxView`:** ya está disponible vía `useProjectsQuery(workspaceId)` (`packages/web/src/hooks/use-projects-query.ts`). El componente filtra por `archived === false`. Project type incluye `key` y `name` (verified en `packages/web/src/types/project.ts` — implícito).

### 4.5 Command palette AI mode honest navigations

**Ubicación:** `packages/web/src/components/command-palette.tsx` líneas 78-84.

**Current (líneas 80-84):**
```ts
[
  { id: "ai-plan",     label: "Plan the next cycle", sub: "...", onSelect: onClose },
  { id: "ai-blockers", label: "Find issues blocking the cycle", sub: "...", onSelect: onClose },
  { id: "ai-digest",   label: "Draft a digest for #standup",    sub: "...", onSelect: onClose },
]
```

**New (cada `onSelect` navega + cierra; orden: navigate → onClose):**

```ts
const projects = useProjectsQuery(workspaceId).data ?? [];
const firstActiveProjectKey = projects.find((p) => !p.archived)?.key;

[
  {
    id: "ai-plan",
    label: "Plan the next cycle",
    sub: "based on velocity, capacity, and dependency graph",
    onSelect: () => {
      // TODO(KAN-50): swap navigation for MCP roundtrip when wiring lands
      if (firstActiveProjectKey) {
        void navigate({ to: "/cycles/$projectKey", params: { projectKey: firstActiveProjectKey } });
      } else {
        void navigate({ to: "/inbox" });          // fallback honesto
      }
      onClose();
    },
  },
  {
    id: "ai-blockers",
    label: "Find issues blocking the cycle",
    sub: "scan deps for stuck items",
    onSelect: () => {
      // TODO(KAN-50): swap navigation for MCP roundtrip when wiring lands
      void navigate({ to: "/inbox", search: { blocked: true } });
      onClose();
    },
  },
  {
    id: "ai-digest",
    label: "Draft a digest for #standup",
    sub: "last 24h activity",
    onSelect: () => {
      // TODO(KAN-50): swap navigation for MCP roundtrip when wiring lands
      void navigate({ to: "/inbox" });
      onClose();
    },
  },
]
```

**Decisión sobre "Find blockers" → `?blocked=true`:**
- **No existe filtro** `blocked=true` en la ruta `/board/$projectKey` ni en `/inbox` actualmente (verified en exploration: rutas no documentan ese search param).
- **Resolución pragmática:** el Inbox `/inbox` route acepta `blocked=true` como search param **opcional** (sin uso por ahora — REQ-PALETTE-AI-002 acepta esto explícitamente: "Inbox o dashboard según lo que exista"). El handler del Inbox puede ignorarlo en este change y honrar la nav. Cuando KAN-50 cablee MCP, ese search param se interpretará realmente. La spec se cumple porque **navega** (no `onClose` solo) y deja el `// TODO(KAN-50)`.
- Validar que la ruta `/inbox` tenga `validateSearch` que acepte `blocked` opcional sin lanzar (revisar antes de apply).

**`projectKey` resolution:** identical pattern al QuickRow `Open dependency graph` — usa `useProjectsQuery(workspaceId)`.

### 4.6 AgentThread copy change (REQ-AGENT-THREAD-001)

**Ubicación:** `packages/web/src/features/issue-detail/agent-thread.tsx` líneas 119-136 (el bloque del input disabled).

**Cambios exactos:**

| Elemento | Antes | Después |
|---|---|---|
| `div title=` (línea 120) | `"Direct prompts to agents arrive in Phase 3"` | `"View only — agents act via MCP. See KAN-50 for upcoming Ask Kanon roundtrip."` |
| `input placeholder=` (línea 124) | `"Direct the agent… (coming soon)"` | `"View only · agents act via MCP"` |
| `input disabled` | (presente) | (presente, sin cambio) |

Adicionalmente, agregar `data-testid="agent-thread-input"` al `<input>` para que los tests puedan localizarlo deterministically.

**Snapshot tests afectados:** cualquier snapshot existente de `AgentThread` necesita regeneración (`pnpm vitest -u`). El test de spec REQ-AGENT-THREAD-001 scenario 2 ya prevé el `-u` flow — al regenerarse, el nuevo snapshot DEBE contener `"View only · agents act via MCP"`.

---

## 5. Open API surface (appendix table for sdd-tasks)

| Layer | Symbol / Path | Signature / Shape | Status |
|---|---|---|---|
| Prisma | `Mention` | model con id, workspaceId, issueId, commentId?, mentionedMemberId, mentionedByMemberId, context, read, createdAt | NEW |
| Prisma migration | `<ts>_add_mention/migration.sql` | CREATE TABLE mentions + 3 indexes + 4 FKs | NEW |
| Bridge schema | `activeCycleKPIsSchema` | Zod object (id, name, projectName, dates, scope, completed, donePct, velocity, avgLeadDays, burnup) | NEW |
| Bridge schema | `mentionDashboardItemSchema` | Zod object (id, issueKey, issueTitle, commentId, mentionedByUsername, context, createdAt) | NEW |
| Bridge schema | `dashboardResponseSchema` | Zod composite con activeCycle + mentions + multipleActiveProjects | NEW |
| Bridge type | `ActiveCycleKPIs`, `MentionDashboardItem`, `DashboardData` | `z.infer<typeof …>` exports | NEW |
| Bridge file | `packages/bridge/src/dashboard.ts` | new file, exported from index.ts | NEW |
| API helper | `cycle/service.ts → computeAvgLeadDays(cycleId): Promise<number \| null>` | exported | NEW |
| API helper | `cycle/service.ts → resolveActiveCycleForWorkspace(workspaceId)` | returns `{ cycle, projectName, multipleActiveProjects } \| null` | NEW |
| API module | `mentions/service.ts → parseAndUpsertMentions(args)` | exported, accepts optional `tx` | NEW |
| API service | `comment/service.ts → updateComment(commentId, body, memberId)` | NEW (required for REQ-MENTION-003 update flow) | NEW |
| API route | `PATCH /api/comments/:id` body `{ body: string }` | NEW | NEW |
| API route | `GET /api/workspaces/:id/dashboard` | extended response (activeCycle, mentions, multipleActiveProjects) | MODIFIED |
| API integration | `comment/service.ts → createComment` | call parseAndUpsertMentions after create | MODIFIED |
| API integration | `issue/service.ts → createIssue` | call parseAndUpsertMentions if description present | MODIFIED |
| API integration | `issue/service.ts → updateIssue` | call parseAndUpsertMentions if `body.description` set | MODIFIED |
| Web hook | `use-dashboard-query.ts → DashboardData` | shape derived from bridge | MODIFIED |
| Web component | `inbox/current-cycle-card.tsx` | `(props: CurrentCycleCardProps) => JSX.Element` | NEW |
| Web component | `inbox/mention-row.tsx` | `(props: MentionRowProps) => JSX.Element` | NEW |
| Web component | `inbox/project-picker-popover.tsx` | render-prop component, short-circuit + disabled | NEW |
| Web component | `issue-detail/comments-highlight-view.tsx` | scroll + highlight comment by id | NEW (or inline in issue.tsx) |
| Web component | `inbox/inbox-view.tsx` | add CurrentCycleCard, MentionRow rendering, 2 quickrows, remove Search row | MODIFIED |
| Web component | `issue-detail/agent-thread.tsx` | placeholder + title copy + testid | MODIFIED |
| Web route | `routes/_authenticated/issue.tsx` | validateSearch extends with `highlight`, `commentId`; conditional right pane | MODIFIED |
| Web component | `command-palette.tsx` | 3 AI mode actions: navigate + onClose with `// TODO(KAN-50)` comments | MODIFIED |

---

## 6. Risk mitigations (technical)

| Risk (proposal) | Code-level mitigation |
|---|---|
| Lead time N+1 over activityLogs | One batch `prisma.activityLog.findMany({ where: { issueId: { in: ids }, action: "state_changed" } })` then in-memory groupBy lastDoneByIssue Map. Verified in §3.1 algorithm. Test asserts log count = 1 for cycles with N issues (REQ-INBOX-CYCLE-004 scenario 1). |
| Dashboard payload size > 50KB | Estimated ~15-20KB total in §3.4. Mention query capped at 20 items (`take: 20`). Burnup is ~14 floats. NO split needed in this change. If real-world metrics ever exceed 50KB, follow-up: separate burnup to `GET /api/cycles/:id/burnup` (out of scope here). |
| Mention parser idempotency on resave | Strategy: `DELETE WHERE commentId = ? OR (issueId, commentId IS NULL)` then `INSERT createMany` inside the same transaction (or with `tx` arg). Re-saving same body produces same final state. Unique constraint `(commentId, mentionedMemberId)` is belt-and-braces — protects against race conditions. |
| Mention parser update-removes-existing | Same delete-then-insert strategy automatically handles removal. REQ-MENTION-003 scenario 2 covered: when body no longer contains `@alice`, the delete sweep removes alice's row, the insert sweep doesn't recreate it. |
| ProjectPickerPopover with 0 projects | `disabled` flag forwarded via render-prop. `aria-disabled="true"` + `title="No active project"` on QuickRow. `open()` is no-op. Specs REQ-INBOX-QUICK-004 scenarios verified. |
| Multi-tenant isolation of mentions | `Mention.workspaceId` is required (FK to Workspace). Dashboard query: `WHERE workspaceId = request.params.id AND mentionedMemberId = member.id`. Test: alice in W1 + W2 calls `/api/workspaces/W1/dashboard`, asserts no W2 mentions in response (REQ-API-DASHBOARD-004 scenario 2). |
| Schema field name mismatch (spec vs Prisma) | Spec REQ-CYCLE-LEAD-TIME-001 uses `type` and `newState` — translated in §3.1 to real fields `action` (enum) and `details->>'newValue'`. Implementation matches `computeBurnup` precedent (line 161 of cycle/service.ts). |
| `updateComment` doesn't exist today | Decision §3.3: this change INCLUDES `updateComment` service + `PATCH /api/comments/:id` route. If team rejects, REQ-MENTION-003 scenario 2 partially regresses — flagged as SUGGESTION. |
| `/inbox` route doesn't accept `blocked` search param | Add `blocked: z.boolean().optional()` to inbox route's `validateSearch` (no rendering effect in this change). REQ-PALETTE-AI-002 scenario 1 satisfied because `navigate` is called with the search param. |
| Removing "Search" row from Quick Actions | Spec REQ-INBOX-QUICK-005 lists 4 rows; current code has 3 + Search. Search row removed in §4.4. ⌘K shortcut + topbar lupa keep search reachable. SUGGESTION: confirm with user before apply. |

---

## 7. Test strategy

**API unit tests** (vitest, no DB):
- `cycle/service.test.ts` → `computeAvgLeadDays`: 0 issues → null, 1 issue with event → exact decimal, N issues mixed (some with/without event) → average over those with event, single issue with delta=0 → 0.0.
- `mentions/service.test.ts` → `parseAndUpsertMentions`: regex match correct, case-sensitive resolution, self-mention exclusion, idempotent re-save (no duplicates), update removes obsolete mentions.

**API integration tests** (vitest + test DB or `fastify.inject`):
- `dashboard/routes.test.ts` extension (or new file `dashboard-cycle-c.integration.test.ts`):
  - Workspace with 0 active cycles → `activeCycle: null`.
  - Workspace with 1 active cycle → `activeCycle` populated, `multipleActiveProjects: false`.
  - Workspace with 2 active cycles in different projects → `activeCycle` is the most recent startDate, `multipleActiveProjects: true`.
  - Alice has 3 mentions in W1 → returned. Bob in same W1 → only his mentions.
  - Alice in W1 + W2 → calling W1 returns only W1 mentions.
  - Comment created with `@alice` → 1 Mention row exists, dashboard returns it.
  - Comment updated removing `@alice` → 0 Mention rows after.
- `cycle/service.test.ts` → `resolveActiveCycleForWorkspace`: tiebreaker case (same startDate → lowest id wins).

**Web component tests** (vitest + @testing-library/react):
- `current-cycle-card.test.tsx`: renders sparkline svg, donePct, "—" for null avgLead, projectName when multipleActiveProjects=true, empty state when activeCycle=null.
- `mention-row.test.tsx`: renders username/context/title, click invokes navigate with correct search params (with and without commentId).
- `project-picker-popover.test.tsx`: 0 → disabled, 1 → short-circuit, 2+ → popover opens.
- `inbox-view.test.tsx`: 4 quick action rows in correct order.
- `comments-highlight-view.test.tsx`: scrolls to and highlights the matching commentId; gracefully handles non-existent id; no auto-scroll without `highlight=mention`.

**Snapshot tests** (vitest):
- `agent-thread.test.tsx`: snapshot updated to include `View only · agents act via MCP`.
- `command-palette.test.tsx`: AI mode item snapshot includes the 3 actions with correct labels; spy verifies `navigate` then `onClose` order on each.

**Multi-tenant isolation** (api integration): a dedicated test file `mentions-isolation.integration.test.ts` covers REQ-MENTION-006 + REQ-API-DASHBOARD-004 — alice with mentions in 2 workspaces sees only the right ones per request.

**Strict TDD MODE ACTIVE**: every test above MUST be written BEFORE the implementation per the standards. The sdd-tasks phase will sequence tasks as `(test) → (impl)` pairs.

---

## 8. Out of design (deferred to apply phase)

- Exact CSS values for sparkline area opacity, hover transitions, Tailwind class names (use existing `--accent`, `--accent-2`, `--ai`, `--bg-3` tokens from the design system).
- Skeleton states' visual exact look — apply phase reuses existing pattern (e.g., the `Stat` placeholder shape from inbox-view.tsx or a generic `<Skeleton />` if one exists).
- Error boundary placement — apply phase uses existing `<ErrorBoundary />` patterns at the route level (no need to add new ones).
- Unread badge UI for mentions (`Mention.read = true` toggle) — explicitly out of scope per proposal.
- Animation library evaluation for highlight pulse — design uses inline CSS `transition: box-shadow 1s` (no new dep needed).
- Real KAN-50 issue creation — orchestrator handles via kanon-roadmap-hooks, NOT this change.

---

**Source artifacts**: `openspec/changes/inbox-redesign-cycle-c/proposal.md` + `specs/added/*.md` + `specs/modified/*.md` + engram `sdd/inbox-redesign-cycle-c/decisions`.

**Next**: `sdd-tasks` (after sdd-spec ack — spec already complete in parallel).
