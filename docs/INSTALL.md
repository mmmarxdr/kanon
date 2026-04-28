# Install

> For a one-command quick start, see the main [README](../README.md).
> This document covers advanced or non-default install paths.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) — the repo pins `pnpm@10.32.1`
- [Docker](https://www.docker.com/) — used for PostgreSQL by default

## Default install (recap)

```bash
git clone https://github.com/mmmarxdr/kanon.git
cd kanon
pnpm bootstrap
pnpm dev:start
```

> Note: do NOT run `pnpm setup` — it is a pnpm built-in that configures the
> shell PATH and does NOT execute a project script. Use `pnpm bootstrap`.

`pnpm bootstrap` does the following:

1. Preflight checks (Node 20+, pnpm, Docker).
2. Installs workspace dependencies.
3. Generates the Prisma client.
4. Runs database migrations.
5. Builds the `@kanon/mcp` and `@kanon-pm/setup` packages.

`pnpm dev:start` boots PostgreSQL (via Docker), the API, the web frontend,
and the Engram memory service.

## Running without Engram

If you do not need the semantic memory bridge:

```bash
pnpm dev:start -- --no-engram
```

## Running without the MCP package build

Useful when you are iterating only on the web or API and do not want the
MCP build step:

```bash
pnpm dev:start -- --no-mcp
```

## Using an external PostgreSQL

Set `DATABASE_URL` in `packages/api/.env` to point at your own Postgres
instance, then run:

```bash
pnpm --filter @kanon/api prisma:migrate:deploy
pnpm --filter @kanon/api build
pnpm --filter @kanon/api start
```

## Upgrading

After pulling new changes:

```bash
./scripts/upgrade.sh
```

## Releasing

```bash
./scripts/release.sh --dry-run patch  # preview
./scripts/release.sh patch            # patch release
./scripts/release.sh --push minor     # minor release + push
```
