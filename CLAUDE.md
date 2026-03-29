# Kanon

Kanon is an opinionated, AI-native project management platform. Monorepo with pnpm workspaces.

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| api | packages/api | REST API server (Node.js, TypeScript) |
| web | packages/web | Web frontend |
| mcp | packages/mcp | MCP server for AI agent integration |
| cli | packages/cli | CLI tool |
| bridge | packages/bridge | Bridge service |
| e2e | packages/e2e | End-to-end tests |

## Tech Stack

TypeScript, Node 20+, pnpm workspaces. See individual package.json files for framework details.

## Development Setup

pnpm install && pnpm dev

## Project Skills

Load these skills ON-DEMAND when their trigger matches. Do NOT load all skills upfront.

| Skill | Trigger | Path |
|-------|---------|------|
| kanon-roadmap | User defers work: "later", "someday", "down the road", "eventually", "not now"; out-of-scope items identified in any analysis | .claude/skills/kanon-roadmap/SKILL.md |
| kanon-init | "init project", "/kanon-init", new project onboarding | .claude/skills/kanon-init/SKILL.md |
| kanon-mcp | Issue creation, updates, board management, state transitions, SDD phase issue tracking | .claude/skills/kanon-mcp/SKILL.md |
| kanon-nl-create | Natural language issue description: "create an issue", "track this", "log a bug" | .claude/skills/kanon-nl-create/SKILL.md |
| kanon-orchestrator-hooks | Launching SDD phases (sdd-explore, sdd-propose, sdd-design, sdd-spec); processing phase results with deferred_items | .claude/skills/kanon-orchestrator-hooks/SKILL.md |
