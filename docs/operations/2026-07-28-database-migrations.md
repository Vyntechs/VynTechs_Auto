# Database migrations

**Canonical procedure.** Supersedes the per-deploy manual steps in
`2026-07-19-deploy-parts-labor-getting-paid-runbook.md`, which remains as the
historical record of that deploy.

## What changed and why

Migrations here are written by hand and applied in filename order. Drizzle's
bookkeeping had stopped describing that reality:

- `drizzle/migrations/meta/_journal.json` was frozen at `0028`, so
  `drizzle-kit migrate` applied `0000`–`0028` and silently skipped the twenty
  migrations after it. A database built with it was twenty migrations behind
  and looked successful.
- The snapshot chain in `meta/` ends at `0011b` — eleven snapshots for
  fifty-one migrations — so `drizzle-kit generate` would diff against a schema
  that has not existed for a long time.
- Nothing recorded what a database had actually applied, so `0045` could be
  amended in place to add two indexes that `0047` already created. A rebuild
  from an empty database died there.

`scripts/db-migrate.mjs` replaces both commands. It applies the folder in
filename order and records each file in `public.schema_migrations` with a
checksum.

## Commands

| Command | What it does |
|---|---|
| `npm run db:status` | Read-only. Ledger state, pending files, drift. |
| `npm run db:migrate` | Applies pending files in order, each in its own transaction. |
| `npm run db:baseline -- --through <prefix>` | Records history **without executing it**, for a database whose schema is already ahead of its ledger. |

Each takes `--database-url <url>`, or falls back to `DATABASE_URL`. Add
`--production` to pull the production URL from Vercel instead. Always run
`db:status --production` before `db:migrate --production`.

## Three refusals

These are the point of the tool. Each one is covered by a test.

1. **An existing database with no ledger.** This is a database whose history
   nobody recorded, and applying to it would re-run migrations it already has —
   the worst thing this script could do. It refuses and directs you to
   `baseline`.
2. **An applied migration whose contents changed on disk.** This is exactly how
   the `0045`/`0047` duplicate indexes happened. It refuses and names the file.
3. **An applied migration that is gone from disk.** The folder and the database
   disagree about history; applying more cannot fix that.

## Standing up a new environment

```bash
createdb vyntechs_dev
psql vyntechs_dev -c 'create extension if not exists vector'
psql vyntechs_dev -c 'create schema if not exists auth'
# Supabase supplies auth.uid() and the anon/authenticated/service_role roles.
DATABASE_URL=postgres://…/vyntechs_dev npm run db:migrate
```

`tests/unit/migration-replay.test.ts` proves the folder applies cleanly from
empty on every test run, so this path stays honest.

## Adding a migration

Write the SQL by hand as `NNNN_snake_case_name.sql`, next in sequence. Do not
edit a migration that has been applied anywhere — add a new one. `db:status`
will catch it if you forget.

## Known state (2026-07-28)

Production was baselined through `0048`. The receipt: 63 tables before, 64
after, the only added table `schema_migrations`, application row counts
identical across `tickets`, `ticket_jobs`, `profiles`, `shops`, and
`customers`.

Production carries four columns' worth of schema with no source migration —
tables `knowledge_items` and `knowledge_item_vehicles`, and
`sessions.cache_hit_platform_id` / `sessions.cache_hit_symptom_id`. No
TypeScript in this repository references any of them, and nothing the
application uses is missing from the folder: a schema diff of a folder-built
database against production found **zero** columns present in production's
source-controlled surface that the folder could not produce. Dropping the dead
schema is destructive and remains an owner decision; nothing depends on it.

`drizzle-kit` is still used for its query builder and types. Its migration
journal and snapshots are no longer the source of truth and are left in place
only so the existing history is readable.
