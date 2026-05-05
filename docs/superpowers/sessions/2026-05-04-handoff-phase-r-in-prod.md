# Vyntechs MVP — Handoff (2026-05-04, Session 4: phase-r check-back validated on RC then shipped to prod)

Supersedes `2026-05-04-handoff-check-back-gaps-closed.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs` (main worktree).
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if next session touches UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **347/347**, tsc + build clean.
4. **Production at `vyntechs.dev` is on `main` head `72e74c9`** — phase-r check-back is live. Smoke confirmed.
5. Plan-tree feature on `feature/phase-o-counter-02-03` head `4e189df` is unchanged. Session 5 = its tier-2 RC.

## State

- **Production:** `vyntechs.dev` → `vyntechs-i38t9bzxx-…vercel.app` → `main` head `72e74c9` (merge of `feature/phase-r-comeback`).
- Staging aliases unchanged: `staging-vyntechs.vercel.app` → check-back feature branch (now redundant — phase-r is in prod), `staging-plantree.vercel.app` → plan-tree branch, `staging-rc.vercel.app` → `rc-check-back` (also now redundant — that RC validated this prod ship).
- `CRON_SECRET` confirmed working on Production scope (curl 200 with bearer / 403 without on `vyntechs.dev/api/cron/comeback-prompts-daily`).
- `follow_ups` table on live: empty post-validation (test row inserted + Held + deleted on both staging-rc and prod).
- Local rc-check-back worktree at `.claude/worktrees/rc-check-back` is now disposable (its branch `rc-check-back` was the integration test for this ship).

## What this session covered (Session 4)

1. **Tier-2 RC validation** of phase-r check-back:
   - Created `rc-check-back` worktree off `origin/main` at `d7747d7`.
   - `vercel link --project vyntechs-dev --yes` (avoided creating a stray project).
   - `git merge --no-ff feature/phase-r-comeback` → merge commit `e6c98b2`. Zero conflicts.
   - 347/347 tests, tsc + build clean.
   - Pushed → Vercel auto-built (39s) → `vercel alias set staging-rc.vercel.app` (alias created on first run).
   - Walked full validation matrix on `staging-rc` (all green — see "Validation matrix" below).

2. **Prod ship.** From main worktree: `git merge --no-ff feature/phase-r-comeback` → merge commit `72e74c9`. Pushed → prod auto-deployed in ~3 min → `vyntechs.dev` live with phase-r.

3. **Prod smoke** (5 min) — see "Validation matrix" below. All green.

## Validation matrix (passed on `staging-rc.vercel.app` then re-passed on `vyntechs.dev`)

- Sign-in as `angelmoralesj@yahoo.com` / `Angelsoccer02` → `/today` ✓
- Empty `/today` shows 0 modules (no Queued module — Session 3's `b5a5812` survived merge); copy: "No sessions yet. Start a new diagnosis to begin." ✓
- Test follow-up `00000000-…-5c4b` inserted via Supabase MCP for Angel against Brandon's session `365ce29f` (FK across techs allowed; query filters by Angel's tech_id) ✓
- Reload → Check-ins panel renders: "2013 ford f150 · 7-DAY CHECK-IN", case description, Held / Came back buttons, VIEW CASE link, optional notes textbox ✓
- Held click → POST `/api/follow-ups/[id]/resolve` 200 → `router.refresh()` → Check-ins panel cleared → empty-state returns ✓
- DB row post-Held: `resolved_at` filled, `comeback_recorded=false`, notes saved — verified via Supabase MCP ✓
- Cron `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/comeback-prompts-daily` → **200** `{"surfaced":0}` ✓
- Cron without bearer → **403** `{"error":"forbidden"}` ✓
- Regression: `/sessions`, `/sessions/new`, `/billing` — **0** console errors / **0** warnings on both staging-rc and prod ✓
- `/intake` → 404 on prod (signed in), 200/render on staging-rc — **gate working as designed**: `app/(app)/intake/layout.tsx` calls `notFound()` when `isDesktopIntakeEnabled()` is false; `NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED` is only set on Preview scope. File unchanged from `d7747d7`, so this is pre-existing intended behavior, not a phase-r regression. Plan-tree (Session 5) will set the env var on Production. ✓
- Mobile (390×844 emulated, dpr 3) on **both** staging-rc and prod: empty + populated states render cleanly, Check-ins panel + Held/Came back/VIEW CASE buttons fit, primary CTA reachable, 0 console errors ✓
- **Lighthouse desktop on `staging-rc`/today: 100/100/100** (43/0); **Lighthouse desktop on `vyntechs.dev`/today: 100/100/100** (48/0 — more audits because authenticated populated state vs empty). a11y / best-practices / SEO ✓
- Test row deleted post-validation on both surfaces (`follow_ups` row count back to 0 each time) ✓

### Prod-readiness gap closure (post-smoke audit)

After the initial smoke I held myself to "every concern → a verification" before committing the handoff. Four gaps closed on prod:

- **Came back path** — earlier prod smoke only clicked Held. Inserted second test row, clicked Came back on prod with notes "Came back — left fuel cap loose, replaced". DB row: `resolved_at` filled, **`comeback_recorded=true`** ✓ (Held writes `false`; Came back writes `true` — different code branch validated.)
- **Cron with a real surfaceable row** — earlier cron smoke returned `{"surfaced":0}` because nothing was due-and-unsurfaced. Inserted row with `due_at = now() - 1 day` and `surfaced_at = NULL`, curled prod cron with bearer → **`{"surfaced":1}`**, post-cron `surfaced_at` was set to current time on the row ✓
- **Vercel cron registration** — `vercel.json` declares `0 14 * * *`. Verified Vercel actually picked it up: queried `https://api.vercel.com/v13/deployments/dpl_GCycYmNx4pwNLC9LLcWUGhQ66s8Q` (current prod), `.crons` field returns `[{path: "/api/cron/comeback-prompts-daily", schedule: "0 14 * * *"}]` ✓
- **`scheduleFollowUps()` fan-out** — exact INSERT pattern from `lib/comeback/schedule.ts` (2 rows, kind='7d'/'30d', dueAt=now+7/30d, surfaced/resolved/comeback all NULL) replicated against prod DB. Both rows inserted, `due_at` math correct (2026-05-12 / 2026-06-04), no unique-constraint blocker on (session_id, kind) ✓

All test rows cleaned up. `follow_ups` total back to 0.

## Carryovers (still apply)

- `/api/health` diagnostic still in repo — remove once corpus loop verified in prod (still pending; phase-r in prod doesn't affect this).
- Brand drift on `public/icons/icon.svg` (still amber `#F2A93B`) — separate cleanup task.
- Plan-tree carryovers from `2026-05-04-handoff-plan-tree-gaps-closed.md` still apply on `feature/phase-o-counter-02-03`.
- Favicon fix (plan-tree Session 2, commit `6efac97`) will arrive in main via Session 5's tier-2 RC merge.
- `staging-vyntechs.vercel.app` and `staging-rc.vercel.app` aliases now point at deployments whose code is in prod — they can be reassigned next time, no need to actively decommission.
- `rc-check-back` branch and worktree are disposable. Brandon can clean up or keep as reference.

## Next session (Session 5)

Same playbook for plan-tree, now off updated `main`:

1. `superpowers:using-git-worktrees off rc-plan-tree at origin/main` (path: `.claude/worktrees/rc-plan-tree`).
2. `cd` in, `vercel link --project vyntechs-dev --yes`.
3. `git merge --no-ff feature/phase-o-counter-02-03`. **Resolve conflicts** — main now has phase-r code (`comeback/*`, `follow-up-panel`, follow_ups migration); plan-tree branch has Counter 02/03/PlanTree + the `app/layout.tsx` v2.css imports. Conflicts likely in `app/layout.tsx` (both branches edit it) and possibly `app/(app)/today/page.tsx`.
4. `pnpm test` (expect 336/336 from plan-tree + the +11 from phase-r = 347/347; if any drop, that's a real regression), tsc, build.
5. `git push origin rc-plan-tree`. Set `vercel alias set <new-url> staging-rc.vercel.app` (overwrites previous RC alias).
6. Validation matrix on `staging-rc` per `2026-05-04-handoff-mid-validation-gap-list.md` § Tier-2 workflow + plan-tree-specific checks (intake desktop renders Counter 01 styled, Counter 02 line-remove recalculates, Counter 03 buttons disabled with title, mobile <1280 viewport-gate, /favicon.ico). Add: regression check on `/today` Check-ins panel still works.
7. On Brandon's go: `git checkout main && git merge --no-ff feature/phase-o-counter-02-03 && git push origin main`. Smoke prod 5 min.

Recommend `/clear` before starting Session 5.
