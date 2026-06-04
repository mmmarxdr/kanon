# Local DB Safety — Migrations & the Dogfooding Board

**Why this doc exists:** on 2026-06-04, `prisma migrate reset --force` against the
local dev DB (`localhost:5432/kanon`) **destroyed the Kanon dogfooding board** —
the `KAN` project (~49 issues, 11 roadmap items, cycles) that the Kanon MCP
manages. Root cause chain below. This doc encodes the rules that prevent a repeat.

## The trap

The Kanon MCP (`kanon_*` tools) is configured with `KANON_API_URL=http://localhost:3000`
— it manages the board on the **same local dev database** the app builds against.
So **any destructive Prisma op on the dev DB also destroys the project board.**
`seed.ts` only restores ~13 *demo* issues — never the real accumulated board.

## Rules (MANDATORY)

1. **NEVER edit a migration that has already been applied.** Create a NEW migration
   instead (`pnpm --filter @kanon/api db:migrate:dev --name <change>`). Editing an
   applied migration causes Prisma drift, and the "fix" for drift is a destructive
   `migrate reset`. The 2026-06-04 loss was caused by an agent editing an applied
   migration to add a seed `INSERT` — a new migration would have avoided the reset
   entirely.

2. **DUMP before any reset.** If a reset is truly unavoidable, run
   `bash scripts/backup-local-db.sh` FIRST. Restore with
   `psql "$DATABASE_URL" < .db-backups/kanon-<ts>.sql`.

3. **`migrate reset` / `migrate dev --reset` are destructive and dev-only.** They are
   NEVER run on the dev box or prod — those use `prisma migrate deploy` (forward-only,
   additive, runs automatically in the api container `CMD`). Production data is never
   destroyed by deploys.

4. **Before assuring "safe to reset", check what else lives on the DB.** The tell here
   was the Kanon MCP pointing at `localhost:3000`. If the dogfooding board (or any data
   you care about) is on the target DB, treat the reset as destructive to that data.

## Recommended hardening (follow-up)

- **Separate the dogfooding board from the resettable dev DB.** Run the board's Kanon
  instance against its own database (e.g. `kanon_pm`) so feature-dev resets can't touch
  it. Tracked as a follow-up issue.
- Consider a pre-`migrate reset` git-hook / wrapper that auto-runs `backup-local-db.sh`.

## Migration cheat-sheet

| Intent | Command | Destructive? |
|--------|---------|--------------|
| Add a schema change (local) | `db:migrate:dev --name <x>` (creates NEW migration) | No (additive) |
| Apply pending migrations (box/prod) | `db:migrate` (= `migrate deploy`) | No (forward-only) |
| Rebuild local DB from scratch | `migrate reset` | **YES — dump first** |
| Fix drift from an edited applied migration | *don't* — make a new migration instead | — |
