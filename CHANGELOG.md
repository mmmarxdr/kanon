# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-04-28

### Added

- `@kanon-pm/setup` — standalone npm package for AI tool configuration, replaces `setup-mcp.sh`
- kanon-orchestrator-hooks promoted to product skill (5 product skills total)
- `npx @kanon-pm/setup <kanon://...>` URL onboarding flow — paste a `kanon://` invite link to configure credentials and MCP entry in one step.
- `npx @kanon-pm/setup login` re-auth subcommand — refresh credentials without re-running full setup.
- Credential store adapter (Linux/WSL2 file implementation) — stores refresh tokens at `~/.kanon/credentials` with `0o600` permissions; atomic write via temp-file + rename.
- MCP wrapper binary `kanon-mcp-wrapper` — exchanges a stored refresh token for a short-lived access token before spawning the MCP server; legacy `KANON_API_KEY` env var bypasses exchange for backward compat.

### Added (API)

- `POST /api/workspaces/:wid/invites/onboarding` — admin-only; issues a single-use `kanon://` invite link with configurable TTL (default 72 h).
- `POST /api/auth/onboard` — validates onboarding JWT, marks invite consumed (atomic), issues opaque refresh token.
- `POST /api/auth/exchange` — exchanges opaque refresh token for a short-lived access JWT.
- `POST /api/auth/refresh-issue` — issues a new refresh token for a renewed credential cycle.

### Added (DB)

- `RefreshToken` table — stores SHA-256 hash of opaque token, `userId`, `workspaceId`, `source` (`ONBOARDING | LOGIN`), `expiresAt`, `revokedAt`, `lastUsedAt`.
- `WorkspaceInvite.kind` column (`InviteKind` enum: `MEMBER | ONBOARDING`) with default `MEMBER`.
- `WorkspaceInvite.consumedAt` column — set atomically on first onboard redemption.
- `InviteKind` and `RefreshSource` Prisma enums.

### Added (Web)

- "Onboard" button in workspace settings → members section — visible to admins only.
- `<OnboardingLinkModal>` — displays the generated `kanon://` URL, copy-to-clipboard, expiry countdown, single-use warning.

### Added (Roadmap)

- macOS Keychain adapter for credential store.
- Windows Credential Manager adapter for credential store.
- OS-level URL handler for `kanon://` links (register `kanon://` as a system protocol).
- SSO / OAuth login flow for enterprise setups.
- Active-sessions admin UI — list and revoke issued refresh tokens.
- Multi-server-per-machine support in credential store.

### Backward Compatibility

- Existing `--api-url` / `--api-key` CLI flags and static `KANON_API_KEY` env var still work unchanged.
- Existing register / login / cookie session flow untouched.

### Fixed

- Dockerized Engram — upgraded to golang:1.23, improved error visibility, retry window 10s → 60s, ENGRAM_URL derived from ENGRAM_PORT
- Idempotent installs — legacy "kanon" MCP key cleanup, stale skill/workflow file removal

### Changed

- `release.sh` includes `packages/setup` in version bumps
- `pnpm setup:mcp` now delegates to `@kanon-pm/setup`; `setup-mcp.sh` deprecated with warning

## [0.3.0] - 2026-04-28

### BREAKING

- MCP write tools now default to `ack` tier responses; pass `format:"full"` to restore prior raw entity behavior.

### Added

- `keys[]` filter on `kanon_list_issues` — fetch specific issues by key without a full list scan.
- `attachIssueKeys` on `kanon_create_cycle` — atomically create a cycle and attach issues in one call.
- `includeAllScopeEvents` on `kanon_get_cycle` — opt in to the full event log (default: last 20).
- Batch-transition by issue keys via `kanon_batch_transition` (new `keys[]` mode, XOR with `groupKey`).
- Ack-tier responses across all 17 write tools (`issue-write`, `transition`, `batch-transition`, `cycle-create`, `cycle-attach`, `cycle-close`, `roadmap-write`, `project-write`, `comment-write`, `dependency-write`, `work-session`).

### Changed

- Tool description sizes reduced ~30% across all 29 MCP tools.
- Cycle attach is now atomic — `attachIssueKeys` rolls back if any key is invalid.
- `kanon_close_cycle` returns minimal ack `{cycleId, disposition, movedIssueKeys}` by default; pass `format:"full"` for the full cycle entity.

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
