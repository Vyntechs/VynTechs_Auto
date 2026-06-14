# Handoff — Diagnostic Diagram Rebuild

**Started:** 2026-06-07 · **Last updated:** 2026-06-14 · **Branch:** `feat/system-data-ingest` · **Remote:** `origin` = github.com/Vyntechs/VynTechs_Auto
**Why this exists:** Began as a machine-transfer note (Brandon moved Macs mid-build); now the running record of the diagnostic-diagram rebuild. Everything below is committed on `feat/system-data-ingest`. A fresh session can resume from this doc alone.

---

## TL;DR — where we are (2026-06-14)

The **root-cause rebuild of the diagnostic diagram** (the canvas on `/curator/topology`) is **BUILT, not mid-plan.** All five dependency waves are committed and merged on this branch — Wave 0 contract freeze through Wave 4 INTEGRATION (the multi-system scalability gate). `/curator/topology` now renders the assembled, deterministic diagram by default. Two follow-on passes also landed: a real-data legibility pass and a T6 zoom-to-fit fix.

**Most recent work = a full-window "fullbleed canvas" layout pass** (committed 2026-06-14): the symptom switcher, vehicle header, ignition/fault simulator and live status moved off the top of the page into a **floating left control dock**; the diagnostic now renders as a full-viewport layer (`.topo-route`) over the curator shell; `TopologyDiagnostic` gained `symptoms` / `activeSymptomSlug` props (tests updated). Verified green: `npx vitest run tests/unit/topology-diagnostic-assembled.test.tsx` (7/7) + full suite. Visual proof: `.design-shots/out/topology-fullscreen_*.png` and `.design-shots/out/walk_*.png` (P0087 / P0088 / no-start, desktop-1440 + mobile-375).

> ⚠️ **The pre-2026-06-14 version of this doc said "design done, plan ~40% authored, paused."** That is obsolete — disregard it. The plan was finished and the whole thing was built. Do **not** re-run the plan-authoring workflow or rebuild the tracks; the commit history below is the source of truth.

**Still true:** none of this is on `main` (the branch is ~110+ commits ahead). This targets **staging-curator / V2**. Brandon merges — see the unresolved items at the bottom before any PR.

## What's actually committed (Wave 0 → 4, newest first — proof, not plan)

- **Polish:** `fix(diagram T6): zoom-to-fit` · `fix(diagram): real-data legibility pass` · the full-window dock layout (2026-06-14).
- **Wave 4 — INTEGRATION:** `test(diagram): INTEGRATION — deterministic multi-system scalability/leak gate`.
- **Wave 3 — T6 app-swap:** `swap /curator/topology to the assembled diagram (default) + keep escapes` · React Meter (EXPECT/NOW/VERDICT) from frozen C3 GaugeSpec.
- **Wave 2 — T5 mobile:** 375px Meter bottom-sheet, **tap-to-toggle** detent (Brandon override: no drag), safe-area/reduced-motion.
- **Wave 1 — T1 data · T2 figma-kit · T3 engine · T4 templates · T7 step-engine:** migration 0024 (additive); kit catalog (8 kinds + 4 role-specials, no-AI/no-switch guards); show-rule `selectStepShape` + slot-resolver `assembleScene` (graph-walk + verdict + leak-lock); per-shape templates + generic fallback; step sequence + reducer + fork routing.
- **Wave 0 — contract freeze:** C1 data-contract, C2 part-API + CSS tokens, C3 slot-interface; vitest include widened.

(Run `git log --oneline main..HEAD` for the full list — the diagram commits are tagged `T1`…`T7` / `Wave 0` / `INTEGRATION`.)

## The arc (how we got here — so you don't repeat it)

1. **Kickoff:** `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-step-shapes-kickoff.md` — run the canvas exploration; direction **THE METER** is locked (reading is the hero, diagram is the quiet proof).
2. **Exploration workflow** → produced the data model, a throwaway Meter prototype, and the step-shape taxonomy. Output: `.design-shots/canvas-exploration-result.json`; prototype `.design-shots/mockups/proto-meter.html` (+ `.v1.bak.html`); data-model plan `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md`.
3. **Brandon reviewed the prototype** and flagged the **diagram reads wrong** to a tech — painful, not self-explanatory, *contextually incorrect* (e.g. `12V`/`GND` shown on a fuel-**pressure** step). After a few reactive patches he (correctly) called for a **root fix + a plan, not bandaids.**
4. **Root diagnosis (agreed):** the diagram was being *generated ad-hoc per render* — that's the mess, and it dumps all the load on the AI. **Root fix:** a fixed kit of **designed parts** composed **deterministically from the existing data model**; a hard per-step **"show only what this step tests"** rule (kills the leak); **templated per-step layout** (no whole-system map, no manual placement). **No AI in the draw path, ever.**
5. **SCALABILITY is THE bar** (Brandon, emphatic, repeated): adding any new system/symptom/make = **data-only**, no new design/code. Kit keyed to the **complete building-block vocabulary** (`components.kind` / `connectionKind` / `electricalRole` / `observationMethod` / scenarios / `stepKind` / `MeterMode`) **+ a generic fallback** so an unseen value never blanks. Proven **across multiple unlike systems** (fuel + electrical + a non-fuel system like DEF/charging/air) — that's what the Wave 4 INTEGRATION gate locks in.
6. **Full parallel development** decomposition, hardened by a **scope dial-in workflow**: collapsed the 3 "contracts" into their owning tracks; **added the missing T7 step-engine**; resolved overlaps/gaps; produced **8 tracks across 5 dependency waves** with exclusive file ownership. Output: `.design-shots/scope-dialin-result.json`, `.design-shots/tracks.json`.
7. **Spec written + committed:** `docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md` (scalability-first; the design contract).
8. **Plan authored → executed → shipped on-branch.** All 8 tracks + INTEGRATION built and merged; `/curator/topology` swapped to the assembled diagram; legibility + zoom + full-window polish landed.

## Brandon's confirmed decisions (locked — do not re-litigate)

- **Scalability is the acceptance test** (data-only growth; multi-system validation).
- **Full parallel development** — each track its own branch/PR off a shared feature base; exclusive file ownership so tracks can't collide.
- **KEEP tap-any-shown-part-to-inspect** (adapt the existing `components/topology/topology-selection-context.tsx`; do NOT delete free selection). *This overrides the scope-dial-in synthesis line that said "no free node-click."*
- **"Whole system" button → the existing full faded-system view** (not a v1 placeholder).
- **Mobile reading sheet → tap-to-toggle** (peek ↔ expanded), not a free-drag sheet.

## Key artifacts (all committed on the branch)

- **Spec (THE design + scalability bar):** `docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md`
- **Implementation plans:** `docs/superpowers/plans/2026-06-07-diagram-{T1,T2,T3,T4,T5,T6,T7,INTEGRATION}.md` + master `2026-06-07-diagnostic-diagram.md`
- **Data-model plan:** `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md`
- **Kickoff:** `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-step-shapes-kickoff.md`
- **Decomposition:** `.design-shots/tracks.json` + `.design-shots/scope-dialin-result.json`
- **Exploration output (15 shape designs + data model + visual spec + adversarial):** `.design-shots/canvas-exploration-result.json`
- **Throwaway prototype (REFERENCE ONLY — not the build target):** `.design-shots/mockups/proto-meter.html` (+ `.v1.bak.html`).
- **Real scene fixture:** `.design-shots/scene-data.json` (25-part 6.7L P0087 fuel).
- **Latest visual proof:** `.design-shots/out/topology-fullscreen_*.png`, `.design-shots/out/walk_*.png`, `.design-shots/out/topology-BEFORE_*.png`.
- **Workflow scripts:** `.design-shots/{canvas-exploration,scope-dialin,plan-authoring}.workflow.js`

## Unresolved before any merge to main (READ before PR)

- **Apply the T1 migration (0024) to live Supabase**, not just the local/PGlite test DB — `test_actions.step_kind` + `pin_scenario_readings.is_out_of_range` (both nullable), plus the meter columns + `branch_logic.routes_to_test_action_id`/`reasoning`, and surfacing `symptom_test_implications.priority`. Hand-written Drizzle migrations need statement-breakpoint markers or the unit suite breaks; rerun the test suite once on a cold cache before trusting failures.
- The loader contract change is **additive only** — `tsc` across all existing consumers must stay green.
- This targets **staging-curator / V2**, not prod. **Never push to main without Brandon's go** — and per his merge-ownership rule, only through a hard verify-everything gate.
- This branch carries **much more than the diagram** (system-data-ingest PR0–PR3, the curator wizard, curator-console polish). A diagram-only PR would need that work separated, or the whole branch reviewed together. Decide scope before opening anything.

## Status

Diagram rebuild: **complete and verified on-branch.** Open question is integration path (separate the diagram from the rest of the branch, or review the branch whole) and the live-DB migration — both gated on Brandon.
