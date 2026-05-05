# Vyntechs MVP — Handoff (2026-05-05, diagnostic-side parallel session)

Slim format per AGENTS.md. **Parallel session** — runs alongside the Stage 2 monorepo migration (separate worktree, branch `stage-1-reshape`, not on main). Diagnostic feature work stays on `main` at repo-root layout; the migration's `git mv` to `apps/diagnostic/` is invisible until Stage 6 merges.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs` (the main repo, **not** `.claude/worktrees/monorepo-stage-1` — that's the migration session's worktree, do not touch).
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if the chosen phase has UI (N, P do; J, Q don't).
3. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **378/378**, tsc + build clean. If red, stop and report.
4. Ask the user which pending phase to ship. Do not pick unilaterally.
5. Branch off `main`: `git checkout -b feature/phase-<X>-<slug>` (matches the established phase-feature-branch pattern).

## State

- **Production:** `vyntechs.dev` → `main` head `762c3d2`. Phases A–I, K–M, O (counter 01-03), R all live. Smoke clean as of Session 5.
- **Main worktree:** `/Volumes/Creativity/dev/projects/vyntechs` on `main`, clean.
- **Migration in flight (do not touch):** `stage-1-reshape` branch in `.claude/worktrees/monorepo-stage-1`. Stage 1 verified, branch held off main; Stages 2a-c next session in that worktree. Their handoff: `.claude/worktrees/monorepo-stage-1/docs/superpowers/sessions/2026-05-05-handoff-stage-1-verified.md` (not yet on main).
- **Rollback tag:** `pre-monorepo-baseline` → main commit `3e8412e`. Untouched by anything in this session.

## Pending phases (next session picks one)

- **Phase J — Photo Storage Tiering** (6 tasks). S3 backend + lifecycle + tier-mirror cron. Only `lib/storage/client.ts` exists; J2 bucket provision, J5 signedUrl, backend swap all pending. No UI. Plan §4951.
- **Phase N — Tablet Layout + Real-Time Sync** (6 tasks). Two-pane phone components → tablet. UI-heavy; invoke `frontend-design`. Plan §8637.
- **Phase P — Curator Console** (7 tasks). Deferred/drift/novel queues + corpus authoring. Brandon-only surface (role gate). Plan §9542.
- **Phase Q — Calibration Engine** (5 tasks). Weekly cron, refits per-cell thresholds. Reads `follow_ups` (R, shipped) + outcome data. No UI. Plan §10124.
- **Phase S follow-up — Playwright e2e suite** only — prod deploy itself is done. Plan §10968.

Recommended order if user has no preference: **Q** (small, no UI, unblocked, closes the calibration flywheel) → **J** (storage hardening, transparent backend swap) → **N** (tablet, UI-heavy) → **P** (curator, separate role surface).

## Carryovers (apply opportunistically, not session-blocking)

- **Race condition in `lib/db/queries.ts` `ensureProfileAndShop`** — first authed page-load for a brand-new user can fire two parallel calls; second profile insert fails on `user_id` unique constraint. Reload works. One-line fix: `INSERT … ON CONFLICT (user_id) DO NOTHING` then re-fetch. Ship as its own PR off main any time. Pre-existing in `pre-monorepo-baseline` — Stage 1 didn't touch it either.
- **`TreeState` duplication** — `lib/db/schema.ts` (JSONB column type) and `lib/ai/tree-engine.ts` (runtime contract) both define it. Collapse to one source (canonical = `tree-engine.ts`, schema does `import type`). Ride along with any phase touching `TreeState`.
- **Phase F a11y** — Chrome a11y audit at `/design#outcome` reports 2 unlabeled form fields in OutcomeCapture (likely missing `<label htmlFor>`). Fix when next touching Phase F.

## Migration coordination (verified against `2026-05-05-platform-split-migration.md`)

**Live database:** Stages 2a/2b/2c are pure `git mv` operations — **no `apply_migration`, no `execute_sql`, no SQL changes** (plan line 1296 explicitly: "migrations directory moves intact, no SQL changes"). The migration plan does NOT address parallel work, so these rules are not in the plan; they exist only here. Stage 3 (entitlements) DOES touch live DB (`apply_migration` at plan line 1797) — by then the migration session must own DB writes. **During the 2a-c parallel window, diagnostic session owns the live DB. Migration session must not call `apply_migration` or `execute_sql` against prod Supabase.**

**Drizzle migration filenames:** diagnostic owns the next numbers (`0008_*.sql`, `0009_*.sql`, …). Stage 2c moves the directory but adds nothing.

**Files to avoid editing if at all possible** (Stage 2 will move and/or restructure them — concurrent edits become merge conflicts when rename detection fails):
- `lib/db/schema.ts` → moves to `packages/db/src/schema/index.ts` at Stage 2c (plan line 1142)
- `lib/db/client.ts` → moves to `packages/db/src/client.ts` (plan line 1152)
- `lib/db/queries.ts` (and `lib/db/queries/*`) → moves to `packages/db/src/queries/*` (plan line 1185)
- `lib/types.ts` → moves to `packages/types` at Stage 2b
- `tsconfig.json`, ESLint/Tailwind/Prettier configs → restructured at Stage 2a
- `package.json` (root + diagnostic) → both modified at every Stage 2 sub-stage

**If a phase MUST touch one of those** (Phase Q almost certainly adds tables to `schema.ts`; Phase P likely adds queue tables): ship the schema change in a small, focused commit on its own, before the rest of the phase work. Small, self-contained edits cross git's rename-detection threshold cleanly. A 500-line phase commit that also reshapes schema.ts will not.

**Safe edits** (no overlap, no merge risk): new files in new directories. Phase Q → `lib/calibration/*`. Phase J → `lib/storage/s3-backend.ts`, `lib/storage/lifecycle.ts`. Phase N → `app/(tablet)/*`. Phase P → `app/(curator)/*`.

**Rebase cadence:** after each diagnostic phase ships to main, the migration session should rebase `stage-1-reshape` (and stacked branches) onto main before continuing. This keeps the conflict surface incremental — small, visible, resolvable — rather than a 6-stage avalanche at Stage 6.

**Vercel projects:** diagnostic ships through `vyntechs-dev` (production project) on the established `feature/phase-X` → staging-rc → main → prod path. Migration uses the disposable `vyntechs-monorepo-stage1` test project. They don't share runtime.
