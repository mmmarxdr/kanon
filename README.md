# Kanon

**An opinionated, AI-native project management platform.**

![Version](https://img.shields.io/badge/version-0.2.0-blue)

## What is Kanon?

Kanon is a self-hosted project management tool designed to work seamlessly with AI coding agents. It provides a REST API, a web UI with kanban boards, and an MCP server that lets AI assistants like Claude create and manage issues directly. Built as a TypeScript monorepo, it runs locally with PostgreSQL.

## Tech Stack

- **Runtime:** Node.js 20+, TypeScript
- **API:** Fastify 5, Prisma (PostgreSQL), Zod
- **Web:** React 19, Vite 6, TanStack Router + Query, Tailwind CSS 4, Zustand
- **MCP:** Model Context Protocol SDK
- **Testing:** Vitest, Playwright (E2E), Testing Library
- **Monorepo:** pnpm workspaces

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) (the repo pins `pnpm@10.32.1`)
- [Docker](https://www.docker.com/) (for PostgreSQL)

## Quick Start

**1. Clone and install dependencies**

```sh
git clone <repo-url> kanon
cd kanon
pnpm install
```

**2. Start PostgreSQL**

```sh
docker compose up -d postgres
```

This starts PostgreSQL 16 on port 5432 with default credentials (`kanon`/`kanon`).

**3. Configure environment**

On first run, the dev script creates `packages/api/.env` from `.env.example` automatically. To do it manually:

```sh
cp packages/api/.env.example packages/api/.env
```

The defaults work out of the box for local development.

**4. Start the dev environment**

The easiest way to get everything running:

```sh
pnpm dev:start
```

This single command will:
- Verify prerequisites (Node, pnpm, Docker)
- Start PostgreSQL via Docker Compose
- Install dependencies and generate the Prisma client
- Run pending database migrations
- Seed the database with dev data
- Start the API server (port 3000) and web dev server (port 5173)

**5. Open the app**

Navigate to [http://localhost:5173](http://localhost:5173) and log in with:

| Field     | Value         |
|-----------|---------------|
| Workspace | `kanon-dev`   |
| Email     | `dev@kanon.io`|
| Password  | `Password1!`  |

To stop all services, press `Ctrl+C` in the terminal or run `pnpm dev:stop`.

### Manual setup (alternative)

If you prefer to run steps individually:

```sh
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Seed the database
pnpm db:seed

# Start API server (port 3000)
pnpm dev

# In a separate terminal, start the web app (port 5173)
pnpm dev:web
```

## Project Structure

| Package | Path | Description |
|---------|------|-------------|
| `@kanon/api` | `packages/api` | REST API server (Fastify, Prisma) |
| `@kanon/web` | `packages/web` | Web frontend (React, Vite) |
| `@kanon/mcp` | `packages/mcp` | MCP server for AI agent integration |
| `@kanon/cli` | `packages/cli` | CLI tool |
| `@kanon/bridge` | `packages/bridge` | Shared types and contracts |
| `@kanon/e2e` | `packages/e2e` | End-to-end tests (Playwright) |

## Development

### Common commands

```sh
# Start everything (recommended)
pnpm dev:start

# Run API unit/integration tests
pnpm --filter @kanon/api test

# Run web unit tests
pnpm --filter @kanon/web test

# Run all tests (API + Web + E2E)
pnpm test:all

# Run E2E tests
pnpm e2e

# Open Prisma Studio (database browser)
pnpm db:studio

# Create a new migration
pnpm --filter @kanon/api db:migrate:dev

# Build all packages
pnpm build
```

### Dev start options

```sh
pnpm dev:start                # Start everything (API + Web + Engram + MCP)
pnpm dev:start -- --no-engram # Skip Engram memory service
pnpm dev:start -- --no-mcp    # Skip MCP package build
```

## Upgrading

After pulling new changes:

```sh
./scripts/upgrade.sh
```

This idempotent script handles:
- Installing updated dependencies (skips if lock file unchanged)
- Regenerating the Prisma client
- Running pending database migrations
- Checking for missing environment variables

Use `--quiet` to suppress success messages.

## AI Tool Setup

Kanon integrates with AI coding tools via MCP (Model Context Protocol), global skills, and workflow triggers. The `@kanon-pm/setup` package auto-detects installed tools and configures them.

**Supported tools:** Claude Code, Cursor, Antigravity

### Install (any project)

```sh
# Interactive — detect tools and select from a list
npx @kanon-pm/setup

# Configure all detected tools at once
npx @kanon-pm/setup --all

# Configure a specific tool
npx @kanon-pm/setup --tool claude-code
npx @kanon-pm/setup --tool cursor
npx @kanon-pm/setup --tool antigravity

# Remove kanon from a specific tool
npx @kanon-pm/setup --remove --tool cursor

# Remove kanon from all tool configs
npx @kanon-pm/setup --remove --all
```

### Install (monorepo developers)

If you are working inside the Kanon monorepo, you can also use:

```sh
pnpm setup:mcp            # same options as above
```

The installer authenticates against the API, generates an API key, and merges the MCP configuration into each tool's config file (preserving existing entries). It also installs global skills and workflow triggers. Restart your AI coding tool afterward to pick up the new configuration.

## Releasing

Maintainers can create releases using the release script:

```sh
# Preview what would happen
./scripts/release.sh --dry-run patch

# Create a patch release (0.1.0 -> 0.1.1)
./scripts/release.sh patch

# Create a minor release (0.1.0 -> 0.2.0)
./scripts/release.sh minor

# Create and push
./scripts/release.sh --push patch
```

The script bumps versions across all packages, updates `CHANGELOG.md`, creates a git commit, and tags the release. It requires a clean working tree and passing tests.

## AI Coding Tools

Kanon supports multiple AI coding tools via standardized instruction files:

- **AGENTS.md** -- project instructions for tools that support it (Codex, OpenCode, Gemini CLI, and others)
- **CLAUDE.md** -- Claude Code project instructions and development skills
- **.claude/skills/** -- Claude Code skills for kanon development

Run `npx @kanon-pm/setup` (or `pnpm setup:mcp` inside the monorepo) to configure MCP, global skills, and workflows.

### Skills and Workflows

The installer places Kanon skills and workflow triggers globally for each configured tool. This means the kanon MCP tools are available from any project, not just this repo.

| Skill | What it does |
|-------|-------------|
| `kanon-init` | Scan codebase, create project, seed issues and roadmap items |
| `kanon-create-issue` | Create a Kanon issue from a natural language description |
| `kanon-roadmap` | Capture deferred work as roadmap items |

Global install locations per tool:

| Tool | Skills | Workflows |
|------|--------|-----------|
| Claude Code | `~/.claude/skills/kanon-*/` | (skills are the commands) |
| Antigravity | `~/.gemini/antigravity/skills/kanon-*/` | `~/.gemini/antigravity/global_workflows/kanon-*.md` |
| Cursor | `~/.cursor/skills/kanon-*/` | `~/.cursor/commands/kanon-*.md` |
| Windsurf | (not supported) | `~/.codeium/windsurf/global_workflows/kanon-*.md` |
| OpenCode | `~/.config/opencode/skills/kanon-*/` | (skills are discoverable) |

To remove skills and workflows along with MCP config: `npx @kanon-pm/setup --remove --all`

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass: `pnpm test:all`
4. Submit a pull request

## License

This project does not yet have a published license. All rights reserved.
