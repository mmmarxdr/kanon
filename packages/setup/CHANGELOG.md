# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
