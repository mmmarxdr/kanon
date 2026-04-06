# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-04-05

### Added
- Kanon sub-agent definition for AI tool delegation (Claude Code, Cursor, Gemini CLI)
- Agent installation support in `npx @kanon-pm/setup` (installs alongside skills)
- Issue lifecycle section in kanon-mcp skill (start_work → progress → done → stop_work)
- SessionStart and PreCompact hooks in kanon-orchestrator-hooks skill

### Changed
- Skills optimized: 57% token reduction (15,600 → 6,700 tokens) via Agent Skills frontmatter and removal of MCP-duplicated content
- Enriched MCP tool descriptions with usage hints (create_issue, transition_issue, update_issue, list_groups)

## [0.4.0] - 2026-04-05

### Added
- Interactive tool selection with `@inquirer/prompts` checkbox — zero-flag UX
- Smart auth cascade: flag > env > existing config > auto-generate (localhost) > interactive prompt
- `--yes`/`-y` flag for non-interactive CI/scripting mode
- Auto-generate API keys from running localhost Kanon API
- Extract existing auth from previously installed tool configs
- Auth source tracking — summary shows where URL and key came from
- Non-TTY detection — falls back to non-interactive mode automatically
- Platform label printed at startup (WSL2, Linux, Windows)

## [0.3.0] - 2026-04-05

### Added
- Cross-platform support: Windows native (PowerShell), WSL2 with remote tools, and Linux native
- Platform-aware tool detection with per-platform path resolution
- `PlatformContext` architecture — platform detected once at startup, injected everywhere
- `commandExists()` uses `where` on Windows, `which` on Linux/WSL
- 11 new tests for platform detection, MCP entry building, and cross-platform scenarios

### Changed
- Replaced `isWindowsNative` boolean with `Platform` enum (`win32 | wsl | linux`)
- Tool definitions now use per-platform path maps instead of single config paths
- `buildMcpEntry()` uses tri-branch logic (direct/wsl-bridge) based on `McpMode`
- `resolveMcpServerPath()` uses `fileURLToPath()` for Windows path compatibility

### Removed
- Legacy `isWindowsNative`, `wslDetect`, `SetupOptions` types and overloaded function signatures

## [0.2.0] - 2026-03-28

- Initial release
