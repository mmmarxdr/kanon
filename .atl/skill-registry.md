# Skill Registry — kanon

Generated: 2026-05-01 (refreshed by `sdd-init`)

## User-Level Skills

| Name | Path | Trigger |
|------|------|---------|
| react-doctor | `~/.claude/skills/react-doctor/SKILL.md` | Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project. |
| go-testing | `~/.claude/skills/go-testing/SKILL.md` | When writing Go tests, using teatest, or adding test coverage. |
| skill-creator | `~/.claude/skills/skill-creator/SKILL.md` | When user asks to create a new skill, add agent instructions, or document patterns for AI. |
| context7-mcp | `~/.claude/skills/context7-mcp/SKILL.md` | When user asks about libraries, frameworks, API references, or needs code examples involving specific packages. |

## SDD Phase Skills

| Name | Path |
|------|------|
| sdd-init | `~/.claude/skills/sdd-init/SKILL.md` |
| sdd-explore | `~/.claude/skills/sdd-explore/SKILL.md` |
| sdd-propose | `~/.claude/skills/sdd-propose/SKILL.md` |
| sdd-spec | `~/.claude/skills/sdd-spec/SKILL.md` |
| sdd-design | `~/.claude/skills/sdd-design/SKILL.md` |
| sdd-tasks | `~/.claude/skills/sdd-tasks/SKILL.md` |
| sdd-apply | `~/.claude/skills/sdd-apply/SKILL.md` |
| sdd-verify | `~/.claude/skills/sdd-verify/SKILL.md` |
| sdd-archive | `~/.claude/skills/sdd-archive/SKILL.md` |

## Project-Level Skills

| Name | Path | Trigger |
|------|------|---------|
| kanon-agent | `.claude/skills/kanon-agent/SKILL.md` | PM board assistant — issue lifecycle, title coaching, group checks, cycle management, roadmap capture, SDD orchestrator hooks. Trigger: list issues, create issue, update issue, board management, start cycle, close sprint, roadmap item, track this, log a bug, deferred work. |
| kanon-init | `.claude/skills/kanon-init/SKILL.md` | Automated project onboarding — scan a codebase, create a Kanon project, and seed initial issues from TODOs. Trigger: `/kanon-init` |
| kanon-onboard | `.claude/skills/kanon-onboard/SKILL.md` | Team invite + per-machine setup — admin sends `kanon://` invite, teammate runs `kanon-setup <link>`. Trigger: team onboarding, multi-machine setup, MCP wrapper-mode debugging. |

## Shared Configs

| Name | Path | Purpose |
|------|------|---------|
| kanon-phase-common | `.claude/skills/_shared/kanon-phase-common.md` | Shared Kanon issue tracking protocol for all SDD phase sub-agents — state transitions, description enrichment, and engram references. |

## Project Conventions

- `/home/marxdr/workspace/kanon/CLAUDE.md` — Kanon monorepo overview: packages (api, web, mcp, cli, bridge, e2e, setup), tech stack (TypeScript / Node 20+ / pnpm workspaces), dev setup (`pnpm bootstrap && pnpm dev:start`), and note that `_shared/kanon-phase-common.md` is project-only (not part of global install).

## Compact Rules (auto-resolved into sub-agent prompts)

### kanon-agent (issue lifecycle, board management, cycles, roadmap, SDD hooks)
- One issue = one unit of work. Human-readable cards readable by anyone on the team.
- Title format: `[Area] Imperative verb phrase`. Good: `[Auth] Fix OAuth redirect`. Bad: `fix thing`, `sdd/path`, `KAN-42`.
- Before kanon_create_issue: call kanon_list_groups(projectKey) → assign a real groupKey.
- Before kanon_update_issue: call kanon_get_issue first — never overwrite blindly.
- Lifecycle order: backlog → todo → in_progress → review → done. Use kanon_transition_issue.
- Deferred/later/"someday" work → kanon_create_roadmap_item, NOT backlog.
- Lists: format: compact, limit: 10. Writes: format: ack. Existence checks: limit: 3, format: compact.
- Extended flows (NL→field mapping, cycle dispositions, SDD hooks): load sections/ on demand.

### TypeScript / pnpm monorepo (api, web, mcp, cli, bridge, setup, e2e)
- ESM only — every package has `"type": "module"`. No CommonJS imports.
- pnpm workspaces — use `pnpm --filter @kanon/<pkg> <script>` for package-scoped commands (note: setup uses scope `@kanon-pm/setup`).
- Strict TS via `tsconfig.base.json` extended per package.
- Conventional commits only. NEVER add "Co-Authored-By" or AI attribution.
- NEVER run builds after changes (per global user rule).
- Web: React 19 + TanStack Router + TanStack Query — keep mutation cache invalidation aligned with cycleKeys/issueKeys factories (see recent commits: `cdefbc7`, `177744b`).
- API: Fastify 5 + Prisma 6 + Zod schemas — emit SSE events on mutations; guard against undefined fields in SSE payloads (see commit `71845df`).
- Bridge: shared Zod types live here; consume from api/cli/web rather than duplicating.

### Strict TDD Mode (ENABLED)
- Write failing test first → minimal code to pass → refactor.
- Default runner: vitest. E2E: Playwright (`pnpm e2e`).
- Per-package test commands cached under engram topic_key `sdd/kanon/testing-capabilities`.
- API tests: `pnpm --filter @kanon/api test` (modules under `src/modules/**/*.test.ts`).
- Web tests: `pnpm --filter @kanon/web test` (vitest + @testing-library/react + jsdom).
- API coverage: `pnpm --filter @kanon/api test:coverage`.

### Commit / PR Hygiene
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- Scope by package: `fix(api): ...`, `feat(web): ...`, `refactor(mcp): ...`.
- No emojis in commits unless explicitly requested.
