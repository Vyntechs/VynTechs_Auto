# Vyntechs MVP — Handoff (2026-05-04, Phase F corrections shipped + first real-car dogfood validated)

Supersedes `2026-05-04-handoff-counter-01-shipped.md`. Slim format per AGENTS.md.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
2. Read `AGENTS.md`. Read `docs/superpowers/ui-design-toolkit.md` if doing UI.
3. Verify baseline: `pnpm exec tsc --noEmit && pnpm build`. Tests have **pre-existing pglite flake** — count varies 4–20 failures per run. **Re-run twice** to distinguish flake from regression. New code paths (`session-routing`, `prompts`) should always pass.
4. Dev server runs via `pnpm exec next dev --webpack -H 0.0.0.0 -p 3000` (Turbopack hits a cross-origin Client-Manifest bug; webpack works). `next.config.js` has `allowedDevOrigins: ['192.168.1.36']` for iPhone-on-LAN.
5. **Default next phase:** continuing Phase O — Counter 02 (HERO plan tree instrument). Active queue still: O Counter 02-03 → R → Q → P. Phase L corrections also pending (deferred by Brandon 2026-05-04).

## State

- Branch `feature/mvp-implementation`, **uncommitted Phase F corrections** + plan + handoff updates from this session. Decide whether to commit (recommended; verified) before next session.
- Tests **312 total**, ~292 passing (20 pglite-flake failures, same pattern across multiple runs). `tsc --noEmit` clean. `pnpm build` clean.
- **First real-car dogfood validated 2026-05-04**: 2013 F-150 3.5 EcoBoost / P0299 / 159k mi. AI correctly diagnosed torn BPV diaphragm via 6-step tree (DTCs → intercooler couplers → smoke test → wastegate actuation → BPV). Session `365CE29F` force-closed (status='closed', `forceClosedByDev:true`) so Brandon could continue dogfooding. **The brain works.**

## What this session covered

- **Phase F — Implementation corrections (2026-05-04, post-dogfood)** shipped — 6 corrections. Full detail in `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md` (Phase F corrections section, 2026-05-04 sub-heading). Headline:
  - Auto-redirect to outcome when `treeState.done && status==='open'` — extracted to pure `routeForSession` in `lib/session-routing.ts`, 8 unit tests in `tests/unit/session-routing.test.ts`
  - Hardcoded `<ConfidenceBlock value={0.87} basis="47 corpus matches">` ripped out of `active-session.tsx` — now conditionally renders only when `proposedAction.confidence !== undefined`, with real values
  - User-facing terminology pass: "corpus" → "past cases / shop history", "tree" → "plan", "node" → "step", "outcome capture" → "closing the case", "Notes for the corpus" → "Notes for next time", etc.
  - AI prompt requires part-location guidance — new PRINCIPLES bullet in `TREE_ENGINE_SYSTEM`. Regression guard in `tests/unit/prompts.test.ts`
  - Dev-server config fix: `next.config.js` with `allowedDevOrigins`, dev script switched to `--webpack`
- **`feedback_no_academic_terms_in_ui.md`** added to user memory with translation table — applies to Vyntechs and any future Brandon-facing UI work.
- **Phase L deferred 2026-05-04** — internet retrieval returned 0 forum/youtube/reddit/nhtsa hits on F-150 P0299 (should have hundreds). Documented in plan as "Phase L — Implementation corrections needed (2026-05-04, deferred)" with reproduction, suspected causes, scope estimate. Brandon's call: defer to its own focused work later.

## Carryovers

- **Pre-existing pglite test-DB flake** — `createTestDb()` intermittently fails with "close is not a function" / "Hook timed out". Count varies 4–20 failures per run (out of 312). Not caused by recent changes; predates 2026-05-04. Worth investigating: could be pglite version bump, vitest hook timeout, or test-setup race. Track separately.
- **Phase L is broken** — see `Phase L — Implementation corrections needed (2026-05-04, deferred)` section in the plan. Documented, not pretending it works.
- **Vision pipeline (Phase I) still untested on real photos** — Brandon didn't upload any artifacts during the F-150 dogfood. Next dogfood should include a real scan-tool screenshot to exercise the vision path.
- **Outcome form for the F-150 dogfood was never submitted** — force-closed via SQL with placeholder outcome jsonb. The corpus_entries table is still 0 rows. Next dogfood, when it closes cleanly via the new auto-redirect, should write the first real corpus entry.
- **All earlier carryovers** from `2026-05-04-handoff-counter-01-shipped.md` still apply.

## Suggested next session

If continuing dogfood validation (recommended): run a second real-car session via the new flow. Watch the auto-redirect to outcome work, fill out the outcome form, verify a `corpus_entries` row gets written. That's what validates Phase F corrections actually closed the loop.

If picking up Phase O: Counter 02 (HERO plan tree instrument) is next. Read `tmp/design-handoff-2026-05-03/.../v2_designs/02-counter-plan-quote.html` first.

Recommend `/clear` before starting either.
