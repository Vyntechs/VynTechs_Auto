# PR-N3 — Research Pipeline (curator/flow program)

**Branch:** `feat/curator-pr-n3-research-pipeline` off `origin/staging-curator` (N1 #100 + N2 #101 present). **PR target: `staging-curator`.**
**Plan:** `docs/superpowers/plans/2026-05-30-curator-realigned/pr-n3-research-pipeline.md` (lives in main checkout).
**Re-plans: 0/3**

## Pre-flight (DONE during exploration)
- [x] N1+N2 deps verified on staging-curator (slug-catalog, flow-versions, slug-keyed schema, new-flow-form)
- [x] All import contracts verified verbatim (requireCurator union, anthropic/MODEL/cachedSystem, createTestDb, nextVersionFor(tx))
- [x] SDK 0.92.0 has typed `WebSearchTool20250305` + `WebSearchToolResultBlock` → no `as never` cast needed
- [x] Clean baseline: 136 files / 1005 tests pass
- [ ] (Brandon-gated, Task 8) Vercel plan tier supports 800s Functions + ANTHROPIC_API_KEY on prod

## Plan corrections (in-lane, decided)
- Use Next 16 `after()` from `next/server` for the background pipeline (plan's bare `void` would be killed on Vercel). No new dependency.
- `startResearchRun` does insert + returns `{runId}` only; route schedules `after(() => executePipeline(...))`. Keeps orchestrator pure/testable.
- Use real SDK `WebSearchTool20250305` type instead of `as never`.

## Tasks
- [x] Task 1 — `lib/research/types.ts` (slug-keyed types) + commit
- [x] Task 2 — 3 persona prompts + `tests/unit/research-personas.test.ts` (TDD, 4 pass) + commit
- [x] Task 3 — `lib/research/subagent-runner.ts` (web_search + 3-retry; real SDK type) + commit
- [x] Task 4 — `lib/research/synthesis-runner.ts` (3-pass) + `tests/unit/research-synthesis.test.ts` (TDD, 1 pass) + commit
- [x] Task 5 — `lib/research/orchestrator.ts` (slug-keyed fan-out, draft version, prior-run reuse) + `tests/unit/research-orchestrator.test.ts` (TDD, 4 pass) + commit
- [x] Task 6 — API routes start + [runId] (requireCurator-gated, `after()` dispatch) + commit
- [x] Task 7 — UI: new-flow-form button + research-progress.tsx + /researching page + prior-run reuse + commit
- [x] Verify — full `pnpm test` green (139 files / 1014 tests, +9 mine) + `tsc` 0 errors
- [~] Adversarial multi-agent review (4 dims → verify) — IN PROGRESS
- [ ] **STOP → hand Task 8 (real ~$2-3 dispatch) to Brandon**; then Task 9 PR → staging-curator

## Task 8 pre-flight (read-only, for Brandon's gate)
- ANTHROPIC_API_KEY on prod: effectively confirmed (live AI features already depend on it).
- Vercel plan tier (need Pro/Ent for 800s Functions; Hobby=60s too short): Brandon to confirm at dashboard.
- after() viability for minutes-long work: under adversarial review (vercel-runtime dimension).

## Review
**Code complete (Tasks 1–7), all committed. Full suite: 139 files / 1015 tests pass. tsc: 0 errors.**

3 plan bugs caught + fixed during build:
1. Circular-import TDZ in personas → hoisted clause to a leaf module.
2. Vercel would kill `void executePipeline()` → split insert from work; route fires it via Next `after()`.
3. Dead reuse-button (unreachable prior-run prompt) → check-first form flow (POST without flowId first).

Adversarial multi-agent review (4 dims → verify): 10 raw → 2 confirmed (both medium, anti-fabrication).
`after()` runtime + correctness + cost dimensions: 0 confirmed (after() cleared by 2 independent agents).
- FIXED (Finding 2, N3 scope): synthesis citation provenance was prompt-only → now code-enforced
  (strip any citation whose sourceUrl no agent fetched). +1 unit test.
- FLAGGED, not fixed (Finding 1, N2 scope): `validateFlowForPublish` doesn't excerpt-check
  conflict-side citations. Real but out of N3 scope, unreachable via N3's automated pipeline
  (orchestrator never merges conflicts into step.conflicts). Follow-up for N2/N7.

Plan corrections applied: `after()` (no new dep), real SDK `WebSearchTool20250305` (no `as never`),
check-first form, citation provenance enforcement.

## Skipped/Failed
- **Task 8 (one real ~$2–3 Anthropic dispatch against prod): NOT RUN — Brandon-gated** (spends money).
  Pre-reqs to confirm first: Vercel plan = Pro/Enterprise (800s Functions; Hobby's 60s kills any approach);
  ANTHROPIC_API_KEY on prod (effectively confirmed — live AI features already use it).
- **Task 9 (push branch + open PR → staging-curator): NOT DONE** — awaiting completion decision.
- Lint: repo has no standalone eslint binary/config (lint runs via `next build`); tsc + tests are the gate.
