# kanon-agent-skill Specification

## Purpose

Consolidate 5 separate kanon skills (kanon-mcp, kanon-create-issue, kanon-roadmap, kanon-cycle, kanon-orchestrator-hooks) into a single tiered `kanon-agent` skill with a self-sufficient always-loaded core and on-demand `sections/`. Eliminate stale skill duplicates on user machines via active RETIRED_SKILLS cleanup in the setup CLI.

## Requirements

### Requirement: kanon-agent Core Self-Sufficiency

`packages/setup/assets/skills/kanon-agent/SKILL.md` MUST exist and MUST be self-sufficient for the 80% path (issue lifecycle, title format, group-check, deferred-to-roadmap) WITHOUT loading any file under `sections/`. Its byte size MUST NOT exceed ~2,048 bytes (2KB ceiling, test-enforced). `kanon-onboard` and `kanon-init` MUST remain as separate skills.

#### Scenario: Core SKILL.md covers lifecycle without sections

- GIVEN `packages/setup/assets/skills/kanon-agent/SKILL.md` in isolation (no sections loaded)
- WHEN an AI client reads only that file
- THEN the file MUST contain: issue lifecycle steps (list → start → in_progress → done → stop)
- AND it MUST contain the title format pattern (`[Area] Imperative verb phrase`)
- AND it MUST instruct calling `kanon_list_groups` before `kanon_create_issue`
- AND it MUST contain an on-demand section trigger table mapping phrases to `sections/` files

#### Scenario: Core byte ceiling enforced by test

- GIVEN the `@kanon/mcp` test suite (`skills.test.ts`)
- WHEN `pnpm --filter @kanon/mcp test -- --run` executes
- THEN a test asserting `SKILL.md byte size <= 2048` MUST pass

#### Scenario: kanon-onboard and kanon-init remain separate

- GIVEN the installed skill directories after `installSkills` runs
- WHEN the destination directory is listed
- THEN `kanon-onboard/SKILL.md` MUST be present
- AND `kanon-init/SKILL.md` MUST be present
- AND neither MUST be removed by the RETIRED_SKILLS cleanup

---

### Requirement: On-Demand Sections Layout

The `kanon-agent` skill MUST include a `sections/` subdirectory containing at minimum four files: `issue-creation.md`, `roadmap.md`, `cycle.md`, and `sdd-hooks.md`. Each section file MUST be loadable independently without requiring other section files.

#### Scenario: All four section files present after install

- GIVEN `installSkills(dest, assetsDir)` is called with the updated assets
- WHEN the destination `kanon-agent/` directory is inspected
- THEN `sections/issue-creation.md`, `sections/roadmap.md`, `sections/cycle.md`, and `sections/sdd-hooks.md` MUST all be present

---

### Requirement: Recursive Directory Copy in installSkills

`installSkills()` in `packages/setup/src/skills.ts` MUST copy subdirectories recursively, so that `kanon-agent/sections/` is included in the installed output. The current flat-file-only copy MUST be replaced.

#### Scenario: Subdirectory copied during install

- GIVEN a skill source directory containing `SKILL.md` and `sections/issue-creation.md`
- WHEN `installSkills(dest, assetsDir)` is called
- THEN `dest/kanon-agent/SKILL.md` MUST exist
- AND `dest/kanon-agent/sections/issue-creation.md` MUST exist

#### Scenario: Flat-only skills still install correctly

- GIVEN `kanon-onboard` source directory containing only `SKILL.md` (no subdirs)
- WHEN `installSkills(dest, assetsDir)` is called
- THEN `dest/kanon-onboard/SKILL.md` MUST exist with no error

---

### Requirement: RETIRED_SKILLS Active Cleanup

`packages/setup/src/skills.ts` MUST export a `RETIRED_SKILLS` constant listing the 5 consolidated skill names: `kanon-mcp`, `kanon-create-issue`, `kanon-roadmap`, `kanon-cycle`, `kanon-orchestrator-hooks`. `installSkills()` MUST remove each of these directories from `skillDest` on every run, whether they exist or not (idempotent). `scripts/setup-mcp.sh` MUST mirror this cleanup.

#### Scenario: Retired skills removed on fresh install

- GIVEN a skill destination that contains no retired skill directories
- WHEN `installSkills(dest, assetsDir)` is called
- THEN the function MUST complete without error
- AND no retired skill directory MUST appear in the destination

#### Scenario: Retired skills removed on upgrade

- GIVEN a skill destination that already contains `kanon-mcp/`, `kanon-create-issue/`, `kanon-roadmap/`, `kanon-cycle/`, and `kanon-orchestrator-hooks/`
- WHEN `installSkills(dest, assetsDir)` is called
- THEN all five directories MUST be absent from the destination after the call
- AND `kanon-agent/` MUST be present in the destination

#### Scenario: Cleanup is idempotent

- GIVEN `installSkills` has already been called once (retired dirs already removed)
- WHEN `installSkills(dest, assetsDir)` is called a second time
- THEN the function MUST complete without error (no exception for missing dirs)

---

### Requirement: Single Physical Skill Copy

`packages/setup/assets/skills/` MUST be the ONLY canonical location for skill content after this change. The `packages/mcp/skills/` directory (current source-of-truth duplicate for kanon-mcp, kanon-create-issue, etc.) MUST be deleted. `KANON_SKILL_DIR` env-gating in tests MUST reference the setup assets location.

#### Scenario: mcp/skills/ directory absent after change lands

- GIVEN the repository after the change is applied
- WHEN `packages/mcp/skills/` is checked for existence
- THEN the directory MUST NOT exist (deleted, not kept as archive)

#### Scenario: Test env-gating uses setup assets path

- GIVEN `KANON_SKILL_DIR` env var set to `packages/setup/assets/skills/`
- WHEN the env-gated skill tests in `skills.test.ts` run
- THEN tests referencing `kanon-agent` MUST pass
- AND no test MUST reference `kanon-mcp`, `kanon-create-issue`, `kanon-roadmap`, `kanon-cycle`, or `kanon-orchestrator-hooks` by name

---

### Requirement: Registry Compact Rules for kanon-agent

`.atl/skill-registry.md` MUST include a `### kanon-agent` compact-rules block of approximately 8 lines covering: one-issue-per-unit-of-work, title format, `kanon_list_groups` pre-step, `kanon_get_issue` pre-update, lifecycle order, roadmap-not-backlog for deferred items, and response format defaults.

#### Scenario: Registry block present and under token budget

- GIVEN `.atl/skill-registry.md` after the change
- WHEN the `### kanon-agent` section is extracted
- THEN it MUST contain the title format rule
- AND it MUST contain the `kanon_list_groups` pre-step rule
- AND the section MUST be no longer than 12 lines
