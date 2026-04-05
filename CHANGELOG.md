# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@kanon-pm/setup` — standalone npm package for AI tool configuration, replaces `setup-mcp.sh`
- kanon-orchestrator-hooks promoted to product skill (5 product skills total)

### Fixed

- Dockerized Engram — upgraded to golang:1.23, improved error visibility, retry window 10s → 60s, ENGRAM_URL derived from ENGRAM_PORT
- Idempotent installs — legacy "kanon" MCP key cleanup, stale skill/workflow file removal

### Changed

- `release.sh` includes `packages/setup` in version bumps
- `pnpm setup:mcp` now delegates to `@kanon-pm/setup`; `setup-mcp.sh` deprecated with warning

## [0.2.0] - 2026-03-29

### Added

- Multi-tool MCP setup (`pnpm setup:mcp`) — supports Claude Code, Cursor, Antigravity
- WSL auto-detection with Windows-side path resolution for desktop tools
- Global skill installation for all three supported tools
- Router template installation (CLAUDE.md snippet, .cursor/rules/kanon.mdc, GEMINI.md snippet)
- Portable skills in `packages/mcp/skills/` (kanon-init, kanon-create-issue, kanon-mcp, kanon-roadmap, kanon-orchestrator-hooks)
- Portable workflows in `packages/mcp/workflows/` for Antigravity
- Comprehensive README with setup and development guide
- Reworked kanon-init skill — 4-phase batch flow (Discover, Resolve, Seed, Report)

### Changed

- Centralized port configuration via env vars (KANON_API_PORT, KANON_WEB_PORT)
- Removed tool-specific files from repo — all installed globally by setup script
- Stripped setup script to 3 tested tools only (Claude Code, Cursor, Antigravity)

### Fixed

- CI: added packageManager field for pnpm/action-setup@v4
- CI: build bridge package before API typecheck
- CI: vite port flag not passed correctly to Playwright
- E2E: updated auth helpers for workspace-decoupled login (18/18 passing)
- E2E: aligned board count regex, added filter data-testid props
- E2E: fixed login error, board cards, comments, DnD test failures
- Web: login tests updated to spy on native fetch
- Null guard for engram search results in issue context
- setup-mcp.sh crash on second tool (bash arithmetic with set -e)
- Absolute node path in MCP configs for WSL compatibility
- Inline env vars for WSL MCP configs (env object doesn't cross WSL boundary)

## [0.1.0] - 2026-03-29

### Added

- Release script (`scripts/release.sh`) for version bumping, changelog updates, and git tagging
- Upgrade script (`scripts/upgrade.sh`) for post-pull dependency and migration management
- Migration tracking: Prisma migrations now committed to git
- Environment variable documentation (`packages/api/.env.example`)
- Activity tab for project activity feed
- SSE cookie authentication for events/sync endpoint
- Group assignment support in MCP skills

### Changed

- Refactored `scripts/dev-start.sh` to delegate dependency and Prisma steps to `scripts/upgrade.sh`

### Fixed

- FocusTrap crash on issue detail dialog
- 401 unauthorized error on events/sync endpoint
