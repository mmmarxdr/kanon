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

## MCP Tools

Kanon MCP tools (`kanon_*`) are available for project management: creating/updating issues, managing boards, tracking roadmap items, and querying project state. These are configured globally via `pnpm setup:mcp` and work from any project.

## Skills

Kanon provides portable skills installed globally by `pnpm setup:mcp`. These work from any project where the Kanon MCP server is configured:

| Skill | When to use |
|-------|-------------|
| kanon-init | Project onboarding, scanning codebase, seeding issues |
| kanon-create-issue | Natural language issue creation ("create an issue", "log a bug") |
| kanon-roadmap | Capturing deferred work and future ideas |

Skills are installed to each tool's global directory (e.g., `~/.claude/skills/kanon-*/` for Claude Code, `~/.cursor/skills/kanon-*/` for Cursor). Workflow triggers are installed where supported.
