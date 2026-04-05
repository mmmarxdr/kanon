# Kanon

**An opinionated, AI-native project management platform.**

![Version](https://img.shields.io/badge/version-0.2.0-blue)

Kanon is a self-hosted project management tool designed to work seamlessly with AI coding agents. It provides a REST API, a web UI with kanban boards, and an MCP server that lets AI assistants create and manage issues directly. Built as a TypeScript monorepo, it runs locally with PostgreSQL.

## Quick Start

```bash
# 1. Clone and start
git clone https://github.com/mmmarxdr/kanon.git
cd kanon
pnpm install
pnpm dev:start    # starts PostgreSQL, API, web, and optionally Engram

# 2. Configure your AI tools
npx @kanon-pm/setup
```

Open [http://localhost:5173](http://localhost:5173) and log in with `dev@kanon.io` / `Password1!` (workspace: `kanon-dev`). The setup wizard auto-detects your tools and resolves credentials.

## AI Tool Setup

### What `npx @kanon-pm/setup` does

- Detects installed AI tools (Claude Code, Cursor, Antigravity)
- Presents an interactive checkbox to select which to configure
- Auto-resolves API credentials (from existing config, running API, or prompts you)
- Installs MCP server config, skills, templates, and workflows
- Works on Windows (PowerShell), WSL2, and Linux

### Usage examples

```bash
# Interactive (recommended)
npx @kanon-pm/setup

# Non-interactive (CI/scripting)
npx @kanon-pm/setup --yes

# Specific tool only
npx @kanon-pm/setup --tool claude-code

# With explicit credentials
npx @kanon-pm/setup --api-url http://localhost:3000 --api-key YOUR_KEY

# Remove Kanon from all tools
npx @kanon-pm/setup --remove --yes
```

### Supported Tools

| Tool | Platform | Status |
|------|----------|--------|
| Claude Code | WSL2, Linux | Supported |
| Cursor | Windows, WSL2, Linux | Supported |
| Antigravity | Windows, WSL2, Linux | Supported |

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) (the repo pins `pnpm@10.32.1`)
- [Docker](https://www.docker.com/) (for PostgreSQL)

## Tech Stack

- **Runtime:** Node.js 20+, TypeScript
- **API:** Fastify 5, Prisma (PostgreSQL), Zod
- **Web:** React 19, Vite 6, TanStack Router + Query, Tailwind CSS 4, Zustand
- **MCP:** Model Context Protocol SDK
- **Testing:** Vitest, Playwright (E2E), Testing Library
- **Monorepo:** pnpm workspaces

## Project Structure

| Package | Path | Description |
|---------|------|-------------|
| `@kanon/api` | `packages/api` | REST API server (Fastify, Prisma) |
| `@kanon/web` | `packages/web` | Web frontend (React, Vite) |
| `@kanon/mcp` | `packages/mcp` | MCP server for AI agent integration |
| `@kanon/cli` | `packages/cli` | CLI tool |
| `@kanon/bridge` | `packages/bridge` | Shared types and contracts |
| `@kanon/e2e` | `packages/e2e` | End-to-end tests (Playwright) |
| `@kanon-pm/setup` | `packages/setup` | AI tool setup wizard |

## Development

### Common commands

```bash
pnpm dev:start                # Start everything (API + Web + Engram + MCP)
pnpm dev:start -- --no-engram # Skip Engram memory service
pnpm dev:start -- --no-mcp    # Skip MCP package build
pnpm test:all                 # Run all tests (API + Web + E2E)
pnpm e2e                      # Run E2E tests only
pnpm build                    # Build all packages
pnpm db:studio                # Open Prisma Studio (database browser)
```

### Upgrading

After pulling new changes:

```bash
./scripts/upgrade.sh
```

### Releasing

```bash
./scripts/release.sh --dry-run patch   # Preview
./scripts/release.sh patch             # Create a patch release
./scripts/release.sh --push minor      # Create and push a minor release
```

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Ensure tests pass: `pnpm test:all`
4. Submit a pull request

## License

This project does not yet have a published license. All rights reserved.
