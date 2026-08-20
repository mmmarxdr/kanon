---
name: kanon-pre-pr
description: "Reproduce Kanon's GitHub Actions CI locally before a pull request. Trigger: pre-PR, ready to push, run CI locally, verify before review."
license: Apache-2.0
metadata:
  author: kanon-maintainers
  version: "1.0"
---

# Kanon Pre-PR

## Contract

- `.github/workflows/ci.yml` is authoritative. Read it first and follow its
  current lane mapping; update this skill if the workflow changes.
- Use Node 24, the repository-pinned pnpm, and PostgreSQL 16.
- Quality, API coverage, Web, package, E2E, and setup are six independent
  required lanes. GitHub may run them in parallel because their runners are
  isolated. All six must pass before the aggregate `Test` gate can pass.
- Stop a local lane on its first failure, fix the root cause, then restart from
  that lane's setup boundary. Never report a partial run as green CI.
- Preserve unrelated worktree changes. Never reset or clean files you did not
  create.

## Environment

Export the CI environment for every lane:

```bash
export CI='true'
export DATABASE_URL='postgresql://kanon:kanon@localhost:5432/kanon_e2e?schema=public'
export JWT_SECRET='ci-test-jwt-secret'
export JWT_REFRESH_SECRET='ci-test-jwt-refresh-secret'
export NODE_ENV='test'
export PORT='3001'
export SKIP_DND='true'
```

Only the `API coverage` and `E2E tests` lanes need PostgreSQL. For either one,
provide a healthy PostgreSQL 16 instance on port 5432 with user/password
`kanon` and database `kanon_e2e`. CI gives each lane its own service. Locally,
run those lanes sequentially or give them separate databases: E2E performs a
destructive reset and must never share the same local database concurrently
with API coverage.

## Execution

CI repeats this setup independently for every lane:

1. `actions/checkout@v6`.
2. `pnpm/action-setup@v6` using the repository-pinned pnpm.
3. `actions/setup-node@v6` with Node 24 and the pnpm cache.
4. `pnpm install --frozen-lockfile`.

The local equivalent starts with:

```bash
pnpm install --frozen-lockfile
```

When reproducing a single lane, do not rely on outputs produced by another
lane. A complete local run may reuse one unchanged install, but must run every
lane-specific prerequisite below. Do not run lanes concurrently in one local
checkout because Prisma generation and shared/setup builds write outputs; use
isolated checkouts and isolated databases, or run them sequentially.

### Quality and typechecks

```bash
pnpm --filter @kanon/api db:generate
pnpm --filter @kanon/shared build
pnpm lint
pnpm format:check
pnpm --filter @kanon/api exec tsc --noEmit
pnpm --filter @kanon/web typecheck
cd packages/e2e && npx tsc --noEmit
cd ../..
pnpm --filter @kanon/mcp exec tsc --noEmit
```

### API coverage

```bash
pnpm --filter @kanon/api db:generate
pnpm --filter @kanon/api exec prisma migrate deploy
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=true pnpm --filter @kanon/api db:seed
pnpm --filter @kanon/shared build
pnpm --filter @kanon/api test:coverage
```

### Web tests

```bash
pnpm --filter @kanon/shared build
pnpm --filter @kanon/web test
```

### Package tests

```bash
pnpm --filter @kanon/mcp test
pnpm --filter @kanon/shared test
pnpm --filter @kanon/cli test
```

### E2E tests

```bash
pnpm --filter @kanon/api db:generate
pnpm --filter @kanon/api exec prisma migrate deploy
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=true pnpm --filter @kanon/api db:seed
pnpm --filter @kanon/shared build
pnpm --filter @kanon/e2e exec playwright install chromium --with-deps
CI=true API_PORT=3001 WEB_PORT=5174 pnpm --filter @kanon/e2e exec playwright test
```

Keep both the explicit migrate/seed steps and Playwright's global setup, which
runs `prisma migrate reset --force` and seeds again. The reset is destructive.
Playwright starts the API and Web servers itself; do not override its configured
`workers: 1` behavior.

### Setup package smoke

Never run this lane against the developer's real home. Isolate it before the
frozen install so every setup-lane command observes the same clean environment:

```bash
setup_home="$(mktemp -d "${TMPDIR:-/tmp}/kanon-setup-home.XXXXXX")"
trap 'rm -rf "$setup_home"' EXIT
export HOME="$setup_home"
export XDG_CONFIG_HOME="$setup_home/.config"
mkdir -p "$XDG_CONFIG_HOME"

pnpm install --frozen-lockfile
pnpm --filter @kanon-pm/setup test
pnpm --filter @kanon-pm/setup build
bash packages/setup/scripts/verify-assets.sh
bash packages/setup/scripts/smoke-install.sh
```

The setup entrypoint must remain import-safe: importing `src/index.ts` must not
parse or dispatch commands or terminate the process. Direct CLI execution must
still parse commands normally. Treat either regression as a lane `FAIL`; never
retry with the real home or downgrade it to infrastructure-blocked.

If local privilege policy blocks Playwright OS dependency installation, run
`pnpm --filter @kanon/e2e exec playwright install chromium`, execute the full
E2E suite, and report the `--with-deps` deviation explicitly. It is not an
application failure.

The final GitHub Actions job named exactly `Test` runs under `always()` after
all six lanes. It is an aggregate gate, not another local command: every
dependency result must equal `success`; failed, cancelled, or skipped lanes
make it fail.

## Output

Return the candidate identity (commit SHA, or HEAD plus dirty diff summary),
environment deviations, each lane result, test totals, and final verdict:
`PASS`, `FAIL`, or `BLOCKED_BY_LOCAL_INFRASTRUCTURE`.
