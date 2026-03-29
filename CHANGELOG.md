# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
