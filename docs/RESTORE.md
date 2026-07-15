# Restoring Vyntechs from a Daily Backup

Plain-English steps for the worst-case scenario: production database is wiped, corrupted, or otherwise broken. You need to bring it back from a GitHub Actions backup artifact.

## What you have

- **Daily SQL dumps** stored as GitHub Actions artifacts on this repo. Each is a single `.sql.gz` file containing the entire database (schema + data).
- **90 days of retention** — every day's dump for the last 90 days is downloadable from the Actions tab.
- Every dump is created by the workflow at `.github/workflows/daily-db-backup.yml`.

## Step 1 — Find the backup you want

In the terminal:

```bash
gh run list --workflow=daily-db-backup.yml --repo Vyntechs/VynTechs_Auto --limit 30
```

You'll see a list with dates. Pick the run that's the latest one BEFORE whatever broke things (i.e., if you screwed it up at 3 PM today, restore from yesterday's run, not today's).

## Step 2 — Download that backup

```bash
gh run download <RUN-ID> --repo Vyntechs/VynTechs_Auto
```

This drops a folder called `vyntechs-db-backup-<run-id>/` containing one file like `vyntechs-2026-05-04-0700.sql.gz`.

## Step 3 — Decide where to restore TO

You have two options:

**Option A: Restore back to the same Supabase project** (after wiping or if Supabase already cleared it). This brings prod back exactly as of that backup.

**Option B: Restore to a fresh Supabase project**, then point the app at the new project. Useful if the old project is unreachable or you want to keep the broken one for forensics.

Either way, you need the `DATABASE_URL_DIRECT` for the destination (port 5432 direct, not the pooler — pg_restore needs session mode).

## Step 4 — Restore the dump

```bash
gunzip -c vyntechs-db-backup-*/vyntechs-*.sql.gz | psql "$DATABASE_URL_DIRECT"
```

This runs the SQL file against the destination database. The dump uses `--clean --if-exists` so it drops existing tables before recreating, which is what you want when restoring into an existing-but-broken DB. **If you're restoring into a populated DB you don't want to overwrite, stop and copy elsewhere first.**

Watch the output. There may be `NOTICE` messages about objects that don't exist — those are fine. Real errors will say `ERROR:`.

## Step 5 — Update Vercel env vars (only if you restored to a new project)

If you restored to a new Supabase project (Option B), update these on Vercel:

- `DATABASE_URL` — new project's pooler URL
- `DATABASE_URL_DIRECT` — new project's direct URL
- `NEXT_PUBLIC_SUPABASE_URL` — new project's URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Then redeploy production by pushing a no-op commit to `main`, or via Vercel dashboard.

## Step 6 — Sanity check

- Sign in to vyntechs.dev
- Check `/api/health` — should report `pingOk: true`
- Verify a known work order still exists in `/today`
- Verify assignments, quotes, and text work notes are readable
- Confirm the diagnostic release remains off

## Step 7 — Reconcile the no-media boundary before reopening

Operational object storage is intentionally absent in the current release.
Old database backups may restore dormant media metadata rows, but never media bytes.
Complete the Row 49 zero-media reconciliation before reopening the restored environment.

Do not create a storage bucket, restore historical objects, or treat the daily
database workflow as a media backup. If unexpected media bytes or a live media
dependency appears, keep the restored environment closed and escalate.

If something looks off, you can re-run the restore from a different (older) backup — they don't interfere with each other.

## How long does this take?

For a small dataset (a few MB compressed), under 5 minutes from "find the backup" to "site is back up." Most of that is waiting for `gh run download`. Actual restore is seconds.

## What this WON'T cover

- Data created **between** the last backup and the disaster. If the workflow runs at 7 UTC and you wipe the DB at 18 UTC, you lose 11 hours of work.
  - Mitigation: a more recent backup means less loss. The workflow can be triggered manually any time with `gh workflow run daily-db-backup.yml`.
  - For zero data loss, you'd need Supabase Pro + Point-in-Time Recovery ($100+/mo).
- Operational object storage. The current release intentionally has none, and the database backup is not a media backup.

## Testing the restore (recommended)

Untested backups aren't backups. Once a quarter:

1. Spin up a free Supabase project as a sandbox
2. Run the restore steps above against it
3. Verify the dump applies cleanly
4. Delete the sandbox project

Costs $0, takes ~15 minutes, and confirms backups still work before you actually need them.
