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
  current order; update this skill if the workflow changes.
- Use Node 24, the repository-pinned pnpm, and PostgreSQL 16.
- Stop on the first failure, fix the root cause, then restart from the affected
  setup boundary. Never report a partial run as green CI.
- Preserve unrelated worktree changes. Never reset or clean files you did not
  create.

## Environment

Provide a healthy PostgreSQL instance on port 5432 with user/password `kanon`
and database `kanon_e2e`, then export the CI environment:

```bash
export DATABASE_URL='postgresql://kanon:kanon@localhost:5432/kanon_e2e?schema=public'
export JWT_SECRET='ci-test-jwt-secret'
export JWT_REFRESH_SECRET='ci-test-jwt-refresh-secret'
export NODE_ENV='test'
export PORT='3001'
export SKIP_DND='true'
```

## Execution

Run the workflow commands in order:

```bash
pnpm install --frozen-lockfile
pnpm --filter @kanon/api db:generate
pnpm --filter @kanon/api exec prisma migrate deploy
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=true pnpm --filter @kanon/api db:seed
pnpm --filter @kanon/shared build
pnpm lint
pnpm format:check
pnpm --filter @kanon/api exec tsc --noEmit
pnpm --filter @kanon/web typecheck
pnpm --dir packages/e2e exec tsc --noEmit
pnpm --filter @kanon/mcp exec tsc --noEmit
pnpm --filter @kanon/api test:coverage
pnpm --filter @kanon/web test
pnpm --filter @kanon/mcp test
pnpm --filter @kanon/shared test
pnpm --filter @kanon-pm/setup test
pnpm --filter @kanon/cli test
pnpm --filter @kanon/e2e exec playwright install chromium --with-deps
CI=true API_PORT=3001 WEB_PORT=5174 pnpm --filter @kanon/e2e exec playwright test
pnpm --filter @kanon-pm/setup build
bash packages/setup/scripts/verify-assets.sh
bash packages/setup/scripts/smoke-install.sh
```

If local privilege policy blocks Playwright OS dependency installation, run
`playwright install chromium`, execute the full E2E suite, and report the
`--with-deps` deviation explicitly. It is not an application failure.

## Output

Return the candidate identity (commit SHA, or HEAD plus dirty diff summary),
environment deviations, each stage result, test totals, and final verdict:
`PASS`, `FAIL`, or `BLOCKED_BY_LOCAL_INFRASTRUCTURE`.
