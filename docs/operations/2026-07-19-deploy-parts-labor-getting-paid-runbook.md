# Deploy runbook — getting-paid + technician parts/labor to production

**Date:** 2026-07-19
**Branch:** `claude/handoff-opus-fable-strategy-zxe329` · **PR:** #175 (base `main`)
**Head at hand-off:** `ee31739`

This is the hand-off for a **local session** (with production credentials) to
ship the branch. Do the steps **in order**. The database step is manual and is
the one thing that will NOT happen on its own — read "Why the manual DB step".

---

## What ships

Five product areas, all additive, none of which touches existing data:

1. **Getting paid** — ring-out panel on the ticket: record cash/card/check/other,
   close & deliver when the balance clears. (advisor/owner only)
2. **The job clock** — tech clocks on/off a job; running total of actual time;
   works across many jobs at once.
3. **Found work → repair job** — "found another concern" now creates a real
   repair job for the advisor to quote (was a dead diagnostic job).
4. **Parts relay** — tech flags a part they need (what + brand/source + qty, zero
   money); it relays to the parts desk on the ticket to source + mark handled.
5. **(Earlier batch already in this PR)** tax/labor rate settings, honest
   case-close, vehicle history, supplier setup, parts markup + auto-price.

---

## Why the manual DB step (read this)

`npm run db:migrate` runs `drizzle-kit migrate`, which reads
`drizzle/migrations/meta/_journal.json` — **frozen at 0028**. Migrations
`0037`–`0041` are NOT in that journal, and **no CI or Vercel step applies them**.
So they must be run against the production database **by hand, once**. All five
are additive (new tables + new nullable columns, no backfill, no drops), so they
are safe to apply before the code goes live and they do not disturb anything
already running.

---

## Step 1 — Apply the 5 migrations to the PRODUCTION database, in order

Apply against the **production** Supabase database (the one the production Vercel
deployment uses — NOT the `vyntechs-dev` preview). Each file is plain SQL; the
`--> statement-breakpoint` lines are SQL comments and can be left in (or stripped,
as the tests do). Any of these work: Supabase SQL editor (paste the file), `psql
-f <file>`, or the Supabase MCP `apply_migration` (strip the breakpoint markers).

Run **in this order** — each is idempotent-safe to re-check first (see verify
queries in Step 1b):

| # | File | Adds |
|---|------|------|
| 1 | `drizzle/migrations/0037_shop_parts_markup.sql` | `shops.parts_markup_bps` (nullable column) |
| 2 | `drizzle/migrations/0038_shop_os_ticket_payments.sql` | `ticket_payments` table (server-only ACL) |
| 3 | `drizzle/migrations/0039_shop_os_job_work_clock.sql` | `ticket_jobs.work_started_at`, `work_completed_at` |
| 4 | `drizzle/migrations/0040_shop_os_job_time_clock_onoff.sql` | `ticket_jobs.clocked_on_since`, `active_seconds` |
| 5 | `drizzle/migrations/0041_shop_os_job_part_requests.sql` | `job_part_requests` table (server-only ACL) |

### Step 1b — Verify all five applied (copy-paste, expect all "true"/counts shown)

```sql
select
  -- 0037
  exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='shops' and column_name='parts_markup_bps') as m0037_col,
  -- 0038
  to_regclass('public.ticket_payments') is not null as m0038_table,
  (select count(*) from pg_policies where tablename='ticket_payments'
     and policyname='ticket_payments_server_only_deny_direct')::int as m0038_policy,
  (select count(*) from information_schema.role_table_grants
     where table_name='ticket_payments' and grantee in ('anon','authenticated'))::int as m0038_client_grants,  -- expect 0
  -- 0039
  (select count(*) from information_schema.columns where table_schema='public'
     and table_name='ticket_jobs' and column_name in ('work_started_at','work_completed_at'))::int as m0039_cols,  -- expect 2
  -- 0040
  (select count(*) from information_schema.columns where table_schema='public'
     and table_name='ticket_jobs' and column_name in ('clocked_on_since','active_seconds'))::int as m0040_cols,  -- expect 2
  -- 0041
  to_regclass('public.job_part_requests') is not null as m0041_table,
  (select count(*) from pg_policies where tablename='job_part_requests'
     and policyname='job_part_requests_server_only_deny_direct')::int as m0041_policy;
```

Expected: `m0037_col=true, m0038_table=true, m0038_policy=1, m0038_client_grants=0,
m0039_cols=2, m0040_cols=2, m0041_table=true, m0041_policy=1`.

> If some of these already show applied (e.g. `0037` shipped earlier), skip that
> file and apply only the missing ones — the changes are additive, but do not
> re-run a file whose objects already exist (it will error on "already exists").

---

## Step 2 — Merge PR #175 and let Vercel deploy

Only after Step 1b passes. Merge #175 into `main`; Vercel auto-deploys `main` to
production. Confirm the production deployment finishes green. (Order matters:
migrations first, then code — additive DB changes are backward-compatible, so old
code tolerates them until the new code is live.)

---

## Step 3 — Smoke-test the real signed-in app

This work was verified by TypeScript + unit tests + production build, but **not**
driven through a live authenticated session before now. Walk these once on
production:

- [ ] Sign in; open a ticket with an approved job.
- [ ] **Getting paid:** ring out — record a payment, watch the balance clear, close & deliver.
- [ ] **Clock:** open a job's work screen → Clock on → Clock off → Clock back on → running total updates; Complete work banks the time.
- [ ] **Found work:** "Found another concern" → a new repair job appears on the ticket, unassigned, awaiting a quote.
- [ ] **Parts relay:** "Parts I need" → flag a part (name + brand/source + qty) → it appears on the ticket under "Parts the tech asked for" → mark it Got it.
- [ ] No console/server errors on any of the above.

---

## Step 4 — Rollback (if needed)

- **Code:** revert the #175 merge (or redeploy the previous `main` in Vercel).
- **Database:** the new tables/columns are additive — old code ignores them, so
  they can safely **stay** after a code rollback; no destructive DB rollback is
  required. Only if you deliberately want them gone:
  `drop table if exists job_part_requests, ticket_payments;`
  `alter table ticket_jobs drop column if exists work_started_at, drop column if exists work_completed_at, drop column if exists clocked_on_since, drop column if exists active_seconds;`
  `alter table shops drop column if exists parts_markup_bps;`
  (Dropping loses any data recorded in them — only do this if you truly mean to.)

---

## Not in this deploy

- **Automatic parts pricing (PartsTech).** Gated on a partner application + linking
  the shop's O'Reilly/dealer accounts — see
  `docs/strategy/2026-07-19-parts-integration-partstech-checklist.md`. The parts
  relay above is the interim; when PartsTech is wired the flag becomes a priced pick.
