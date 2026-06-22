# HANDOFF — Diagnostic loop: engine + data layer BUILT & VERIFIED; next is the LIVE SCREEN (Phase 4)

**Last updated:** 2026-06-21
**Work branch:** `feat/diagnostic-loop` (HEAD `dee5b8f`). All forward work stays here.
**Nature of this session:** Designed the confidence call (panel-approved), wrote the build plan, and BUILT + verified Phases 0–2 of the diagnostic loop (the engine + data layer). Next session wires the live UI.

---

## WHERE WE ARE
The user-facing interactive diagnostic ("the loop") on the seeded fuel-rail flow (P0087/P0088, 2017–22 Ford 6.7 PSD). The **engine brain + data layer are done and controller-verified**. What remains is **Phase 4 — wiring the live loop into the screen** (the visible money shot). A key finding (below) means the visible loop needs NO database round-trip, so the screen is the immediate next step, unblocked.

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

## IMMEDIATE NEXT STEP — Phase 4: wire the live loop in the UI
File: `components/screens/topology-diagnostic.tsx` (today renders only step 0, static). Tasks 10–15 in the plan:
- Replace the static `stepReducerInit` memo with a live `useReducer(stepReducer)`.
- Reading-entry surface (numeric input where `expectedValue` exists — only the 5V-ref step; tech taps the outcome against the shown expectation for the other 12).
- Submit handler: `verdictFromReading` → `resolveFork` → dispatch advance/goTo (map the raw fork verdict at the screen, per the R9 single-mapping-point note).
- Honest progress line (curator's `nextAction`/`reasoning`; **must name what was ruled out, else suppress**).
- Verdict screen with its story (true confirmed-check count; `priorFixCount` only when >0).
- Skip-ahead ("I already know it" — advances WITHOUT a confidence boost) + honest hand-off.
- **Sub-skills:** `frontend-design`, then `verification-before-completion`. Browser verify per memory `local-browser-verification` (Playwright MCP broken locally → drive the bundled chromium via a Node @playwright/test script). Local login per memory `local-dev-login`.
- The whole loop runs CLIENT-SIDE on the pure engine — **no DB round-trip needed** to function/demo.
- Task 8 (the `/api/sessions/[id]/scenario` route, currently a silent 404) is a small independent fix that can ride along.

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
Read HANDOFF.md in full. Branch feat/diagnostic-loop (HEAD dee5b8f). The diagnostic loop's ENGINE + DATA LAYER are BUILT & VERIFIED (Phases 0–2, plan at docs/superpowers/plans/2026-06-21-diagnostic-loop-fuel-rail.md, ledger at .superpowers/sdd/progress.md). NEXT: Phase 4 — wire the LIVE loop into components/screens/topology-diagnostic.tsx (Tasks 10–15): reading entry → verdictFromReading → resolveFork → advance → honest progress line (must name what was ruled out, else suppress) → verdict-with-its-story. The whole loop runs client-side on the pure engine — NO DB round-trip needed. Use frontend-design then verification-before-completion; browser-verify via the bundled chromium Node script (Playwright MCP is broken locally). Constraints: no user-facing confidence number/compass (internal only); zero AI in render; never a fabricated count. DB persistence (Phase 3 Task 9) is PARKED + Brandon-gated (it would touch the close-time code behind the live "N techs confirmed" counter). If building via the agent fleet, confirm the Anthropic API 529 outage has cleared; else build inline via TDD.
```
