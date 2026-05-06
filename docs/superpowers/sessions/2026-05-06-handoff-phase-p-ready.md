# Vyntechs MVP — Handoff (2026-05-06, Phase Q merged; next pick = full Phase P)

Slim format per AGENTS.md. **Parallel session** — runs alongside Stage 2e (monorepo Stripe extraction) in `.claude/worktrees/monorepo-stage-1/`. Phase P doesn't touch Stripe; safe in parallel.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs` (main repo, **not** the worktree).
2. Read `AGENTS.md`. Read this handoff.
3. **Phase Q is on main** (PR #1 merged 2026-05-06 14:13:27 UTC, squash commit `77a1506`). Branch `feature/phase-p-curator` directly off `main`. The local `feature/phase-q-calibration` branch is stale — its commits were squashed into `77a1506`; safe to delete (`git branch -D feature/phase-q-calibration` after confirming no uncommitted work).
4. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **398/398** (385 prior + 13 from Q2/Q3/Q4), tsc clean, build clean. If red on the first run after a fresh shell, rerun once (vitest fork-pool flake on cold cache; per memory note).
5. Invoke `superpowers:using-superpowers` then `superpowers:brainstorming`. **Scope is decided: Brandon picked full Phase P — all 7 tasks** (P1 layout/role-gate, P2 deferred queue, P3 drift queue, P4 novel-pattern queue, P5 case detail view, P6 corpus authoring form, P7 calibration thresholds dashboard). Open design questions to resolve with Brandon before writing the plan:
   - **Drift alert lifecycle.** What states can a `drift_alerts` row be in? Just `applied` (curator clicked "apply") or also `dismissed` (curator declined)? Affects schema (`applied_at` + `dismissed_at` nullable cols, or single `resolution` enum) and the apply-action button(s) on the drift queue page.
   - **Apply-recommendation UX placement.** Separate "Drift queue" page (P3) with an apply button per row, OR merged into "Calibration thresholds" dashboard (P7) showing current value + recommended side-by-side? Brandon's UX preference matters — he's the sole curator at MVP.
   - **Curator-authored corpus entries** (P6). Plan uses synthetic `'00000000-...'` UUIDs for `sourceSessionId`/`sourceShopId` (passes FK because there's no constraint enforcement on those values). Cleaner option: relax both FKs to nullable in a small migration. Pick before P6 implementation.
6. After brainstorm → spec doc (`docs/superpowers/specs/2026-05-06-phase-p-curator-design.md`) → Brandon review → `superpowers:writing-plans` → `superpowers:executing-plans`.

## State

- **Production:** `vyntechs.dev` → `main` head `77a1506`. Phase Q live in code; cron registered for next Monday 06:00 UTC.
- **Stage 2e (parallel session):** migration session is extracting Stripe code. **Do NOT touch:** `lib/stripe*`, `app/api/stripe/*`, `app/api/checkout/*`, `lib/db/schema.ts` `stripeCustomers` table, anything under entitlements/billing. Phase P scope (curator console UI + drift dashboard) is fine.
- **Curator role provisioning:** no user has `role='curator'` on prod yet. Before testing the curator console end-to-end you'll need: `UPDATE profiles SET role='curator' WHERE user_id='<Brandon's auth UUID>'` via Supabase MCP `execute_sql`.
- **Backup tag:** `backup-2026-05-06-0920` exists on origin (Brandon's pre-Phase-Q-merge precaution). Untouched.

## What the prior session covered

1. **Phase Q complete** — finished Q2 (`lib/calibration/aggregate.ts`, pglite tests), Q3 (`app/api/cron/calibration-weekly/route.ts` + `lib/calibration/run-weekly.ts`, pglite tests), Q4 (`app/api/curator/calibration/refit/route.ts` + `lib/calibration/manual-trigger.ts`, pglite tests), Q5 (synthetic-data verification on prod Supabase, fully cleaned up). Migration `0010_drift_alerts` applied to prod via MCP; `vercel.json` cron registered (`0 6 * * 1`); Q1 (refit math) was already shipped at session start.
2. **Plan corrections callout** updated from "code not yet shipped" to "shipped 2026-05-06" with the file list of what landed.
3. **PR #1 opened and merged** (squash) — see merge commit `77a1506` on main.

## Phase P stale-plan items (the plan was written before Q's pivot — fix during execution)

- **P3 Step 1** — "Add a `drift_alerts` table" — already done in Phase Q. Skip. But the plan's column set includes `acknowledgedAt`; **Phase Q's actual table doesn't have it.** New migration `0011_*` adds whatever lifecycle column(s) Brandon picks during brainstorm.
- **P6 corpus authoring route** — plan code does `profiles.id = user.id` lookup; correct is `profiles.userId = user.id` (same bug fixed in Q4's manual-trigger handler — `profiles.id` is the row PK; the auth user maps via `userId`).
- **P7 dashboard** — under the passive redirected design, `last_refit_at` on `confidence_calibration` only stamps when curator clicks "apply" in the drift dashboard, not when the cron runs. The dashboard's "last refit" column should reflect that semantic.

## Carryovers (not Phase P scope; flag for future)

- **`ensureProfileAndShop` race condition** — pre-existing; one-line ON CONFLICT DO NOTHING fix. The migration session offered this as a 10-min quick-win PR off main. Coordinate so only one session takes it.
- **`TreeState` duplication** — pre-existing; resolves cleanly when Stage 2c merges (their prep commit `c68bf26` already addresses it).
- **Phase F a11y** — pre-existing; 2 unlabeled `OutcomeCapture` form fields. Fix when next touching Phase F.

## Migration coordination

Phase P touches `lib/db/schema.ts` (drift_alerts lifecycle column add) and `lib/db/queries.ts` (curator query helpers like `listDeferredSessions`). Both files reshape under Stage 2c → `packages/db/src/...` on the migration branch. Stage 2c is already shipped on their branch but not on main. Phase P's PR rebases as usual when it lands.

**Drizzle migration filenames:** Phase P owns `0011_*.sql` next. (Phase Q used `0010_drift_alerts.sql`.)

**Vercel projects:** diagnostic still ships through `vyntechs-dev` on the `feature/phase-X` → staging-rc → main → prod path.

Recommend `/clear` after `cd` and reading this handoff.
