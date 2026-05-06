# Vyntechs — Handoff (2026-05-06, Session 11: Phase P spec+plan ready, Stage 3 plan-corrected, both queued for implementation)

Slim format per AGENTS.md. **One session took over two parallel tracks** (the diagnostic Phase P brainstorm session froze mid-conversation; the migration session rescued it and continued both). Phase P brainstorm + spec + plan are complete and ready to implement. Stage 3 (entitlements) plan has pre-implementation corrections inline. Production untouched.

## Resume

**The next session should be Phase P implementation.** Stage 3 is queued behind Phase P (Brandon's order, 2026-05-06).

1. `cd /Volumes/Creativity/dev/projects/vyntechs` (the diagnostic worktree, **not** the migration worktree at `.claude/worktrees/monorepo-stage-1`).
2. Read `AGENTS.md`. Read this handoff. Read the Phase P spec: `docs/superpowers/specs/2026-05-06-phase-p-curator-design.md`. Read the Phase P plan: `docs/superpowers/plans/2026-05-06-phase-p-curator-implementation.md`.
3. **Decide on UI test coverage** before starting Task 1 — see "Open decision" below.
4. Verify clean baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **398/398**, tsc clean, 33 routes.
5. Invoke `superpowers:using-superpowers` then `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Plan has 18 tasks; subagent-driven keeps each task in fresh context.
6. Pre-flight (Task 0 in plan): `git checkout -b feature/phase-p-curator`, then commit the three untracked docs (rescue, spec, plan) per the plan's Pre-flight section.

**Stage 3 (entitlements) waits.** When Phase P merges to main, switch to `cd /Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/monorepo-stage-1` and pick up `stage-3-entitlements`. The Stage 3 plan corrections are inline in `docs/superpowers/plans/2026-05-05-platform-split-migration.md` (callout titled *"Stage 3 — Pre-implementation plan corrections (applied 2026-05-06)"*); read those before any Stage 3 code.

## State

- **Phase P artifacts** (untracked on main, three files):
  - `docs/superpowers/sessions/2026-05-06-phase-p-brainstorm-rescue.md` — extracts the frozen diagnostic session's brainstorm Q&A
  - `docs/superpowers/specs/2026-05-06-phase-p-curator-design.md` — 370-line design spec, Brandon-affirmed
  - `docs/superpowers/plans/2026-05-06-phase-p-curator-implementation.md` — 18-task plan with 19 TDD cases
- **Migration stack** unchanged from prior handoff. Branch `stage-2f-packages-ui` HEAD now `309fb16` (added Stage 3 plan corrections commit on top of prior `2780cb5`).
- **Production:** `vyntechs.dev` runs `main` head `5d7065b` (Phase Q + earlier work). Untouched by this session.
- **Frozen diagnostic session:** transcript at `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/b386921b-c8d9-4155-8acb-7ce96d2bf4fd.jsonl`. JSONL is intact; `claude --resume` would still read it. Not strictly needed — the rescue doc captured the brainstorm.

## What this session covered

1. **Cross-session takeover.** Diagnostic session b386921b froze mid-Phase-P-brainstorm at turn 217 (CLI accepted input, stopped streaming). Migration session extracted the conversation from the JSONL, wrote `2026-05-06-phase-p-brainstorm-rescue.md`, and resumed brainstorming in this session.
2. **Phase P brainstorm completed.** All 8 design questions decided (lifecycle audit trail, two-page split with per-category history, corpus FK collapsed, decision note on both Apply/Dismiss, re-recommend with previously-dismissed badge, single-page bulk-dismiss, no notifications at MVP, last-write-wins concurrency).
3. **Phase P spec written.** 370 lines covering 10 screens, schema additions (4 lifecycle cols on `drift_alerts`, new `novel_pattern_queue` table with RLS), trigger/flow mechanics, decisions table, open items, implementation breakdown.
4. **Phase P plan written.** 18 tasks, 19 TDD cases across 6 test files. Self-reviewed: spec coverage complete, type consistency verified, no placeholders. Two flagged "verify column names against actual schema before writing" markers for executor (Tasks 12 + 13).
5. **Stage 3 audit + plan corrections.** Six corrections found during cold-eyed plan-vs-codebase audit: webhook extends not duplicates, customer table is `stripe_customers`, no middleware exists today, `FeatureKey` type missing, pre-grant ordering, migration filename `0012_*`. All inline in migration plan at commit `309fb16`.

## Open decision before Phase P Task 1

**UI test coverage on read-only screens.** The plan TDDs every data-mutation path (19 test cases). It skips component-level tests on the 9 read-only UI tasks (drift queue page, drill-down, calibration dashboard, per-category history, deferred queue page, novel-pattern queue page, corpus list, full case detail, console layout) because the diagnostic app doesn't have React Testing Library setup. Brandon flagged this 2026-05-06.

Three options to address before starting:
- **(a) Add RTL component tests.** Refactor each page into server-fetch + client-render halves; add `@testing-library/react`; ~1 day of plan additions.
- **(b) Extend smoke suite with authed `/curator/*` routes.** Reuses existing pattern; ~2 hours of plan additions. Recommended by the migration session.
- **(c) Rely on Task 18's manual MCP authed-flow verification.** No plan changes; lightest coverage.

**Brandon's call.** Pick before Pre-flight Step 3.

## Carryovers

- **Pre-existing race in `ensureProfileAndShop`** still at `packages/db/src/queries/index.ts:71` (migration tree) / `lib/db/queries.ts:71` (main tree). One-line `ON CONFLICT (user_id) DO NOTHING` fix as its own PR off main. Sat across all of Stage 2 untouched.
- **Vitest fork-pool flake on cold cache** — first run can show 50+ "PGlite is closed" errors; rerun once.
- **Vercel `sensitive` env vars stay write-only.** `.env.local` in `.worktrees/mvp-implementation/` has plaintext.
- **Stripe env vars empty in local `.env.local`.** Stage 3 needs them populated for authed verification — Brandon retrieves from password manager when ready.
- **Phase Q + Phase P + Stage 3 migrations:** `0010` shipped, `0011` reserved by Phase P, `0012` reserved by Stage 3. No further coordination needed unless a third concurrent migration appears.
- **Test curator role grant** — Phase P Task 18 Step 1 grants Brandon's profile `role='curator'` on prod. Required for any Phase P preview verification.

## Next session

**Path:** Phase P implementation per the 18-task plan. Subagent-driven mode recommended. Estimate 3-5 sessions to ship.

**After Phase P merges:** Stage 3 (entitlements) on the migration stack. Branch `stage-3-entitlements` off `stage-2f-packages-ui`. Read the plan corrections callout first.

Recommend `/clear` before starting Session 12.
