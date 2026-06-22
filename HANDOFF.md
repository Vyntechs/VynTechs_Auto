# HANDOFF — Diagnostic loop: the LIVE LOOP IS BUILT & BROWSER-VERIFIED (Phases 0–2 + 4 done)

**Last updated:** 2026-06-21
**Work branch:** `feat/diagnostic-loop` (HEAD `dee5b8f` + UNCOMMITTED Phase-4 working tree). All forward work stays here.
**Nature of this session:** Wired the live elimination loop into the screen (Phase 4, Tasks 10–15) on the pure engine, and browser-verified it end-to-end (pass→verdict and all-skip→handoff). The money shot works. **Phase-4 changes are not yet committed** — awaiting Brandon's go.

---

## WHERE WE ARE
The user-facing interactive diagnostic ("the loop") on the seeded fuel-rail flow (P0087/P0088, 2017–22 Ford 6.7 PSD) is **LIVE and verified**: the tech enters a reading / taps an outcome → the engine derives a verdict → the check is "ruled out" in the curator's own words → the loop advances → at the internal gate (or when the authored checks run out) an honest verdict reveals with the TRUE confirmed-check count. Runs 100% client-side on the pure engine — no DB round-trip. Verified in a real browser on /curator/topology (P0087): 11-check pass run → verdict "Your 11 checks line up"; all-skip run → honest handoff "You completed 0 checks"; NO percent/confidence/compass/fabricated-count anywhere.

## LOCKED DECISIONS (do not relitigate)
- **No user-facing confidence.** The number AND the compass are killed for good (Brandon, panel-approved). Confidence is INTERNAL ONLY — the verdict-gate trigger + next-check selector. Tech sees plain words. See memory `no-user-facing-confidence`.
- **Path A** (build the honest loop now; curator-narrative progress; literal "N causes left" counter is a seeded fast-follow, NOT v1). See memory `diagnostic-loop-build-path`.
- **Old legacy AI/wizard product is fully dropped** — leave it dead and untouched.

## THE DESIGN LAW (the loop)
One elimination at a time; ACCURACY FIRST; confidence internal-only; tech sees a **progress line** (must name what the just-completed check RULED OUT — suppress entirely if the curator didn't author that half; suppression over fabrication) + a **verdict-with-its-reason**; NEVER a percent; NEVER a fabricated count. Verdict story uses only true data: "your N checks line up" = real count of checks done; "N techs confirmed this fix" = priorFixCount, shown only when >0 (the prototype's "41 techs" is dropped). Triage = elimination #1. All on the one diagram — never a wizard/chatbot.

## BUILD STATE — Phases 0–2 DONE & VERIFIED (7 commits `b915285`→`dee5b8f`, ~30 unit tests)
- **Phase 0 (routing fixes):** verdict-vocab map (`lib/diagnostics/diagram/verdict-vocab.ts` — DB `ok/warn/fail`→fork `pass/neutral/fail`; applied in the loader); deterministic branch dedup by provenance (loader); gate thresholds re-keyed to the real long-form slugs (`lib/diagnostics/gate-thresholds.ts`).
- **Phase 1 (data):** `tech_outcomes` registered as a Drizzle pgTable (`lib/db/schema.ts`); `confidenceBoost` surfaced on `TopologyTestAction`.
- **Phase 2 (pure engine, `lib/diagnostics/diagram/`):** `verdictFromReading` (numeric auto-judge where a threshold exists, tech-tap otherwise), `accumulateConfidence` (0–100 from confirmed-check boosts), `hasReachedGate` (0–100 vs 0–1 gate, float-safe).
- Verified by controller: `npx vitest` 30/30 across new files; `npx tsc` zero errors in touched files; loader wiring inspected; tree clean. Built **inline via TDD** because the Anthropic agent-fleet API was throwing sustained 529s.
- **Plan:** `docs/superpowers/plans/2026-06-21-diagnostic-loop-fuel-rail.md`. **Ledger:** `.superpowers/sdd/progress.md` (Tasks 1–7 complete).

## WHAT PHASE 4 SHIPPED (uncommitted working tree)
- New components: `components/topology/{reading-entry,progress-line,verdict-panel}.tsx`; new pure formatter `lib/diagnostics/diagram/progress-line.ts` (`formatRuledOut`, 6/6 tests).
- `components/screens/topology-diagnostic.tsx`: live `useReducer(stepReducer)`; the loop console lives in the dock (current-check ask + expectation + entry + skip + ruled-out line); the verdict overlays the dimmed canvas center. `assembleStepView` gained an optional 3rd `step` arg (back-compat).
- `app/(app)/sessions/[id]/page.tsx`: passes real `priorFixCount` from `loadCachedDiagnostic`.
- CSS appended to `components/topology/topology.css` (`.topo-loop*`, `.topo-verdict*`, dim/animation, reduced-motion).
- Test fixture fix: added the now-required `confidenceBoost: 0` to `tests/unit/topology-diagnostic-assembled.test.tsx` (pre-existing Task-4 gap).

## IMMEDIATE NEXT STEPS (Phase 4 done — pick up here)
1. **COMMIT the Phase-4 working tree** (was awaiting Brandon's go at handoff time). Suggested message per the per-task plan cadence.
2. **Task 8** — port `/api/sessions/[id]/scenario` (currently a silent 404; the screen already POSTs to it fire-and-forget). Small/independent. Reference impl in `.worktrees/6.0-psd-cranks-no-start-seed/app/api/sessions/[id]/scenario/route.ts`.
3. **Terminal-cause markers (fast-follow):** today the verdict triggers on gate OR sequence-exhaustion only. A crisp "found it on THIS fail" finale needs curator-authored terminal markers (which fail = a confirmed cause vs continue). Same philosophy as the deferred "N causes left" counter — build post-WTP-test.
4. **`meter_mode` data-quality flag to curator** (`'PSI'`/`'DC volts'` strings vs the `MeterMode` union) — cosmetic; do not silently coerce.

## PARKED — Brandon-gated decision (Phase 3 Task 9: durable persistence)
Durable per-check persistence is DEFERRED (not needed for the visible loop). When wired: `tech_outcomes.session_id` FKs to `diagnostic_sessions.id` (migration 0021:249), and `cumulative_confidence` lives there too. `diagnostic_sessions` is created ONLY at close by `lib/diagnostics/record-diagnostic-session.ts` — the row that powers the public **"N techs confirmed this fix"** counter. Persisting mid-loop requires creating that row early AND making close UPDATE the same row (not INSERT a 2nd), or the live counter double-counts. **Touching that live-counter close path needs Brandon's explicit OK.** Any DB test uses the safe in-memory PGlite harness `tests/helpers/db.ts createTestDb()` (NOT the shared cloud DB).

## HARD CONSTRAINTS / INVARIANTS
- Diagnostic UX = the diagram itself; never a wizard/chatbot.
- Triage/next-step selection stays rule-based, ZERO AI calls in render.
- Reconcile logic stays in shared functions used by BOTH intake and session-render.
- Confidence only rises from real confirmed checks; nothing fabricated ever shown.
- `drizzle-kit check` is PRE-BROKEN on a malformed `0011b` snapshot (unrelated) — don't trust it; match tables to live DDL by hand; never `drizzle generate`/apply blind.

## DATA REALITY (verified live, read-only, 2026-06-21)
Symptom slugs are long-form: `p0087-fuel-rail-pressure-too-low`, `p0088-fuel-rail-pressure-too-high`. Platform `ford-super-duty-4th-gen-67-psd`. P0087: 13 implicated checks / 52 branches; P0088: 12 / 38. Branch verdicts: `ok/warn/fail` (no `impossible`). All 13 P0087 steps have `confidence_boost` (4–20). Only `sd4-67psd-test-frp-5v-ref-at-connector` has a numeric `expected_value` (5 V ±0.2); the rest are prose/observation. `meter_mode` seeded as `'PSI'`/`'DC volts'` (not the `MeterMode` union value — cosmetic; flag to curator, don't silently coerce).

## KEY FILES
- Engine (built): `lib/diagnostics/diagram/{verdict-vocab,verdict-from-reading,confidence,verdict-gate,step-sequence,slot-resolver,slot-interface}.ts` · `lib/diagnostics/{load-system-topology,gate-thresholds,record-diagnostic-session}.ts` · `lib/db/schema.ts`
- UI to wire: `components/screens/topology-diagnostic.tsx` · `components/topology/*` · `components/diagram-kit/*`
- Render/gate: `app/(app)/sessions/[id]/page.tsx` · auth pattern: `app/api/sessions/[id]/wizard-state/route.ts` + `lib/sessions.ts` getSessionForUser

## RESUME PROMPT
```
Read HANDOFF.md in full. Branch feat/diagnostic-loop. The diagnostic loop is BUILT & BROWSER-VERIFIED end-to-end (Phases 0–2 engine/data committed at HEAD dee5b8f; Phase 4 live UI in the UNCOMMITTED working tree). Plan: docs/superpowers/plans/2026-06-21-diagnostic-loop-fuel-rail.md; ledger: .superpowers/sdd/progress.md. The loop runs client-side on the pure engine (no DB round-trip): reading entry → verdictFromReading → resolveFork → advance → honest ruled-out line (curator reasoning, suppressed if absent) → verdict with the TRUE confirmed-check count. Verified on /curator/topology P0087 (pass→verdict, all-skip→handoff); no percent/confidence/compass/fabricated-count. NEXT: (1) commit the Phase-4 working tree; (2) Task 8 scenario route (silent 404); (3) curator-authored terminal-cause markers as a fast-follow; (4) flag meter_mode data-quality to curator. PARKED + Brandon-gated: Phase 3 Task 9 DB persistence (touches the close-time code behind the live "N techs confirmed" counter). Browser-verify via the bundled chromium headless-shell Node script — GLOB the ms-playwright cache for whatever chromium_headless_shell-<N> exists (the @playwright/test default version drifts); memory local-browser-verification.
```
