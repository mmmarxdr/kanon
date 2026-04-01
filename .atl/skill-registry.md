# Skill Registry — kanon

Generated: 2026-03-30 (sdd-init)

## User-Level Skills (`~/.cursor/skills/`)

Skills instaladas en el perfil de Cursor (excl. fases SDD y duplicados Kanon del bundle).

| Name | Path | Trigger |
|------|------|---------|
| issue-creation | `~/.cursor/skills/issue-creation/SKILL.md` | Crear issue de GitHub, bug o feature (Agent Teams Lite). |
| branch-pr | `~/.cursor/skills/branch-pr/SKILL.md` | Abrir PR, preparar rama, revisión (issue-first). |
| skill-creator | `~/.cursor/skills/skill-creator/SKILL.md` | Crear o documentar nuevas agent skills. |
| go-testing | `~/.cursor/skills/go-testing/SKILL.md` | Tests en Go / Bubbletea / teatest. |
| judgment-day | `~/.cursor/skills/judgment-day/SKILL.md` | Revisión adversarial dual (doble juez). |

Las skills `kanon-*` también suelen existir bajo `~/.cursor/skills/` si las instalaste globalmente; para **este repo** manda la copia empaquetada en `packages/mcp/skills/` (ver abajo).

## SDD Phase Skills (`~/.cursor/skills/`)

| Name | Path |
|------|------|
| sdd-init | `~/.cursor/skills/sdd-init/SKILL.md` |
| sdd-explore | `~/.cursor/skills/sdd-explore/SKILL.md` |
| sdd-propose | `~/.cursor/skills/sdd-propose/SKILL.md` |
| sdd-spec | `~/.cursor/skills/sdd-spec/SKILL.md` |
| sdd-design | `~/.cursor/skills/sdd-design/SKILL.md` |
| sdd-tasks | `~/.cursor/skills/sdd-tasks/SKILL.md` |
| sdd-apply | `~/.cursor/skills/sdd-apply/SKILL.md` |
| sdd-verify | `~/.cursor/skills/sdd-verify/SKILL.md` |
| sdd-archive | `~/.cursor/skills/sdd-archive/SKILL.md` |

## Project-Level Skills (bundle `packages/mcp/skills/`)

| Name | Path | Trigger |
|------|------|---------|
| kanon-init | `packages/mcp/skills/kanon-init/SKILL.md` | `/kanon-init` — onboarding proyecto Kanon. |
| kanon-mcp | `packages/mcp/skills/kanon-mcp/SKILL.md` | Tablero, issues, enriquecimiento SDD. |
| kanon-create-issue | `packages/mcp/skills/kanon-create-issue/SKILL.md` | Crear issues Kanon desde lenguaje natural. |
| kanon-roadmap | `packages/mcp/skills/kanon-roadmap/SKILL.md` | Roadmap y trabajo diferido. |
| kanon-orchestrator-hooks | `packages/mcp/skills/kanon-orchestrator-hooks/SKILL.md` | Hooks orchestrator SDD + Kanon. |
| kanon-workflow | `packages/mcp/skills/kanon-workflow/SKILL.md` | Agente único — Kanon primero, SDD por riesgo, Engram, roadmap diferido. |

## Shared Configs

| Name | Path | Purpose |
|------|------|---------|
| kanon-phase-common | `.claude/skills/_shared/kanon-phase-common.md` | Protocolo compartido fases SDD + Kanon (no parte del install global MCP genérico). |

## Project Conventions

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Descripción monorepo, paquetes, setup, MCP. |
