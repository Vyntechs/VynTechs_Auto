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

## Migration coordination

If you touch a file the Stage 2 migration also touches, you'll get a real merge conflict at Stage 6 cutover. Stage 2 extracts shared packages (`packages/config`, `packages/types`, `packages/db`) — **mostly cross-cutting `import` paths and config files**. To minimize collisions: avoid restructuring shared types in `lib/types.ts` or schema in `lib/db/schema.ts` mid-flight. New files and new directories (likely for J/N/P/Q) won't collide. If a phase requires editing `lib/db/schema.ts` (Q probably will, for calibration history), ship it fast and small so the migration can rebase cleanly.
