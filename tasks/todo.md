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
- [ ] Task 1 — `lib/research/types.ts` (slug-keyed types) + commit
- [ ] Task 2 — 3 persona prompts + `tests/unit/research-personas.test.ts` (TDD) + commit
- [ ] Task 3 — `lib/research/subagent-runner.ts` (web_search + 3-retry) + commit
- [ ] Task 4 — `lib/research/synthesis-runner.ts` (3-pass) + `tests/unit/research-synthesis.test.ts` (TDD) + commit
- [ ] Task 5 — `lib/research/orchestrator.ts` (slug-keyed fan-out, draft version, prior-run reuse) + `tests/unit/research-orchestrator.test.ts` (TDD) + commit
- [ ] Task 6 — API routes start + [runId] (requireCurator-gated, `after()` dispatch) + commit
- [ ] Task 7 — UI: new-flow-form button + research-progress.tsx + /researching page + prior-run reuse + commit
- [ ] Verify — full `pnpm test` green + `tsc` + lint; adversarial review
- [ ] **STOP → hand Task 8 (real ~$2-3 dispatch) to Brandon**; then Task 9 PR → staging-curator

## Review
(filled on completion)

## Skipped/Failed
(filled on completion)
