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

## Kanon MCP Tools

Kanon skills are installed globally via `pnpm setup:mcp`. They are available in any project. Run the setup script to configure your AI tool.

The `_shared/kanon-phase-common.md` in `.claude/skills/` is kanon-development-specific and is NOT part of the global install.
