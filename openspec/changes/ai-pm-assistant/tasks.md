# Tasks: AI PM Assistant — MCP Floor + kanon-agent Consolidation

## Review Workload Forecast

| Field                   | Value                                             |
| ----------------------- | ------------------------------------------------- |
| Estimated changed lines | PR1: ~130 lines; PR2: ~400 new + ~2,500 deletions |
| 400-line budget risk    | PR1: Low; PR2: High (deletion-dominated)          |
| Chained PRs recommended | Yes                                               |
| Suggested split         | PR1 → PR2 (PR2 references shipped title rule)     |
| Delivery strategy       | auto-chain                                        |
| Chain strategy          | stacked-to-main                                   |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                              | Likely PR | Notes                                                                                       |
| ---- | ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| 1    | MCP floor: title refine + persona + description enrichment        | PR1       | Base: main; @kanon/mcp only; ~130 lines                                                     |
| 2    | kanon-agent consolidation: new skill + cleanup + setup + registry | PR2       | Base: PR1 branch (or main after PR1 merges); deletion-dominated; size:exception recommended |

---

## PR1 — MCP Floor (`@kanon/mcp` only)

### Phase 1.1: Red — Title Refine Tests (types.test.ts)

- [x] 1.1.1 In `packages/mcp/src/types.test.ts`, add `describe("IssueTitle refine")` block with four failing tests: valid title accepted (`[Auth] Fix OAuth redirect`), bare title rejected with coaching message containing `[Area]` and a good example, SDD path rejected (`sdd/ai-pm-assistant/apply`), and short valid title accepted (`[API] Fix crash`).
- [x] 1.1.2 In the same file, add `describe("UpdateIssueInput.title refine")` with two tests: valid titled update accepted, bare title update rejected with same coaching message.
- [x] 1.1.3 Verify tests are RED: `pnpm --filter @kanon/mcp test -- --run` (expected failures on new IssueTitle import).

### Phase 1.2: Green — IssueTitle shared schema in types.ts

- [x] 1.2.1 In `packages/mcp/src/types.ts`, export `TITLE_PATTERN = /^\[.+\] .{3,}/` and `TITLE_COACHING` string (coaching message naming `[Area] Verb phrase` format, concrete example `[Auth] Fix OAuth redirect`).
- [x] 1.2.2 Export `IssueTitle = z.string().min(1, "Title must not be empty").refine(v => TITLE_PATTERN.test(v), { message: TITLE_COACHING })`.
- [x] 1.2.3 Replace `CreateIssueInput.title` field (`z.string().min(1, ...)`) with `IssueTitle`.
- [x] 1.2.4 Replace `UpdateIssueInput.title` field (`z.string().min(1).optional()`) with `IssueTitle.optional()`.
- [x] 1.2.5 Trim `cycleId` `.describe()` in `CreateIssueInput` from `"Cycle ID to attach the issue to (emits scope event natively)"` to `"Cycle ID to attach on create"` (~30 B trim per ADR-2 note).
- [x] 1.2.6 Verify types.test.ts title refine tests are GREEN: `pnpm --filter @kanon/mcp test -- --run`.

### Phase 1.3: Red — Instructions Ceiling + Persona Tests (instructions.test.ts)

- [x] 1.3.1 In `packages/mcp/src/instructions.test.ts`, add `describe("PM Persona — byte ceiling and firing pins")` with tests: `Buffer.byteLength(SERVER_INSTRUCTIONS, "utf8") <= 1500`, SERVER_INSTRUCTIONS matches `/PM Persona/i`, contains `[Area]`, contains `kanon_list_groups`, contains `format: ack`, still contains DEFERRED TOOLS heading, and all DEFERRED_TOOLS appear verbatim.
- [x] 1.3.2 Verify new ceiling/persona tests are RED (persona content not yet added): `pnpm --filter @kanon/mcp test -- --run`.

### Phase 1.4: Green — PM Persona block in instructions.ts

- [x] 1.4.1 In `packages/mcp/src/instructions.ts`, insert the PM Persona block at the TOP of `SERVER_INSTRUCTIONS` (before DEFERRED TOOLS section), per ADR-1 wording (~480 bytes): heading, assistant identity, TITLE FORMAT with good/bad examples, pre-create `kanon_list_groups` rule, pre-update `kanon_get_issue` rule, lists format and writes format defaults, deferred-work routing rule.
- [x] 1.4.2 Verify total byte count stays ≤ 1,500: `Buffer.byteLength` check; trim intro sentence if needed (never the persona per ADR-1).
- [x] 1.4.3 Verify instructions.test.ts ALL pass (Win B + new persona tests): `pnpm --filter @kanon/mcp test -- --run`.

### Phase 1.5: Red — Win C Title Coaching Test (descriptions.test.ts)

- [x] 1.5.1 In `packages/mcp/src/tools/descriptions.test.ts`, add test `C10: kanon_create_issue — [Area] title pattern firing pin` asserting description matches `/\[Area\].*[Vv]erb|\[Area\]/`.
- [x] 1.5.2 Verify C10 is RED with current `issues.ts` description.

### Phase 1.6: Green — Enrich kanon_create_issue topline description

- [x] 1.6.1 In `packages/mcp/src/tools/issues.ts`, update the `kanon_create_issue` topline description to include the `[Area] Verb` title pattern coaching and the `kanon_list_groups` pre-step (~60 B addition; must remain within Win C ceiling `DESCRIPTION_BASELINE_BYTES - 300`).
- [x] 1.6.2 Verify all Win C tests GREEN including new C10: `pnpm --filter @kanon/mcp test -- --run`.

### Phase 1.7: PR1 Commit

- [x] 1.7.1 Stage and commit: `feat(mcp): add IssueTitle refine with coaching error and PM persona block` — includes all PR1 file changes (`types.ts`, `types.test.ts`, `instructions.ts`, `instructions.test.ts`, `tools/issues.ts`, `tools/descriptions.test.ts`).

---

## PR2 — kanon-agent Consolidation (`@kanon/setup`, `@kanon/mcp` tests, scripts)

### Phase 2.1: Red — Rewrite skills.test.ts in @kanon/setup (new behaviors)

- [ ] 2.1.1 In `packages/setup/src/__tests__/skills.test.ts`, rewrite test suite to reflect ADR-4: replace old `PRODUCT_SKILLS` list with `["kanon-agent", "kanon-init", "kanon-onboard"]`; add failing test for recursive copy of `sections/issue-creation.md` (`installSkills` must produce `dest/kanon-agent/sections/issue-creation.md`).
- [ ] 2.1.2 Add failing tests: `RETIRED_SKILLS` removal on fresh install (5 dirs absent after install), retired skills removal on upgrade (pre-populate 5 dirs, call `installSkills`, assert all 5 absent and `kanon-agent` present), cleanup idempotent (second call does not throw).
- [ ] 2.1.3 Add test: `removeSkills` covers both `PRODUCT_SKILLS` and `RETIRED_SKILLS` dirs.
- [ ] 2.1.4 Verify new tests are RED: `pnpm --filter @kanon-pm/setup test -- --run`.

### Phase 2.2: Green — Refactor skills.ts with ADR-4 mechanics

- [ ] 2.2.1 In `packages/setup/src/skills.ts`, replace `PRODUCT_SKILLS` array with `["kanon-agent", "kanon-init", "kanon-onboard"]`.
- [ ] 2.2.2 Export `RETIRED_SKILLS = ["kanon-mcp", "kanon-create-issue", "kanon-roadmap", "kanon-cycle", "kanon-orchestrator-hooks"]`.
- [ ] 2.2.3 In `installSkills()`, add retired-dir removal loop BEFORE install loop: `for (const name of RETIRED_SKILLS) fs.rmSync(path.join(skillDest, name), { recursive: true, force: true })`.
- [ ] 2.2.4 Replace flat-file copy loop with `fs.cpSync(srcDir, destDir, { recursive: true })` (removes file-only `readdirSync` loop that drops `sections/`).
- [ ] 2.2.5 Update `removeSkills()` to iterate `[...PRODUCT_SKILLS, ...RETIRED_SKILLS]`.
- [ ] 2.2.6 Verify setup unit tests GREEN: `pnpm --filter @kanon-pm/setup test -- --run`.

### Phase 2.3: Create kanon-agent skill content

- [ ] 2.3.1 Create `packages/setup/assets/skills/kanon-agent/SKILL.md`: frontmatter (name, description, verb-anchored trigger list), Core Philosophy (3 lines), Issue Lifecycle (6 numbered steps), Title Format (TITLE_PATTERN + 2 good + 2 bad examples + group-check rule), On-Demand Sections table (4 rows: trigger → file). Hard ceiling: ≤ 2,048 bytes.
- [ ] 2.3.2 Create `packages/setup/assets/skills/kanon-agent/sections/issue-creation.md`: NL→field mapping, cheap existence checks with `limit:3` + `format:compact` heading, detailed create flow. No paragraph >100 chars duplicated verbatim from core.
- [ ] 2.3.3 Create `packages/setup/assets/skills/kanon-agent/sections/roadmap.md`: horizons table, deferred-work capture patterns, promote-to-issue flow.
- [ ] 2.3.4 Create `packages/setup/assets/skills/kanon-agent/sections/cycle.md`: cycle lifecycle, scope change patterns, close dispositions.
- [ ] 2.3.5 Create `packages/setup/assets/skills/kanon-agent/sections/sdd-hooks.md`: SDD orchestrator hooks, deferred_items processing, ROADMAP injection.

### Phase 2.4: Red — Rewrite skills.test.ts in @kanon/mcp (env-gated)

- [ ] 2.4.1 In `packages/mcp/src/skills.test.ts`, replace Win E1/E2/G1/G2/H1/H2 tests (which reference dead skill names `kanon-mcp`, `kanon-create-issue`, `kanon-roadmap`) with new tests targeting `kanon-agent`:
  - E1': `kanon-agent` core SKILL.md byte size ≤ 2,048.
  - E2': no >100-char paragraph appears verbatim in both core and any section file.
  - G1'/G2': `sections/issue-creation.md` contains `## Cheap existence checks` with `limit:3` and `format:compact`.
  - H1': kanon-agent frontmatter trigger contains verb anchors (list issues, create issue, etc.).
  - H2': trigger does NOT match generic PM prose.
  - Aggregate anti-regrowth: `SKILL_BASELINE_BYTES` recaptured as kanon-agent total (core + 4 sections); new test asserts aggregate ≤ captured value.
- [ ] 2.4.2 Update `packages/mcp/src/tools/__tests__/baseline.fixture.ts`: replace `SKILL_BASELINE_BYTES = 23924` with new aggregate value measured from the newly created kanon-agent files. `DESCRIPTION_BASELINE_BYTES` stays at 4009.
- [ ] 2.4.3 Verify new env-gated tests pass with `KANON_SKILL_DIR=packages/setup/assets/skills pnpm --filter @kanon/mcp test -- --run`.

### Phase 2.5: Delete retired skill directories

- [ ] 2.5.1 Delete `packages/setup/assets/skills/kanon-mcp/` (entire directory).
- [ ] 2.5.2 Delete `packages/setup/assets/skills/kanon-create-issue/` (entire directory).
- [ ] 2.5.3 Delete `packages/setup/assets/skills/kanon-roadmap/` (entire directory).
- [ ] 2.5.4 Delete `packages/setup/assets/skills/kanon-cycle/` (entire directory).
- [ ] 2.5.5 Delete `packages/setup/assets/skills/kanon-orchestrator-hooks/` (entire directory).
- [ ] 2.5.6 Delete `packages/mcp/skills/` (entire directory — all 7 subdirs).

### Phase 2.6: Update scripts and verify-assets

- [ ] 2.6.1 In `scripts/setup-mcp.sh`, change line `SKILLS_SRC="$ROOT_DIR/packages/mcp/skills"` to `SKILLS_SRC="$ROOT_DIR/packages/setup/assets/skills"`.
- [ ] 2.6.2 In `scripts/setup-mcp.sh`, change the install loop's copy command from `cp "$skill_dir"SKILL.md "$dest_dir/SKILL.md"` to `cp -R "$skill_dir" "$s_dest/"` (recursive copy preserving `sections/`).
- [ ] 2.6.3 In `scripts/setup-mcp.sh`, add a retired-skill removal loop BEFORE the install loop: iterate `kanon-mcp kanon-create-issue kanon-roadmap kanon-cycle kanon-orchestrator-hooks` and `rm -rf "$s_dest/$retired"`.
- [ ] 2.6.4 In `packages/setup/scripts/verify-assets.sh`, replace `assert_file "assets/skills/kanon-mcp/SKILL.md"` with `assert_file "assets/skills/kanon-agent/SKILL.md"`.
- [ ] 2.6.5 In `packages/setup/scripts/verify-assets.sh`, add `assert_file` assertions for all four section files: `kanon-agent/sections/issue-creation.md`, `kanon-agent/sections/roadmap.md`, `kanon-agent/sections/cycle.md`, `kanon-agent/sections/sdd-hooks.md`.
- [ ] 2.6.6 Run `packages/setup/scripts/verify-assets.sh` and confirm exit 0.

### Phase 2.7: Update registry compact rules

- [ ] 2.7.1 In `.atl/skill-registry.md`, update Project-Level Skills table: remove the 5 retired skill rows (kanon-mcp, kanon-create-issue, kanon-roadmap, kanon-cycle, kanon-orchestrator-hooks); add a single `kanon-agent` row with trigger description.
- [ ] 2.7.2 In `.atl/skill-registry.md`, add a `### kanon-agent` compact-rules block (~8 lines) covering: one-issue-per-unit-of-work, `[Area] Verb` title format, `kanon_list_groups` pre-create step, `kanon_get_issue` pre-update step, lifecycle order (backlog→todo→in_progress→review→done), roadmap-not-backlog for deferred items, response format defaults (`format: compact` for lists, `format: ack` for writes).

### Phase 2.8: PR2 Commits (work-unit)

- [ ] 2.8.1 Commit 1 (setup): `refactor(setup): add RETIRED_SKILLS cleanup + recursive installSkills copy` — `packages/setup/src/skills.ts`, `packages/setup/src/__tests__/skills.test.ts`.
- [ ] 2.8.2 Commit 2 (skill content): `feat(setup): add kanon-agent tiered skill with core + 4 sections` — `packages/setup/assets/skills/kanon-agent/**`.
- [ ] 2.8.3 Commit 3 (deletion): `chore(setup): delete retired skills and mcp/skills duplicate` — all deleted dirs.
- [ ] 2.8.4 Commit 4 (scripts): `chore(scripts): repoint SKILLS_SRC to setup assets, add -R copy + retired cleanup` — `scripts/setup-mcp.sh`, `packages/setup/scripts/verify-assets.sh`.
- [ ] 2.8.5 Commit 5 (mcp tests): `test(mcp): rewrite skills.test.ts for kanon-agent; recapture SKILL_BASELINE_BYTES` — `packages/mcp/src/skills.test.ts`, `packages/mcp/src/tools/__tests__/baseline.fixture.ts`.
- [ ] 2.8.6 Commit 6 (registry): `docs(registry): add kanon-agent compact-rules block; retire old skill rows` — `.atl/skill-registry.md`.
