# Development

Everything you need to build, test, and ship changes to Kanon.

## Common commands

```bash
pnpm dev:start                # start everything (API + web + Engram + MCP)
pnpm dev:start -- --no-engram # skip Engram memory service
pnpm dev:start -- --no-mcp    # skip MCP package build
pnpm test:all                 # run all tests (API + web + E2E)
pnpm e2e                      # E2E tests only
pnpm build                    # build every package
pnpm db:studio                # open Prisma Studio (database browser)
```

## Project layout

```
packages/
  api/      REST API — Fastify, Prisma, Zod
  web/      Web frontend — React 19, Vite, TanStack Router + Query
  mcp/      MCP server — @modelcontextprotocol/sdk
  cli/      Command-line tool
  bridge/   Shared types and contracts
  e2e/      End-to-end tests (Playwright)
  setup/    AI tool setup wizard
```

## Testing

- Unit tests live next to the code they test, named `*.test.ts`.
- E2E tests live in `packages/e2e` and run against a dev instance.
- Coverage is reported by Vitest; the API package enforces a threshold
  on `packages/api/src`.

Run a single package's tests:

```bash
pnpm --filter @kanon/api test
pnpm --filter @kanon/web test
```

## Releasing

```bash
./scripts/release.sh --dry-run patch   # preview
./scripts/release.sh patch             # create a patch release
./scripts/release.sh --push minor      # create and push a minor release
```

## Upgrading after pulling

```bash
./scripts/upgrade.sh
```

## Contributing workflow

1. Branch from `main`.
2. Make changes with tests.
3. Run `pnpm test:all`.
4. Open a PR referencing the issue it closes.

For contribution guidelines, read [CONTRIBUTING.md](../CONTRIBUTING.md).
