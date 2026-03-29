# Kanon

Kanon is an opinionated, AI-native project management platform. TypeScript monorepo with pnpm workspaces.

## Tech Stack

TypeScript, Node 20+, pnpm workspaces. Fastify 5 API with Prisma (PostgreSQL), React 19 web frontend (Vite, TanStack Router/Query, Tailwind CSS 4), MCP server for AI agent integration, Vitest for testing.

## Development Setup

```sh
pnpm install && pnpm dev:start
```

This starts PostgreSQL (Docker), runs migrations, seeds the database, and launches the API (port 3000) and web app (port 5173).

## Packages

| Package | Path | Purpose |
|---------|------|---------|
| api | packages/api | REST API server (Fastify, Prisma) |
| web | packages/web | Web frontend (React, Vite) |
| mcp | packages/mcp | MCP server for AI agent integration |
| cli | packages/cli | CLI tool |
| bridge | packages/bridge | Shared types and contracts |
| e2e | packages/e2e | End-to-end tests (Playwright) |

## Conventions

- Monorepo managed with pnpm workspaces
- All packages use TypeScript with strict mode
- Tests: `pnpm --filter @kanon/api test` or `pnpm test:all`
- Database migrations: `pnpm --filter @kanon/api db:migrate:dev`
- Build all: `pnpm build`

## MCP Tools

This project has a Kanon MCP server (`packages/mcp`). Use `kanon_*` tools for project management: creating/updating issues, managing boards, tracking roadmap items, and querying project state.

Run `pnpm setup:mcp` to configure MCP for your AI coding tool.

## Skills

Skills provide specialized AI agent capabilities. They live in `.claude/skills/` (Claude Code) and `.agent/skills/` (Antigravity/Codex). Load on-demand when relevant:

| Skill | When to use |
|-------|-------------|
| kanon-init | Project onboarding, scanning codebase, seeding issues |
| kanon-mcp | Issue creation, board management, state transitions |
| kanon-nl-create | Natural language issue creation ("create an issue", "log a bug") |
| kanon-roadmap | Capturing deferred work and future ideas |
| kanon-orchestrator-hooks | SDD phase orchestration with Kanon integration |
