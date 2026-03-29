# Skill Registry — kanon

Generated: 2026-03-28

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
| kanon-init | `.claude/skills/kanon-init/SKILL.md` | Automated project onboarding — scan a codebase, create a Kanon project, and seed initial issues from TODOs. Trigger: `/kanon-init` |
| kanon-mcp | `.claude/skills/kanon-mcp/SKILL.md` | Human-facing project board integration — clean cards, meaningful titles, progressive enrichment from SDD and general work. Active during all SDD phases and issue management. |
| kanon-nl-create | `.claude/skills/kanon-nl-create/SKILL.md` | Natural language issue creation — parse user descriptions of bugs, features, and tasks into well-structured Kanon issues. Trigger: user says "create an issue", "track this", "log a bug", or describes work to capture. |
| kanon-roadmap | `.claude/skills/kanon-roadmap/SKILL.md` | Proactive roadmap capture — recognize future work during conversations and SDD workflows, create and enrich roadmap items. Trigger: user mentions deferred work, "someday", "eventually", or SDD phases surface out-of-scope items. |
| kanon-orchestrator-hooks | `.claude/skills/kanon-orchestrator-hooks/SKILL.md` | Kanon-specific hooks for the SDD orchestrator — ROADMAP injection into sub-agent prompts and post-phase deferred_items processing. Active when launching SDD phases in the kanon project. |

## Shared Configs

| Name | Path | Purpose |
|------|------|---------|
| kanon-phase-common | `.claude/skills/_shared/kanon-phase-common.md` | Shared Kanon issue tracking protocol for all SDD phase sub-agents — state transitions, description enrichment, and engram references. |

## Project Conventions

_No project-level CLAUDE.md, AGENTS.md, .cursorrules, or GEMINI.md found._
