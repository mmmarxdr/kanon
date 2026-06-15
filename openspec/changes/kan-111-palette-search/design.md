# Design: KAN-111 — Server-backed command palette search + filters

> Technical design (the HOW). Scope, endpoint choice, no-migration, hybrid UX,
> debounce, and shared-as-source-of-truth are LOCKED by the proposal/ADR. This
> document decides the concrete shapes, query strategy, component decomposition,
> test seams, and PR slicing. Every contract below is grounded in real
> `file:line` from the worktree `/home/marcd/workspace/kanon-kan111`.

## 1. Architecture overview

Three layers, additive at every layer. The list endpoint
(`GET /api/projects/:key/issues`) is the single backend surface; no new route,
no Prisma migration.

```
┌─ web ────────────────────────────────────────────────────────────────────┐
│ CommandPalette                                                              │
│  ├─ useActiveProjectKey()   ← route pathname (useLocation), no project = ok │
│  ├─ parseSearchTokens(raw)  ← pure fn: tokens → IssueFilters + free-text q  │
│  ├─ PaletteFilterBar        ← chips (FilterChipSelect) ⇄ same IssueFilters  │
│  └─ useIssueSearchQuery(projectKey, q, filters)                             │
│         ├─ debounce ~200ms (q + filters)                                    │
│         ├─ enabled: !!projectKey && (q || hasActiveFilter)                  │
│         └─ fetchApiValidated(url, issueListSchema)  ← Zod boundary          │
└────────────────────────────────────────┬───────────────────────────────────┘
                                          │ GET /api/projects/:key/issues?q=…&document_kind=adr&state=done…
┌─ api ───────────────────────────────────▼───────────────────────────────────┐
│ routes.ts  schema: querystring = IssueFilterQuery (extended)                 │
│ service.ts listIssues(projectId, filters)                                    │
│   where.OR (q over title+key) + documents.some (presence/kind) + scalars     │
│   findMany include documents:{ select:{kind}, distinct:['kind'] }            │
│   serialize → documentKinds: DocumentKind[]                                  │
└────────────────────────────────────────┬───────────────────────────────────┘
                                          │ Prisma
┌─ db (NO migration) ─────────────────────▼───────────────────────────────────┐
│ Issue 1──* IssueDocument (kind DocumentKind)  — relation already exists      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Shared (`@kanon/shared`) sits across the api↔web boundary: it owns the
`documentKind` enum, the `documentKinds` field on `issueSchema`, and (decision
below) the filter-query Zod schema. **Build `packages/shared` before web tsc.**

## 2. API layer (the HOW)

### 2.1 `q` free-text — Prisma shape and interaction with existing `where`

Today `listIssues` builds a flat `where` object (service.ts:244-277): a base
`{ projectId }` plus optional equality/relation predicates assigned by mutation
(`where.state = …`, `where.key = { in: parsed }`, etc.). All existing predicates
are **implicit-AND** top-level keys.

`q` adds a free-text OR across title + key:

```ts
if (filters.q) {
  const q = filters.q.trim();
  if (q.length > 0) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { key:   { contains: q, mode: "insensitive" } },
    ];
  }
}
```

**Interaction analysis — this is safe with the existing `where`:**

- Prisma combines top-level `where` keys with AND. So `where.OR` (the q match)
  is AND-ed with `projectId`, `state`, `documents.some`, etc. Exactly the
  desired semantics: "issues in this project whose (title OR key) matches q AND
  state=done AND has an ADR".
- **Collision risk with `keys`**: `filters.keys` sets `where.key = { in: [...] }`
  (service.ts:275). `q` does NOT touch `where.key` (it puts the key predicate
  inside `where.OR`), so the two are independent AND-ed clauses. The palette
  never sends `keys` + `q` together, but the predicates do not clash even if a
  future caller does. No `AND`/`OR` nesting needed.
- Empty/whitespace `q` ⇒ no-op (mirrors the existing `keys` empty-after-trim
  guard at service.ts:262-266). Web also gates the request via `enabled`, so an
  empty `q` with no filters never reaches the server.

### 2.2 `documentKinds` per issue — NO N+1 (decision: nested select + distinct)

**Decision: extend the single `findMany` `include` with a distinct-kind nested
`select`. Do NOT use `groupBy`.**

```ts
const issues = await prisma.issue.findMany({
  where,
  orderBy: { createdAt: "desc" },
  include: {
    assignee: { /* unchanged — service.ts:283-289 */ },
    documents: {
      select: { kind: true },
      distinct: ["kind"],   // DB-side de-dupe → at most 4 rows/issue (DocumentKind cardinality)
    },
  },
});
```

Serialization to `DocumentKind[]` in the existing `.map` (service.ts:297-300):

```ts
return issues.map((issue) => {
  const { documents, ...rest } = issue;
  return {
    ...rest,
    activeWorkers: workersMap.get(issue.id) ?? [],
    documentKinds: documents.map((d) => d.kind), // DocumentKind[], already distinct
  };
});
```

**Why nested-select-distinct over `groupBy` — justification:**

1. **Single round-trip, no N+1.** Prisma resolves a relation `include` for a
   `findMany` in one batched query (one `findMany` + one batched relation load),
   exactly like the existing `assignee` include. `groupBy` would be a SECOND
   query keyed by `issueId IN (...)`, then a client-side merge into a Map — more
   code, more latency, and it duplicates the proven batch pattern already used
   for `getActiveWorkersForIssues` (service.ts:293-295). We do not need a second
   batch here because the relation include already fans in.
2. **`distinct: ['kind']` bounds the payload.** DocumentKind has 4 values
   (schema.prisma:65-70), so at most 4 rows per issue cross the wire regardless
   of how many documents an issue has. The current-project scope already bounds
   the issue count.
3. **`groupBy` cannot ride the same `findMany`** — it is a separate aggregation
   call, so it loses the single-query benefit and forces a manual id→kinds Map
   exactly like the workers path. Choosing select+distinct keeps one query.
4. **`select` over full include** — we pull only `kind`, never document
   `body`/`title` (the `body` column is unbounded text, schema.prisma:572), so
   no heavy column is read.

> The existing code returns the full Prisma row spread (`...issue`,
> service.ts:298). After this change we MUST destructure `documents` out of the
> spread (shown above) so the raw relation array does not leak into the response
> alongside the derived `documentKinds`. The response stays additive: same
> fields + `documentKinds`.

### 2.3 Document presence / kind filter

```ts
if (filters.document_kind) {
  where.documents = { some: { kind: filters.document_kind } };
} else if (filters.has_documents) {
  where.documents = { some: {} };
}
```

- `has:adr` (token) maps to `document_kind=adr` on the wire ⇒ `some:{kind:'adr'}`.
- `has:any` / bare `has_documents=true` ⇒ `some:{}` (issue has ≥1 document).
- `document_kind` takes precedence over `has_documents` (a specific kind already
  implies presence). Mirrors the additive, mutate-the-`where` style of the
  existing filters.

### 2.4 `IssueFilterQuery` schema extension (api side or shared — see §4)

Add to the query schema (today `packages/api/src/modules/issue/schema.ts:76-92`):

```ts
q:             z.string().optional(),
has_documents: z.coerce.boolean().optional(),     // snake_case, like parent_only
document_kind: documentKindSchema.optional(),     // reuse shared enum
```

`routes.ts` requires NO change beyond the schema reference — it already passes
`request.query` straight through (routes.ts:67). The querystring schema binding
at routes.ts:63 picks up the new optional fields automatically.

## 3. Shared layer (`@kanon/shared`)

### 3.1 `documentKind` enum + `documentKinds` on the issue response

`packages/shared/src/issue.ts`:

```ts
export const documentKindSchema = z.enum(["adr", "pdr", "rfc", "note"]);
export type DocumentKind = z.infer<typeof documentKindSchema>;
```

(Mirrors the Prisma `DocumentKind` enum at schema.prisma:65-70 and the existing
web literal `DocumentKind` at web/src/types/issue.ts:115.)

**Gotcha — `issueSchema` is a hand-written recursive `z.ZodType<Issue>` with a
PARALLEL `Issue` type** (issue.ts:80-120). Because the Zod object and the TS
type are maintained separately (the lazy `children` ref forces this), adding
`documentKinds` requires editing BOTH:

```ts
// inside issueSchema z.object(...) (after activeWorkers, issue.ts:98)
documentKinds: z.array(documentKindSchema).optional(),

// inside the manual `Issue` type (after activeWorkers?, issue.ts:119)
documentKinds?: DocumentKind[];
```

`.optional()` keeps it backward-compatible: callers that don't yet return it
(any non-list endpoint, cached pre-change data) still parse. The list endpoint
always returns it.

Barrel export (`packages/shared/src/index.ts:60-83`): add `documentKindSchema`
to the value-export block and `DocumentKind` to the type-export block from
`./issue.js`.

### 3.2 DECISION: extract `issueFilterQuerySchema` to shared — RECOMMENDED, with a caveat

**Recommendation: extract the FILTER VALUE schema to shared, but keep the
api wire-validation schema (with `coerce`/snake_case) in the api module. The web
side gets a typed params builder, not a shared querystring validator.**

Rationale — the api and web have genuinely different needs at this boundary:

- **api** validates an inbound HTTP querystring: everything arrives as strings,
  so it needs `z.coerce.boolean()` and snake_case keys (`has_documents`,
  `document_kind`) to match URL convention (the existing schema comment at
  schema.ts:71-74 documents this snake_case↔camelCase split). This schema is
  Fastify-bound at routes.ts:63 and is inherently api-shaped.
- **web** builds an OUTBOUND querystring from a typed `IssueFilters` object. It
  does not parse a querystring; it serializes one. A coercing snake_case Zod
  schema is the wrong tool for that direction.

So the shared extraction is the **canonical filter value type**, consumed by
both as the source of truth for *which filters exist and their value domains*:

```ts
// packages/shared/src/issue.ts
export const issueFilterValueSchema = z.object({
  state:    issueStateSchema.optional(),
  type:     issueTypeSchema.optional(),
  priority: issuePrioritySchema.optional(),
  hasDocuments: z.boolean().optional(),
  documentKind: documentKindSchema.optional(),
});
export type IssueFilters = z.infer<typeof issueFilterValueSchema>;
```

- **api** keeps `IssueFilterQuery` (snake_case + coerce, schema.ts) as the wire
  schema. It can reuse `documentKindSchema`/`issueStateSchema` etc. from shared
  for the value domains — DRY on enums without forcing the coercion shape onto
  web.
- **web** imports `IssueFilters` (camelCase) as the type for its ONE filters
  object, and a small `buildIssueSearchParams(q, filters)` util serializes it to
  the snake_case querystring the api expects (the camelCase→snake_case map lives
  in one place, web side, tested).

This avoids the alternative (a single shared coercing querystring schema reused
verbatim on web) which would leak snake_case + coercion semantics into the web
state model and couple the web filters object to URL encoding details.

> **Build-order gotcha (LOCKED risk):** `packages/shared` must be built before
> web tsc, or web's import of `documentKindSchema` / `IssueFilters` /
> `DocumentKind` resolves against stale `dist` and tsc fails. PR1 (shared+api)
> must land/build shared first; the tasks phase must encode
> `pnpm --filter @kanon/shared build` before any web typecheck. This is the
> top-line risk from the proposal (Risks: "Shared schema drift breaks api+web").

## 4. Web layer (the HOW)

### 4.1 `issueKeys.search` query key

`packages/web/src/lib/query-keys.ts` — add to the `issueKeys` factory
(alongside `.list`, line 13):

```ts
search: (projectKey: string, q: string, filters: IssueFilters) =>
  [...issueKeys.all, "search", projectKey, q, filters] as const,
```

- Nested under `issueKeys.all` (`["issues"]`) so existing SSE `issue.updated`
  invalidations of `issueKeys.all` also refresh search results (same rationale
  the codebase documents for `.documents`, query-keys.ts:24-30).
- `filters` is a structurally-stable object; TanStack hashes it deterministically
  (stable key order from the typed builder), so identical filter sets reuse the
  cache. Distinct from `.list` (`["issues","list",projectKey]`) so the palette's
  server search NEVER collides with the board's full-list cache — and the
  palette must NOT read `issueKeys.lists()` for results anymore (it replaces the
  `getQueriesData` aggregation, §4.5).

### 4.2 `useIssueSearchQuery` hook (NEW — extract, do not inline in palette)

New file `packages/web/src/features/board/use-issue-search-query.ts` (sibling of
`use-issues-query.ts`; keeps the palette component lean per the
god-component-split convention):

```ts
export function useIssueSearchQuery(
  projectKey: string | null,
  q: string,
  filters: IssueFilters,
) {
  const debounced = useDebouncedSearchInput(q, filters, 200); // q + filters debounced together
  const hasActiveFilter =
    !!filters.state || !!filters.type || !!filters.priority ||
    !!filters.documentKind || !!filters.hasDocuments;

  return useQuery({
    queryKey: issueKeys.search(
      projectKey ?? "", debounced.q, debounced.filters,
    ),
    queryFn: () =>
      fetchApiValidated(
        `/api/projects/${encodeURIComponent(projectKey!)}/issues?${buildIssueSearchParams(debounced.q, debounced.filters)}`,
        issueListSchema, // already returns documentKinds after §3.1
      ),
    enabled: !!projectKey && (debounced.q.trim().length > 0 || hasActiveFilter),
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev, // keep prior results visible while typing (no flicker)
  });
}
```

- **Debounce ~200ms** on the COMBINED (q + filters) input, so a chip toggle and
  a keystroke both settle before refetch. Implemented as a tiny local hook
  (`useDebouncedSearchInput`) — NOT `SearchChip`'s internal 250ms (primitives.tsx:503),
  because the palette's free-text input is the existing top `<input>`
  (command-palette.tsx:220-237), not a `SearchChip`. (We keep `SearchChip` as a
  reuse option only if we move q into a chip; default keeps the native input.)
- **`enabled` gating** prevents a request when there is no project context
  (graceful degrade — commands still work) or when q is empty AND no filter is
  set (so opening the palette shows commands + recent, never an empty server
  hit).
- **Zod boundary**: `fetchApiValidated(url, issueListSchema)` (api-client.ts:168)
  — the response is validated against the now-`documentKinds`-carrying
  `issueListSchema`, so a contract drift throws `ApiValidationError`, not a
  render-time `TypeError`.
- **Serialization** via `buildIssueSearchParams` (the camelCase→snake_case
  mapper from §3.2), e.g. `{ documentKind:'adr', state:'done' }` →
  `q=…&document_kind=adr&state=done`. Encodes `q` with `encodeURIComponent`.

### 4.3 Token parser contract (NEW pure util — primary unit-test seam)

New file `packages/web/src/features/board/parse-search-tokens.ts`. **Pure
function, zero React** — table-driven tests (strict TDD seam #1).

```ts
export interface ParsedSearch {
  q: string;            // leftover free text (trimmed, space-joined)
  filters: IssueFilters;
}
export function parseSearchTokens(raw: string): ParsedSearch;
```

Contract:

- Recognized prefixes (case-insensitive): `state:` `type:` `priority:` `has:`.
- A token `prefix:value` sets the corresponding filter IFF `value` is a valid
  member of that enum (validated against the shared enums —
  `issueStateSchema.options`, etc.):
  - `state:done` → `filters.state='done'`; `type:bug` → `filters.type='bug'`;
    `priority:high` → `filters.priority='high'`.
  - `has:adr|pdr|rfc|note` → `filters.documentKind=<kind>`.
  - `has:any` (or `has:doc`/`has:docs`) → `filters.hasDocuments=true`.
- **Unknown or partial tokens fall through to free text.** `state:` (no value),
  `state:bogus` (invalid enum value), `foo:bar` (unknown prefix), and a bare
  word `auth` all accumulate into `q`. This is the proposal's "known tokens
  parsed, remainder ⇒ q" rule (Risk mitigation: one filters object).
- **Last-wins** on a repeated prefix (`state:todo state:done` ⇒ `done`) — keeps
  the parser deterministic and the filters object single-valued (matches the
  api's single-value `state` predicate).
- `q` is the remaining tokens trimmed and single-space-joined; empty ⇒ `""`.

This is the ONE filters object's writer for the token path. Chips are the other
writer (§4.4). Both produce/consume the same `IssueFilters` shape.

### 4.4 The ONE filters object — chips ⇄ tokens

State lives in the palette as `const [raw, setRaw] = useState("")` (the input
text) plus a derived `{ q, filters } = parseSearchTokens(raw)` via `useMemo`.

- **Tokens → filters**: typing in the input is parsed every render (cheap, pure).
- **Chips → filters**: `PaletteFilterBar` (§4.6) renders `FilterChipSelect`
  bound to the SAME derived `filters`. Selecting a chip value does NOT keep a
  separate state object; it **rewrites the raw input** by upserting the
  corresponding token (e.g. picking Type=bug appends/replaces `type:bug` in
  `raw`). A `setFilterToken(raw, 'type', 'bug')` helper (pure, co-located with
  the parser, tested) does the token upsert/removal.
- This guarantees a single source of truth (`raw` → parsed `{q,filters}`): there
  is no way for chips and tokens to diverge because chips WRITE THROUGH the same
  raw string the tokens are parsed from. The proposal's "no divergent state"
  requirement is satisfied structurally, not by sync effects.

Alternative considered and rejected: separate `filters` state object synced to
tokens via `useEffect`. Rejected — two sources of truth + effect-based sync is
exactly the divergence risk the proposal flags; the write-through-raw approach
has one source.

### 4.5 Integrating server results into the palette `items()` pipeline

Current palette derives issues from the query cache via `getQueriesData` +
`aggregateIssuesFromQueries` (command-palette.tsx:35-46) and filters
client-side (command-palette.tsx:48-58). **Replace the cache aggregation with
the server hook**:

- `const projectKey = useActiveProjectKey();` (§4.7)
- `const { data: searchResults = [], isFetching } = useIssueSearchQuery(projectKey, q, filters);`
- The `items` `useMemo` (command-palette.tsx:48-125) now maps `searchResults`
  (server, already filtered) into issue `CommandItem`s INSTEAD of filtering
  `cachedIssues`. Actions are unchanged. The slice cap (`.slice(0,10)`) stays.
- **Keyboard nav + actions preserved**: the `items` array shape
  (`CommandItem[]`), `selectedIndex` logic (command-palette.tsx:127-160), Enter
  → `onSelect` (navigate to `/issue/$key`, command-palette.tsx:67-74),
  Section/Row rendering (command-palette.tsx:259-303) are all unchanged. Only the
  SOURCE of `filteredIssues` changes from cache to server. Because nav keys off
  `items.length`/`selectedIndex`, and `items` is still a flat ordered array,
  arrow/enter/escape behavior is identical.
- **No-project fallback**: when `projectKey` is null, `useIssueSearchQuery` is
  `enabled:false` ⇒ `searchResults` empty; the issues Section simply renders
  nothing and the Actions Section still works. Commands remain fully functional
  (proposal success criterion).
- **`Go to Board` action** (command-palette.tsx:88-103) currently derives the
  projectKey from the first cached issue's key prefix. With server results that
  can be empty, switch it to use `useActiveProjectKey()` (or fall back to first
  result's key prefix) so navigation still works when the cache is cold.

> The `aggregate-issues.ts` util and the `getQueriesData` cache read become dead
> for the palette. Leave `aggregate-issues.ts` in place ONLY if another consumer
> exists; grep shows the palette is its sole caller, so the tasks phase should
> remove it with the palette change (and its KAN-90 regression test moves/retires
> — see §6). The KAN-90 crash class (non-array cache shapes) disappears because
> the palette no longer reads `getQueriesData`.

### 4.6 ADR / document indicator on issue rows

Each result now carries `documentKinds: DocumentKind[]`. In the `Row` issue
branch (command-palette.tsx:267-280), add a small indicator into the existing
`right` slot (next to `StatePip`) when `documentKinds.length > 0`:

- A compact monospace badge, e.g. `ADR` when `documentKinds.includes('adr')`,
  else a generic doc dot when other kinds present. Inline styles + CSS vars
  (`--ink-3`/`--line`) per the aesthetic convention; reuse the `Kbd`-like pill
  styling already in primitives rather than inventing a new component.
- Render it as part of `CommandItem` (add `documentKinds?: DocumentKind[]` to the
  `CommandItem` interface at command-palette.tsx:17-24, populated from the issue).
- Decision: keep this indicator INLINE in the existing `Row` `right` slot — it is
  a few lines and does not justify a new component; the Row already takes a
  `right: React.ReactNode`.

### 4.7 `useActiveProjectKey` (NEW small hook)

New file `packages/web/src/hooks/use-active-project-key.ts`. Resolves the
current project from the route, reusing the EXISTING pattern from
`app-topbar.tsx:25-34` (pathname regex) rather than `useParams` (the palette
renders in `_authenticated.tsx:143`, OUTSIDE any `$projectKey` route, so
`useParams` for the board route is unavailable there):

```ts
export function useActiveProjectKey(): string | null {
  const { pathname } = useLocation();
  // /board|roadmap|dependencies|cycles/$projectKey  → group 2 is the key
  const m = pathname.match(/^\/(?:board|roadmap|dependencies|cycles)\/([^/]+)/);
  if (m?.[1]) return decodeURIComponent(m[1]);
  // /issue/$key  → derive projectKey from the key prefix (KAN-1 → KAN)
  const im = pathname.match(/^\/issue\/([^/-]+)-/);
  if (im?.[1]) return im[1];
  return null; // workspace/inbox/settings/etc. → no project context
}
```

- Uses `useLocation()` (already used by app-topbar.tsx:46) — reactive, so the
  palette's project context updates if the user navigates while it's open.
- `null` is the graceful-degrade signal threaded into `enabled` (§4.2).
- This is a pure-ish hook over a pure regex helper (`activeProjectKeyFromPath`)
  that is unit-testable in isolation (strict TDD seam #4).

### 4.8 Web `Issue` type duplication note

There are TWO `Issue` types: `@kanon/shared` `Issue` (issue.ts:102-120, used by
`use-issues-query.ts:7`) and web-local `@/types/issue` `Issue`
(types/issue.ts:15-33, used by the palette command-palette.tsx:6). Both must gain
`documentKinds?: DocumentKind[]`. The palette imports the web-local type, so:

- Add `documentKinds?: DocumentKind[]` to web-local `Issue` (types/issue.ts:32)
  using the existing web-local `DocumentKind` literal (types/issue.ts:115).
- The hook returns the SHARED `Issue` (via `issueListSchema` inference); when the
  palette consumes hook results typed as shared `Issue`, the two `documentKinds`
  shapes are structurally identical (`DocumentKind[]`), so no cast is needed
  (project standard: no casts). If a friction point appears, the palette should
  import the SHARED `Issue` for results (preferred) and keep web-local `Issue`
  only for non-result code. The tasks phase should prefer consuming the shared
  type in the palette result path to avoid maintaining two shapes.

## 5. Component decomposition (respect god-component-split convention)

Do NOT bloat `command-palette.tsx`. New units, each small and single-purpose:

| Unit | Path | Kind | Why separate |
|------|------|------|--------------|
| `parseSearchTokens` + `setFilterToken` | `features/board/parse-search-tokens.ts` | pure util | testable in isolation; no React |
| `buildIssueSearchParams` | `features/board/build-issue-search-params.ts` (or co-located) | pure util | camelCase→snake_case wire mapping, tested |
| `useIssueSearchQuery` | `features/board/use-issue-search-query.ts` | hook | data-fetch concern out of the view |
| `useActiveProjectKey` (+`activeProjectKeyFromPath`) | `hooks/use-active-project-key.ts` | hook + pure helper | route-resolution concern, testable helper |
| `PaletteFilterBar` | `components/palette-filter-bar.tsx` | presentational | chip row; keeps palette focused on layout/nav |

`command-palette.tsx` keeps: overlay/dialog layout, input, keyboard nav,
Section/Row, and wiring of the above. Net: the palette gets SMALLER in
responsibility even as features grow.

## 6. Test seams (STRICT TDD — write tests first at every layer)

1. **`parseSearchTokens` (pure)** — table-driven: each recognized prefix,
   invalid enum value falls to q, unknown prefix falls to q, partial `state:`
   falls to q, last-wins on repeat, mixed tokens+free-text, empty input,
   `has:adr`/`has:any` variants. (`setFilterToken` upsert/remove also table-driven.)
2. **`buildIssueSearchParams` (pure)** — camelCase→snake_case mapping, omit
   undefined, `document_kind` vs `has_documents` precedence, q encoding.
3. **`activeProjectKeyFromPath` (pure)** — board/roadmap/etc. paths, issue-key
   prefix derivation, no-project paths → null.
4. **api `listIssues`** — (a) `q` matches title OR key, insensitive; (b)
   `document_kind=adr` returns only `documents.some.kind='adr'`; (c)
   `has_documents` returns issues with ≥1 doc; (d) response items carry distinct
   `documentKinds`; (e) `q` AND filters compose; (f) existing filters
   (state/type/keys) still work (regression).
5. **shared schema** — `issueSchema` parses an item WITH and WITHOUT
   `documentKinds`; `documentKindSchema` rejects unknown kinds.
6. **`useIssueSearchQuery`** — `enabled:false` when no projectKey / empty q+no
   filters; debounce coalesces rapid input into one fetch; result validated by
   `issueListSchema`.
7. **CommandPalette render** — keyboard nav (arrow/enter/escape) over server
   results, doc indicator renders when `documentKinds` non-empty, no-project ⇒
   actions still render. Update the existing KAN-90 test
   (command-palette.test.tsx) — its cache-shape premise is gone; replace with a
   mock of `useIssueSearchQuery` returning fixtures.

## 7. PR slicing (chained PRs, 400-line budget)

Two chained PRs along the api↔web seam; shared rides with the layer that first
needs it. Both are independently revertible (additive).

- **PR1 — backend + shared (foundation).** `documentKindSchema`,
  `documentKinds` on `issueSchema` + barrel; `issueFilterValueSchema`/`IssueFilters`;
  api `IssueFilterQuery` extension (`q`, `has_documents`, `document_kind`);
  `listIssues` (q OR, documents.some, distinct documentKinds, serialization);
  api + shared tests. **Build shared before api typecheck.** Self-contained,
  ships an additive API. Est. ~250-320 changed lines.
- **PR2 — web wiring.** `issueKeys.search`; `useIssueSearchQuery`;
  `parseSearchTokens`/`setFilterToken`; `buildIssueSearchParams`;
  `useActiveProjectKey`; `PaletteFilterBar`; palette rewrite (server results +
  doc indicator + nav preserved); web-local `Issue.documentKinds`; remove dead
  `aggregate-issues` path; web tests (parser, builder, path, hook, palette).
  Depends on PR1's shared+api. **Build shared before web typecheck.** Est.
  ~320-400 changed lines — at the budget ceiling; if it exceeds, split PR2 into
  PR2a (utils+hooks+keys+tests) and PR2b (palette+filter-bar UI).

> Review Workload note for the tasks phase: PR2 is the budget risk. Slice tasks
> so PR2a (pure utils + hooks, fully tested) can land before PR2b (palette UI),
> keeping each PR under 400 lines. PR1 must land first (shared/api are PR2's
> dependency).

## 8. ADR-style decisions

- **ADR-1: Extend the list endpoint, no new search route.** *Decision:* add
  `q`/document filters to `GET /api/projects/:key/issues`. *Rationale:* the
  plumbing (gate, project scope, include, Zod querystring) all exists
  (routes.ts:57-69); a new route would duplicate auth + scope. *Rejected:* a
  dedicated `/search` endpoint (more surface, duplicated project gating) and
  client-side-only filtering (can't see un-loaded issues — the core bug).
- **ADR-2: `documentKinds` via nested select + `distinct`, not `groupBy`.**
  *Decision:* §2.2. *Rationale:* single batched query, bounded payload (4-kind
  cardinality), reuses the proven include pattern. *Rejected:* `groupBy` (second
  query + manual Map merge), per-issue document fetch (N+1).
- **ADR-3: Filter VALUE schema in shared; wire querystring schema stays api-side;
  web uses a typed params builder.** *Decision:* §3.2. *Rationale:* api parses
  inbound snake_case+coerced strings; web serializes an outbound typed object —
  different directions, one shared value type for the enum domains. *Rejected:* a
  single shared coercing querystring schema reused on web (leaks URL/coercion
  semantics into web state).
- **ADR-4: ONE raw-string source of truth; chips write through tokens.**
  *Decision:* §4.4. *Rationale:* structurally prevents chip/token divergence
  (the proposal's flagged risk) without sync effects. *Rejected:* separate
  filters state synced via `useEffect` (two sources, divergence risk).
- **ADR-5: Resolve projectKey from pathname (reuse app-topbar pattern), not
  `useParams`.** *Decision:* §4.7. *Rationale:* the palette renders outside any
  `$projectKey` route (_authenticated.tsx:143); the topbar already derives the
  key from the pathname (app-topbar.tsx:25-34). *Rejected:* `useParams`
  (unavailable at the palette's mount point), a new "active project" store
  (redundant — the URL is already the source of truth).

## 9. Risks (design-level)

- **Build-order (Med→High).** Shared must build before api AND web tsc; encoded
  in PR ordering + task steps. The single biggest failure mode.
- **`documents` leaking into the response (Med).** The existing `...issue` spread
  (service.ts:298) would emit the raw `documents` array unless destructured out;
  §2.2 mandates the destructure. Missing it would change the response shape
  (non-additive) and fail `issueListSchema` if it forbids extra keys (Zod default
  strips unknown keys, so it would pass parse but bloat payload — still fix it).
- **Two `Issue` types drift (Med).** §4.8 — both shared and web-local need
  `documentKinds`; prefer consuming the shared type in the palette result path.
- **Removing `aggregate-issues` + KAN-90 test (Low).** Confirm no other consumer
  (grep: palette is the only one) before deletion; migrate the regression intent
  into the new palette render test.
- **Debounce vs SearchChip's own 250ms (Low).** Palette keeps the native input
  with a dedicated 200ms debounce; do NOT double-debounce by routing q through
  `SearchChip` (primitives.tsx:494-508).
