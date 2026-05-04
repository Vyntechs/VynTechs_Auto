# Vyntechs MVP — Handoff (2026-05-04, check-back gaps closed, ready for tier-2 RC)

Companion to `2026-05-04-handoff-mid-validation-gap-list.md` (now both feature branches GAPS-CLOSED) and `2026-05-04-handoff-plan-tree-gaps-closed.md` (Session 2 result on the plan-tree branch). Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/phase-r-comeback` (note: `.worktrees/`, not `.claude/worktrees/` — both paths work, branch is what matters)
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if next session touches UI.
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **347/347** tests, tsc clean, build clean.
4. Check-back feature on `feature/phase-r-comeback` at head `f1ad0a0` is **GAPS-CLOSED** + validated on `staging-vyntechs.vercel.app`. Ready for Session 4 (tier-2 RC).
5. Plan-tree feature on `feature/phase-o-counter-02-03` head `42f1824` still GAPS-CLOSED from Session 2 — Session 5 territory.

## State

- Production at `vyntechs.dev` unchanged on `main` (head `d7747d7`).
- Staging aliases: `staging-vyntechs.vercel.app` → check-back at `vyntechs-kmhi6vglg-…` (head `f1ad0a0`). `staging-plantree.vercel.app` → plan-tree (unchanged).
- `staging-rc.vercel.app` not yet provisioned (Session 4).
- **`CRON_SECRET` now set on Preview AND Production** scopes via `vercel env add`. Curl-test confirmed: bearer → 200 + `{"surfaced":N}`, no auth → 403 + `{"error":"forbidden"}`. Secret stored at `/tmp/vyntechs-cron-secret.txt` (gitignored, dev box only).
- Stray `phase-r-comeback` Vercel project (accidentally created during link) was removed via `vercel project rm` — no deployments lost.

## What this session covered (Session 3)

Three check-back gaps closed:

1. **Today-home Queued module removed.** Investigation revealed the original gap framing was wrong: `today-home.tsx` already rendered Check-ins between In-progress and Queued correctly. The actual bug was that `app/(app)/today/page.tsx` hardcoded `queued={[]}` since Phase E launch (commit `a4b33e6`). With Brandon's confirmation, removed the empty Queued module entirely from `TodayHome`, the today page, the design fixture (`app/design/page.tsx`), and the SessionRow `kind` union. Honest design now: 3 modules (In-progress, Check-ins, Closed today) — the empty-state copy updated from "No sessions queued" to "No sessions yet". 3 new tests in `tests/unit/today-home.test.tsx` pin the order and the absence of the Queued module.

2. **`CRON_SECRET` set on Preview + Production.** `vercel env add CRON_SECRET preview "" --value <random> --yes` and same for production. The empty `git-branch` arg (`""`) is required when adding to a scope without pinning a branch — without it the CLI bails out with a JSON hint instead of prompting interactively. Curl-test confirmed both auth paths after each redeploy.

3. **Held button validated end-to-end.** Inserted test follow-up `aaaaaaaa-…` for Angel's tech_id attached to one of Brandon's closed sessions (FK across techs is allowed, the `listDueFollowUpsForTech` query filters by `eq(followUps.techId, …)`). Signed in as Angel on staging, panel rendered, typed a note, clicked Held. DB row updated correctly: `resolved_at` filled, `comeback_recorded=false`, notes saved. Test row deleted. The "Came back" path was already validated end-to-end during Phase R shipping.

Bonus a11y fix: Lighthouse a11y dropped from 100 → 98 after the Queued cleanup because the audit re-ran and surfaced the pre-existing `landmark-one-main` failure on /today. Switched the outer `<div className="app">` to `<main>` — restored to 100/100/100.

**Tests:** 344 → **347 (+3)**. tsc + build clean.

## Validation matrix (passed on `staging-vyntechs.vercel.app` at `f1ad0a0`)

- Sign-in as `angelmoralesj@yahoo.com` / `Angelsoccer02` → `/today` ✓
- Check-ins panel renders correctly between header and the empty-state slot when Angel has 1 due follow-up + 0 sessions ✓
- Held click → POST `/api/follow-ups/[id]/resolve` 200 → `router.refresh()` → empty-state appears ✓
- DB row post-Held: `resolved_at` non-null, `comeback_recorded=false`, notes persisted (verified via Supabase MCP) ✓
- Cron: `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/comeback-prompts-daily` → 200 `{"surfaced":0}` ✓
- Cron without auth → 403 `{"error":"forbidden"}` ✓
- Regression: `/sessions`, `/sessions/new`, `/billing`, `/intake` — clean console (0 errors, 0 warnings) ✓
- Mobile (390×844 emulated, deviceScaleFactor 3): /today renders cleanly, primary CTA reachable ✓
- **Lighthouse desktop on /today:** **100/100/100** (a11y / best-practices / SEO). 43 audits passed / 0 failed.
- **Brandon eyeball check on staging-vyntechs from his iPhone (mobile Safari):** /today renders 2 modules — `01 · IN PROGRESS` (2015 Ford F250, P228F, step 1/13, low risk) + `02 · CLOSED TODAY · 1` (2013 Ford F-150, P0299). No Queued module, no empty-state slot. Header shows "TECH" because his profile.full_name is null in DB — separate cleanup, not a regression. ✓

## Carryovers (still apply)

- `/api/health` diagnostic still in repo — remove once corpus loop verified in prod.
- `tmp/design-handoff-2026-05-04/` is gitignored; each fresh worktree refetches.
- Brand drift on `public/icons/icon.svg` (still amber `#F2A93B`) — separate cleanup task.
- Plan-tree carryovers from `2026-05-04-handoff-plan-tree-gaps-closed.md` still apply on that branch.
- The favicon fix from plan-tree Session 2 has NOT yet been carried over to check-back. It will arrive automatically when the tier-2 RC merges plan-tree's changes onto a fresh main, then check-back rebases. Don't cherry-pick.

## Next session (Session 4)

Stand up `staging-rc.vercel.app` and run the **tier-2 candidate for check-back** per `2026-05-04-handoff-mid-validation-gap-list.md` § Tier-2 workflow:

1. `git checkout -b rc-check-back main && git merge --no-ff feature/phase-r-comeback`
2. `git push origin rc-check-back` (Vercel auto-builds)
3. `vercel alias set <new-deploy-url> staging-rc.vercel.app` (creates alias on first run)
4. Re-run the validation matrix above on `staging-rc` — confirm nothing rotted on the integrated code.
5. **Brandon's go-decision.** On approval: `git checkout main && git merge --no-ff feature/phase-r-comeback && git push origin main`. Smoke `vyntechs.dev` for 5 min.
6. Then Session 5 = same playbook for plan-tree (now off updated main).

**Recommend `/clear` before starting Session 4.**
