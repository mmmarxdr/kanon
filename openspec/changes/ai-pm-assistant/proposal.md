# Proposal: AI PM Assistant — MCP Floor + kanon-agent Skill Consolidation

## Intent

Kanon's AI surface fails at three layers simultaneously (exploration evidence): the MCP schema accepts any title (`z.string().min(1)`, no coaching), `SERVER_INSTRUCTIONS` is pure tool routing with zero PM persona, and 7 separate shipped skills duplicate philosophy prose and cost ~24KB of always-loaded context. Result: AI agents create human-unreadable cards (`fix thing`, SDD internal paths). **Win**: every client — Claude Code, Cursor, Codex, REST/custom-harness, or no harness — gets a PM-professional assistant that produces human-first cards, token-frugally (continuation of mcp-token-optimization).

## Scope

### In Scope

1. **MCP floor** (`packages/mcp/src/`): ~15-line PM persona block in `instructions.ts` (~450 bytes, 1,500-byte total ceiling enforced by test); `kanon_create_issue` description enrichment; `types.ts` title refine `^\[.+\] .{3,}` with coaching error message.
2. **kanon-agent skill**: consolidate kanon-mcp + kanon-create-issue + kanon-roadmap + kanon-cycle + kanon-orchestrator-hooks into ONE skill — ~1.5KB always-loaded `SKILL.md` core (persona, lifecycle, title format, trigger table) + `sections/` on-demand (issue-creation, roadmap, cycle, sdd-hooks). `kanon-onboard` and `kanon-init` stay separate.
3. **Setup CLI** (`packages/setup/src/skills.ts` + `scripts/setup-mcp.sh`): install kanon-agent (recursive copy — current `installSkills` skips subdirectories, breaking `sections/`); ACTIVELY remove the 5 retired skill dirs on re-run via a `RETIRED_SKILLS` list.
4. **Registry compact-rules block** (~8 lines) for kanon-agent in `.atl/skill-registry.md`.
5. **Tests**: rewrite `skills.test.ts` for kanon-agent; recapture `SKILL_BASELINE_BYTES`; instructions ceiling test; refine unit tests (strict TDD).

### Out of Scope

- API-side title lint (zero API changes)
- TechnicalDocument entity (PDR/ADR) — follow-up change; interim: `kanon_sync_observation` comments
- PPM; user's personal gentle-ai harness

## Capabilities

### New Capabilities

- `mcp-pm-guidance`: PM persona in server instructions + coaching title validation + enriched create-issue description.
- `kanon-agent-skill`: consolidated tiered skill, distribution, and retired-skill cleanup across all supported tools.

### Modified Capabilities

None.

## Resolved Open Questions

| #   | Question                 | Position                                                                                                                                                  | Rationale                                                                                                                                                                                                                                                               |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Canonical skill location | **`packages/setup/assets/skills/` is the ONLY copy; delete `packages/mcp/skills/` duplicates; point `setup-mcp.sh` `SKILLS_SRC` there**                   | The npm tarball ships `assets/` physically — a prepublish sync from `mcp/skills/` is machinery to maintain a duplication with no consumer; two copies = the exact drift failure this change fights. `KANON_SKILL_DIR` env-gating already decouples tests from location. |
| 2   | Cleanup mechanism        | **`RETIRED_SKILLS` const in `skills.ts`; `installSkills()` removes them every run; mirror in `setup-mcp.sh`**                                             | Idempotent, works on upgrade AND fresh install; no version detection needed.                                                                                                                                                                                            |
| 3   | Refine regex             | **`^\[.+\] .{3,}`**                                                                                                                                       | `{5,}` over-rejects valid short phrases (`[API] Fix crash` body = 9 chars but guard against edge); `{3,}` still blocks empty bodies.                                                                                                                                    |
| 4   | Test rewrite             | **Replace 3-file aggregate (E1/E2) with kanon-agent core byte ceiling (~2KB) + no-duplicate-paragraph across core+sections; retarget G/H to kanon-agent** | Old names die with the skills; ceiling is the durable invariant, not a baseline delta.                                                                                                                                                                                  |

## Approach

Two independent stages: **Stage 1** MCP floor (small, low-risk, `@kanon/mcp` only) → **Stage 2** skill consolidation + setup CLI (markdown-heavy, mechanical deletions). Test-first per Strict TDD (`pnpm --filter @kanon/mcp test -- --run`, `--filter @kanon/setup`).

## Affected Areas

| Area                                                                     | Impact   | Description                                       |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------- |
| `packages/mcp/src/types.ts`                                              | Modified | Title refine + trim verbose `.describe()` strings |
| `packages/mcp/src/instructions.ts`                                       | Modified | PM persona block under 1,500-byte ceiling         |
| `packages/setup/assets/skills/kanon-agent/`                              | New      | Core SKILL.md + 4 sections                        |
| `packages/setup/assets/skills/{5 retired}/`, `packages/mcp/skills/`      | Removed  | Single-copy canonicalization                      |
| `packages/setup/src/skills.ts`                                           | Modified | Recursive copy + RETIRED_SKILLS cleanup           |
| `scripts/setup-mcp.sh`, `packages/setup/scripts/verify-assets.sh`        | Modified | New SKILLS_SRC; assert kanon-agent                |
| `packages/mcp/src/skills.test.ts`, `tools/__tests__/baseline.fixture.ts` | Modified | Rewritten Win E/G/H; recaptured baseline          |
| `.atl/skill-registry.md`                                                 | Modified | kanon-agent compact rules                         |

## Risks

| Risk                                                             | Likelihood | Mitigation                                                                                                        |
| ---------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Stale old skills double-load on user machines                    | High       | RETIRED_SKILLS active removal on any re-run; release notes                                                        |
| Regex over-rejects legitimate titles                             | Med        | Permissive `{3,}` + teaching error names the fix                                                                  |
| `sections/` invisible to non-orchestrated clients (Cursor/Codex) | High       | Core SKILL.md MUST be self-sufficient for the 80% path (lifecycle, title, groups) — hard requirement for sdd-spec |
| Baseline tests break mid-consolidation                           | Med        | Rewrite tests first (TDD), single PR with skill move                                                              |

## Rollback Plan

Stage 1: revert PR — schema refine and instructions are additive, no data impact. Stage 2: revert PR restores old skill files and PRODUCT_SKILLS list; re-running setup reinstalls old skills (RETIRED_SKILLS gone with the revert).

## Dependencies

None external. Stage 2 should land after Stage 1 so the skill references the shipped title rule.

## Size / Review Workload

Stage 1: ~120-150 changed lines (1 PR, within 400 budget). Stage 2: ~400 new lines (skill + CLI + tests) + ~2,500 deletion lines (10 retired skill files across 2 locations) — exceeds 400 budget but deletions are mechanical markdown removals. **Chained PRs recommended: Yes** (PR1 MCP floor → PR2 consolidation; PR2 may warrant `size:exception` given deletion-dominated diff).

## Success Criteria

- [ ] `kanon_create_issue` rejects `fix thing` with the coaching message; accepts `[Auth] Fix OAuth redirect`
- [ ] `SERVER_INSTRUCTIONS` ≤ 1,500 bytes, contains PM persona (test-enforced)
- [ ] One physical skill copy; setup run on a machine with old skills leaves only kanon-agent + kanon-onboard + kanon-init
- [ ] kanon-agent core ≤ ~2KB and self-sufficient without `sections/`
- [ ] `@kanon/mcp` and `@kanon/setup` suites green; `verify-assets.sh` passes
