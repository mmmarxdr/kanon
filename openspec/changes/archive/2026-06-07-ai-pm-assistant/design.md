# Design: AI PM Assistant — MCP Floor + kanon-agent Consolidation

## Technical Approach

Two chained PRs. **PR1 (Stage 1 — MCP floor)**: shared title schema with coaching refine in `types.ts`, PM persona block in `instructions.ts` under a test-enforced 1,500-byte ceiling, minimal `kanon_create_issue` topline enrichment. **PR2 (Stage 2 — consolidation)**: kanon-agent tiered skill in `packages/setup/assets/skills/` (single physical copy), recursive install + `RETIRED_SKILLS` cleanup in the setup CLI and `setup-mcp.sh`, rewritten byte-budget tests. Strict TDD both stages: failing tests land before implementation within each PR.

## Architecture Decisions

### ADR-1: Persona block — placement, wording, byte budget

**Choice**: Persona goes at the TOP of `SERVER_INSTRUCTIONS` (identity before routing). Exact block (~480 bytes):

```
## PM Persona

You are a senior PM assistant for the Kanon board. Every card must be readable
by a teammate who never touched the code.

TITLE FORMAT (required): [Area] Imperative verb phrase
  Good: [Auth] Fix OAuth redirect | [API] Add rate limiting
  Bad: fix thing | sdd/change/path | KAN-42

Before kanon_create_issue: kanon_list_groups(projectKey) -> assign groupKey.
Before kanon_update_issue: kanon_get_issue first — never overwrite blindly.
Lists: format: compact, limit: 10. Writes: format: ack.
Deferred work (later/someday) -> roadmap, not backlog.
```

Budget: heading+intro ~160 B, persona ~480 B, DEFERRED section ~340 B, CORE list ~430 B ≈ 1,410 B. Headroom ~90 B; if exceeded, trim the intro sentence, never the persona. Ceiling test in `instructions.test.ts`: `Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8") <= 1500` plus firing-pin assertions (`[Area]`, `kanon_list_groups`, `format: ack`).
**Rejected**: fat instructions (bloats every session), `kanon_guide` meta-tool (no guaranteed invocation) — per explore round 3.

### ADR-2: Title refine — shared schema, create AND update

**Choice**: one shared schema in `types.ts`:

```ts
export const TITLE_PATTERN = /^\[.+\] .{3,}/;
export const TITLE_COACHING =
  "Title must follow '[Area] Verb phrase' — e.g. '[Auth] Fix OAuth redirect'. " +
  "Vague titles ('fix thing') or internal paths cost the team time.";
export const IssueTitle = z
  .string()
  .min(1, "Title must not be empty")
  .refine((v) => TITLE_PATTERN.test(v), { message: TITLE_COACHING });
```

`CreateIssueInput.title = IssueTitle`; `UpdateIssueInput.title = IssueTitle.optional()` — update MUST validate too, otherwise an agent can degrade a good title post-creation. Existing issues are unaffected (title only validated when sent). Roadmap titles stay loose (ideas, not work cards). Field-level `ZodEffects` inside `z.object` shapes is compatible with the MCP SDK's JSON-schema conversion (refine adds no schema payload beyond ~0 bytes; error surfaces at parse time).
**Rejected**: per-tool inline refine (duplication); regex in tool handler (loses Zod error channel).

### ADR-3: kanon-agent tiered layout

**Choice**: `packages/setup/assets/skills/kanon-agent/` — `SKILL.md` core (hard ceiling **2,048 bytes**, self-sufficient 80% path) + `sections/{issue-creation,roadmap,cycle,sdd-hooks}.md` (~3KB/2.5KB/3KB/1KB soft targets). Core contains: frontmatter (name, description, verb-anchored trigger list), Core Philosophy (one issue = one unit of work; human-readable cards; engram=memory/kanon=narrative), Issue Lifecycle (6 numbered steps), Title Format (pattern + 2 good + 2 bad examples + group-check rule), On-Demand Sections table (trigger → file). Detailed patterns (NL→field mapping, cheap existence checks `limit:3 + format:compact`, horizons, cycle dispositions, orchestrator hooks) live ONLY in sections — **no >100-char paragraph may appear verbatim in two files** (core or any section), test-enforced.
**Rejected**: ~2.5KB fat core (costs every non-orchestrated load); guidance only in sections (invisible to Cursor/Codex — proposal risk row 3).

### ADR-4: Install mechanics — recursive copy + retired cleanup

**Choice** (`packages/setup/src/skills.ts`):

- `PRODUCT_SKILLS = ["kanon-agent", "kanon-init", "kanon-onboard"]`
- `RETIRED_SKILLS = ["kanon-mcp", "kanon-create-issue", "kanon-roadmap", "kanon-cycle", "kanon-orchestrator-hooks"]`
- `installSkills()`: first `fs.rmSync` every retired dir under `skillDest` (idempotent, every run), then copy each product skill via `fs.cpSync(srcDir, destDir, { recursive: true })` (replaces the file-only `readdirSync` loop that drops `sections/`).
- `removeSkills()`: iterate `PRODUCT_SKILLS + RETIRED_SKILLS`.
- `setup-mcp.sh`: `SKILLS_SRC="$ROOT_DIR/packages/setup/assets/skills"`; install loop uses `cp -R "$skill_dir" "$s_dest/"`; add a mirrored retired-removal loop before install. Its `remove_skills_and_workflows` glob (`kanon-*/`) already catches retired dirs.
- Delete `packages/mcp/skills/` entirely (single physical copy — proposal Q1, binding).
  **Rejected**: version-detection cleanup (fragile), prepublish sync between two copies (the drift this change kills).

### ADR-5: Test invariants — absolute ceilings, not baseline deltas

**Choice**: rewrite `packages/mcp/src/skills.test.ts` (still `KANON_SKILL_DIR`-gated; dev runs can point it at `packages/setup/assets/skills`):

- E1': kanon-agent core `SKILL.md` ≤ 2,048 bytes.
- E2': no-duplicate-paragraph (>100 chars) across core + all `sections/*.md` (generalized N-file version of today's pairwise check).
- G1'/G2': `sections/issue-creation.md` contains `## Cheap existence checks` with `limit:3` + `format:compact`.
- H1'/H2': kanon-agent frontmatter trigger verb-anchored; no match on generic PM prose.
- `SKILL_BASELINE_BYTES` recaptured as kanon-agent aggregate (core + 4 sections, measured at landing); new anti-regrowth test: aggregate ≤ recaptured value. `DESCRIPTION_BASELINE_BYTES` untouched.
  **Rejected**: keeping delta-from-23,924 tests (the 3 measured files cease to exist).

## Data Flow

    types.ts (IssueTitle refine) ──rejects──→ coaching error → AI self-corrects
    instructions.ts (persona) ──initialize handshake──→ every MCP client
    assets/skills/kanon-agent ──installSkills()/setup-mcp.sh──→ ~/.claude/skills etc.
                                └─ RETIRED_SKILLS rm on every run (upgrade-safe)

## File Changes

| File                                                                     | Action                                                                                                       | PR  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --- |
| `packages/mcp/src/types.ts`                                              | Modify — `IssueTitle` + trim `cycleId` describe ("emits scope event natively")                               | 1   |
| `packages/mcp/src/types.test.ts`                                         | Create — refine unit tests                                                                                   | 1   |
| `packages/mcp/src/instructions.ts`                                       | Modify — persona block                                                                                       | 1   |
| `packages/mcp/src/instructions.test.ts`                                  | Modify — ceiling + firing pins                                                                               | 1   |
| `packages/mcp/src/tools/issues.ts`                                       | Modify — create_issue topline adds title example (~60 B; must stay under existing Win C description ceiling) | 1   |
| `packages/setup/assets/skills/kanon-agent/**`                            | Create — core + 4 sections                                                                                   | 2   |
| `packages/setup/assets/skills/{5 retired}/`, `packages/mcp/skills/`      | Delete                                                                                                       | 2   |
| `packages/setup/src/skills.ts` + `__tests__/skills.test.ts`              | Modify — ADR-4 + mocks with `sections/`                                                                      | 2   |
| `scripts/setup-mcp.sh`, `packages/setup/scripts/verify-assets.sh`        | Modify — new SRC, `cp -R`, assert kanon-agent core + sections                                                | 2   |
| `packages/mcp/src/skills.test.ts`, `tools/__tests__/baseline.fixture.ts` | Rewrite / recapture                                                                                          | 2   |
| `.atl/skill-registry.md`                                                 | Modify — ~8-line kanon-agent compact rules (from explore round 3)                                            | 2   |

## Testing Strategy

| Layer        | What                                                                                   | Approach                            |
| ------------ | -------------------------------------------------------------------------------------- | ----------------------------------- |
| Unit (mcp)   | refine accept/reject + message; instructions ceiling                                   | vitest, RED first                   |
| Unit (setup) | recursive copy of `sections/`; retired removal on install; removeSkills covers retired | tmpdir fixtures incl. nested files  |
| Script       | verify-assets passes; setup-mcp.sh install leaves only 3 skills                        | `verify-assets.sh` in prepublish/CI |
| Env-gated    | kanon-agent ceilings/dup/trigger                                                       | `KANON_SKILL_DIR` runs              |

## Migration / Rollout

PR1 → PR2 (PR2 references the shipped title rule). User machines self-heal on next setup run via `RETIRED_SKILLS`. Rollback = revert PR (per proposal).

## Open Questions

None blocking. Verify during PR2 that `@kanon-pm/setup` package.json `files` globs include nested `assets/skills/kanon-agent/sections/` in the published tarball.
