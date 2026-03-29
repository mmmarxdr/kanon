# Kanon

Kanon is an opinionated, AI-native project management platform. TypeScript monorepo with pnpm workspaces.

## Tech Stack

TypeScript, Node 20+, pnpm workspaces. Fastify 5 API with Prisma (PostgreSQL), React 19 web frontend (Vite, TanStack Router/Query, Tailwind CSS 4), MCP server for AI agent integration, Vitest for testing.

## Full Context

See `AGENTS.md` for complete project instructions, package details, conventions, and development setup.

## MCP Tools

Kanon MCP tools (`kanon_*`) are available for project management: creating/updating issues, managing boards, tracking roadmap items, and querying project state. Run `pnpm setup:mcp` to configure.

## Skills

Portable skills are available in `.agent/skills/`:

| Skill | When to use |
|-------|-------------|
| kanon-init | Project onboarding, scanning codebase, seeding issues |
| kanon-nl-create | Natural language issue creation ("create an issue", "log a bug") |
| kanon-mcp | Issue management, board operations, state transitions |
| kanon-roadmap | Capturing deferred work and future ideas |
| kanon-orchestrator-hooks | SDD phase launches with roadmap integration |

Workflows are in `.agent/workflows/`.
