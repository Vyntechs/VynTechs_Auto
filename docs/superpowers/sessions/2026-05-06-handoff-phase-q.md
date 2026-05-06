# Vyntechs MVP — Handoff (2026-05-06, Phase Q paused mid-redirect on `feature/phase-q-calibration`)

Slim format per AGENTS.md. **Parallel session** — runs alongside the Stage 2 monorepo migration (separate worktree, branch stack ending at `stage-2c-packages-db`, not on main). Diagnostic feature work stays on `main` at repo-root layout. Phase Q was scoped, started, then **redirected** mid-session at Brandon's call (active refit → passive recommendations); Q1 math + driftAlerts schema + plan-corrections callout shipped to the branch, Q3-Q5 not yet implemented.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs` (main repo, **not** `.claude/worktrees/monorepo-stage-1` — that's the migration session's worktree, do not touch).
2. Read `AGENTS.md`. **Read the Phase Q corrections callout** in `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md` (search "Phase Q — Implementation corrections (2026-05-06"). The callout is authoritative; the original Q1-Q5 task code blocks above it are reference only and contain stale assumptions.
3. Check out the branch: `git checkout feature/phase-q-calibration`. Verify `git status` clean.
4. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **385/385** (378 prior + 7 new in `calibration-refit.test.ts`), tsc clean, build clean. If red, stop and report.
5. **Apply the migration to live Supabase before continuing** (Q3 will fail at runtime without the table). Authenticate Supabase MCP, then `apply_migration` with the SQL from `drizzle/migrations/0010_drift_alerts.sql` and migration name `drift_alerts`. Run `mcp__supabase__get_advisors` after to catch lints. (MCP auth was started this session, never completed — paused with the rest of the redirect work.)
6. **Skip brainstorming.** The corrections callout + remaining Q2-Q5 task list IS the implementation guide. Invoke `superpowers:using-superpowers` then `superpowers:executing-plans` and proceed with Q2 → Q5 on the redirected design.

## State

- **Production:** `vyntechs.dev` → `main` head `a0c50f9`. Untouched by this session. Phase Q work lives on a feature branch only.
- **Working branch:** `feature/phase-q-calibration` off `main` HEAD `a0c50f9`. Baseline at session start was 378/378 (verified 2026-05-05 15:41 PT, HEAD `82a422f`); Q1's 7 new tests bring branch baseline to 385/385.
- **Branch commits (in order, off main):**
  - `b4ae3b8` feat(db): drift_alerts table for passive calibration recommendations
  - `bc1bd02` feat(calibration): Beta-Binomial threshold refit with risk-class-aware target
  - `2bb6d31` docs(plan): Phase Q implementation corrections — pivot to passive recommendations
  - this commit: docs(handoff): pause Phase Q on feature/phase-q-calibration
- **Migration in flight (do not touch):** `stage-1-reshape` branch stack in `.claude/worktrees/monorepo-stage-1/` ends at `stage-2c-packages-db` HEAD `3a72dc3`. Stages 2d/2e/2f are next on the migration side. Their handoff: `.claude/worktrees/monorepo-stage-1/docs/superpowers/sessions/2026-05-05-handoff-stage-2-verified.md` (not yet on main).
- **Rollback tag:** `pre-monorepo-baseline` → main commit `3e8412e`. Untouched.
- **Live DB:** `drift_alerts` table **NOT YET applied** to live Supabase. Drizzle migration file exists in source. Apply at next session resume — see Resume step 5.

## What this session covered (partial Phase Q on a branch, not in prod)

1. **driftAlerts table** (commit `b4ae3b8`). Appended to `lib/db/schema.ts` (after Phase R types). New file `drizzle/migrations/0010_drift_alerts.sql` with the CREATE TABLE statement; `drizzle/migrations/meta/_journal.json` got a corresponding entry (mirroring the `0009_follow_ups` pattern — hand-written, no meta snapshot, per Phase R commit `ac13369`'s comment "drizzle-kit will produce phantom diffs on next generate"). **Not yet applied to live Supabase.**

2. **Q1 — Beta-Binomial refit math** (commit `bc1bd02`). New files `lib/calibration/refit.ts` and `tests/unit/calibration-refit.test.ts`. 7 cases all green: prior preserved when sample size 0, ease-on-low-comeback, tighten-on-high-comeback, MIN clamp (0.55 prior + all successes), MAX clamp (0.95 prior + all comebacks), comebackRate report, drift report. Math fixed per corrections callout #1 — plan's literal `posteriorMean → newThreshold` direction was inverted; fix puts the Beta prior on comeback rate with `target = 1 - priorThreshold`, the risk-class baseline.

3. **Phase Q plan redirect** (commit `2bb6d31`). Inline corrections callout in the plan documenting both the math fix AND the design pivot from active refit to passive recommendation. **Decision authority:** Brandon, mid-session 2026-05-06, after walkthrough of policy options. The engine now *observes and recommends*; Brandon (sole curator at MVP) *acts*. Threshold table is read-only by the cron under the redirected design. Remaining Q2-Q5 are described in the callout with revised semantics.

## Plan deviations (full rationale in callout)

The Phase Q corrections callout in the plan covers all four:

- **Q1 math direction inverted.** Plan's success-rate posterior would have *raised* threshold on low-comeback cells (more cautious when AI was working) and *lowered* on high-comeback cells (less cautious when AI was failing). Both opposite of intent. Fix maps the Beta prior onto the comeback rate; threshold moves with deviation from the risk-class baseline.
- **Q3 redirect — passive only.** Cron writes `drift_alerts`; doesn't touch `confidence_calibration`. Drift-alert filter (≥5pt drift + ≥10 sample) preserved as a noise filter. Response shape changes: `{cellsAnalyzed, alertsRaised, windowDays}` (no longer `cellsRefit`).
- **Q4 redirect — "run analysis now."** Same handler, semantically a recompute, not a refit.
- **Q5 redirect — verify thresholds unchanged.** Inverted assertion vs. plan's "Cell A should have a *lower* threshold...".
- **Phase P follow-up.** When curator console ships, each drift-alert row needs an "apply this recommendation" action that updates `confidence_calibration.threshold_pct` and stamps `last_refit_at`. Not Phase Q scope; flagged in callout for Phase P scoping.
- **Q2 SQL needs derivation fix.** Plan §10287 reads `e.ai_response -> 'riskClass'`; that key only exists nested under `declineOrDefer` on the actual `session_events.aiResponse` shape. Q2 should derive risk class from `sessions.tree_state.gateDecision.riskClass` instead. Captured in callout; resolve during Q2 TDD.

## Carryovers (apply opportunistically, not session-blocking)

- **Race condition in `lib/db/queries.ts` `ensureProfileAndShop`** — pre-existing. ON CONFLICT DO NOTHING fix as its own PR off main, not Phase Q's problem. (Same carryover as the prior diagnostic handoff.)
- **`TreeState` duplication** — pre-existing. Migration session already addressed this in `stage-2c-packages-db`'s prep commit `c68bf26`; will resolve cleanly when that stack merges.
- **Phase F a11y** — pre-existing. 2 unlabeled OutcomeCapture form fields. Fix when next touching Phase F.
- **Q1 "drift" computed against current threshold value, not against risk-class baseline.** `drift = |newThreshold - priorThreshold|` measures movement, not deviation from spec. If Phase P wants to surface "this cell has drifted X points from its spec baseline" instead of "X points from its current threshold," that's a derived computation in the dashboard, not a model change.

## Migration coordination (verified against `2026-05-05-platform-split-migration.md`)

Same rules as the prior diagnostic handoff. **During the 2a-f parallel window, diagnostic session owns prod Supabase writes.** The migration session must not call `apply_migration` or `execute_sql` against prod Supabase. Stage 3 (entitlements, plan line 1797) is when DB-write ownership flips back.

**Drizzle migration filenames:** diagnostic owns `0010_*.sql` (used this session) + 0011+ (next available). Stage 2c moved the migrations directory to `packages/db/migrations/` on the migration branch; on `main` it remains at `drizzle/migrations/`. Either path resolves to the same files at Stage 6 merge.

**Files Stage 2 will move (avoid editing if at all possible)** — same list as prior handoff:
- `lib/db/schema.ts` → `packages/db/src/schema/index.ts` at Stage 2c (plan line 1142)
- `lib/db/client.ts` → `packages/db/src/client.ts` (plan line 1152)
- `lib/db/queries.ts` (and `lib/db/queries/*`) → `packages/db/src/queries/*` (plan line 1185)
- `lib/types.ts` → `packages/types` at Stage 2b
- `tsconfig.json`, ESLint/Tailwind/Prettier configs → restructured at Stage 2a
- `package.json` (root + diagnostic) → modified at every Stage 2 sub-stage

**This session's only schema.ts touch was the driftAlerts append** — a focused commit on its own (commit `b4ae3b8`), per the migration-coordination rule. Q3/Q4/Q5 will create only new files in new directories (`lib/calibration/*`, `app/api/cron/calibration-weekly/*`, `app/api/curator/calibration/*`) — no further schema.ts touches expected. Migration-rebase risk on Phase Q is therefore minimal: only the 22-line schema.ts append needs git rename detection at Stage 6, which crosses the threshold cleanly.

**Rebase cadence:** when this branch merges to main, the migration session should rebase `stage-1-reshape` (and stacked branches) onto current main before continuing Stage 2d. Keeps the conflict surface incremental.

**Vercel projects:** diagnostic still ships through `vyntechs-dev` on the established `feature/phase-X` → staging-rc → main → prod path. Migration uses the disposable `vyntechs-monorepo-stage1` test project. They don't share runtime.

## Next session — finish Phase Q (Q2-Q5) on the redirected design

1. Read this handoff. Read the Phase Q corrections callout in the plan.
2. **Authorize Supabase MCP.** Apply `0010_drift_alerts.sql` to live DB via `apply_migration` (name: `drift_alerts`). Run `get_advisors` after.
3. **Q2 — outcome aggregation.** TDD `lib/calibration/aggregate.ts` + test. SQL must derive risk class from `sessions.tree_state.gateDecision.riskClass` (per corrections callout, Q2 note). `follow_ups` table is shipped (Phase R) so the JOIN works.
4. **Q3 — weekly cron.** Create `app/api/cron/calibration-weekly/route.ts` per the redirected design (passive: writes `drift_alerts` only, never updates `confidence_calibration`). **Append** the calibration-weekly entry to `vercel.json` crons array (don't replace the existing `comeback-prompts-daily`). Schedule per plan: `0 6 * * 1` (Monday 6am UTC).
5. **Q4 — manual trigger.** `app/api/curator/calibration/refit/route.ts`, curator-role gated, reuses Q3 handler via injected `CRON_SECRET` trick.
6. **Q5 — verification.** Seed synthetic outcomes (3 cells, known comeback ratios) via Supabase MCP `execute_sql`. POST to manual-trigger as a curator-role user. Assert: `confidence_calibration.threshold_pct` UNCHANGED post-cron; `drift_alerts` populated with rows where `oldThreshold === current confidence_calibration value` and `newThreshold === refit recommendation`.
7. End-of-phase verification: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Use `superpowers:finishing-a-development-branch` to complete.

If Phase P (Curator Console) is the next pick after Phase Q, scope the "apply this recommendation" action on the drift-alert row before P starts — see corrections callout §3.

Recommend `/clear` after `cd` and reading this handoff.
