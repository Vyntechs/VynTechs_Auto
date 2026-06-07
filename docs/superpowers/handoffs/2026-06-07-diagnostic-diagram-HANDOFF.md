# Handoff — Diagnostic Diagram Rebuild (machine transfer)

**Date:** 2026-06-07 · **Branch:** `feat/system-data-ingest` · **Remote:** `origin` = github.com/Vyntechs/VynTechs_Auto
**Why this exists:** Brandon is moving to a new Mac. Everything below is committed + pushed to `origin/feat/system-data-ingest`. A fresh session on the new machine can resume from this doc alone.

---

## TL;DR — where we are

Mid-stream on a **root-cause rebuild of the diagnostic diagram** (the canvas on `/curator/topology`). The **design is done and approved**; the **implementation plan is ~40% authored** (3 of 8 per-track plan files written) when we paused for the transfer. Nothing is lost — it's all on the branch.

**Next action on the new Mac:** finish authoring the plan (re-run the plan workflow for the remaining tracks + master), self-review it, then execute Wave 0 → Wave 4.

## The arc (how we got here — so you don't repeat it)

1. **Kickoff:** `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-step-shapes-kickoff.md` — run the canvas exploration; direction **THE METER** is locked (reading is the hero, diagram is the quiet proof).
2. **Exploration workflow** → produced the data model, a throwaway Meter prototype, and the step-shape taxonomy. Output: `.design-shots/canvas-exploration-result.json`; prototype `.design-shots/mockups/proto-meter.html` (+ `.v1.bak.html`); data-model plan `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md`.
3. **Brandon reviewed the prototype** and flagged the **diagram reads wrong** to a tech — painful, not self-explanatory, *contextually incorrect* (e.g. `12V`/`GND` shown on a fuel-**pressure** step). After a few reactive patches he (correctly) called for a **root fix + a plan, not bandaids.**
4. **Root diagnosis (agreed):** the diagram was being *generated ad-hoc per render* — that's the mess, and it dumps all the load on the AI. **Root fix:** a fixed kit of **designed parts (built once in Figma)** composed **deterministically from the existing data model**; a hard per-step **"show only what this step tests"** rule (kills the leak); **templated per-step layout** (no whole-system map, no manual placement). **No AI in the draw path, ever.**
5. **SCALABILITY is THE bar** (Brandon, emphatic, repeated): adding any new system/symptom/make = **data-only**, no new design/code. Kit keyed to the **complete building-block vocabulary** (`components.kind` / `connectionKind` / `electricalRole` / `observationMethod` / scenarios / `stepKind` / `MeterMode`) **+ a generic fallback** so an unseen value never blanks. Proven **across multiple unlike systems** (fuel + electrical + a non-fuel system like DEF/charging/air), not the fuel example alone.
6. **Full parallel development** decomposition, hardened by a **scope dial-in workflow**: collapsed the 3 "contracts" into their owning tracks; **added the missing T7 step-engine** (nobody owned the step sequence/fork routing); resolved overlaps/gaps; produced **8 tracks across 5 dependency waves** with exclusive file ownership. Output: `.design-shots/scope-dialin-result.json`, `.design-shots/tracks.json`.
7. **Spec written + committed:** `docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md` (scalability-first; the design contract).
8. **Plan-authoring workflow started → PAUSED for transfer.** 3 per-track plan files written (T1, T2, T7). **Not yet written:** T3, T4, T5, T6, INTEGRATION, and the **master plan**.

## Brandon's confirmed decisions (locked — do not re-litigate)

- **Scalability is the acceptance test** (data-only growth; multi-system validation).
- **Full parallel development** — each track its own branch/PR off a shared feature base; exclusive file ownership so tracks can't collide.
- **KEEP tap-any-shown-part-to-inspect** (adapt the existing `components/topology/topology-selection-context.tsx`; do NOT delete free selection). *This overrides the scope-dial-in synthesis line that said "no free node-click."*
- **"Whole system" button → the existing full faded-system view** (not a v1 placeholder).
- **Mobile reading sheet → tap-to-toggle** (peek ↔ expanded), not a free-drag sheet.

## The plan structure (the dialed-in decomposition)

**Wave 0 — contract freeze (type-only, lands + merges before any track forks):** C1 data-contract (owner T1), C2 part-API (owner T2), C3 slot-interface (owner T3), + the `app/globals.css` token block (the six `--role-*`, `--vt-recede`, `--vt-amber-600` — referenced 18× in topology.css, defined 0×).
**Wave 1 (parallel):** T1 data · T2 figma-kit · T3 engine · T4 templates · T7 step-engine.
**Wave 2:** T5 mobile. **Wave 3:** T6 app-swap. **Wave 4:** INTEGRATION (the multi-system scalability gate).

- The **pinned contracts** (C1/C2/C3, exact type names/signatures) are in `.design-shots/scope-dialin-result.json` → `synthesis.contracts`, and embedded verbatim in `.design-shots/plan-authoring.workflow.js`.
- Each **track's scope / consumes / produces / dependsOn / filesOwned / definition-of-done** is in `.design-shots/tracks.json`.

## EXACTLY where to resume (new Mac)

1. Clone/pull `origin`; `git checkout feat/system-data-ingest`. Everything is there.
2. **Finish the plan.** Re-run the plan-authoring workflow to write the remaining track plans (T3, T4, T5, T6, INTEGRATION) + the master: `Workflow({scriptPath: ".design-shots/plan-authoring.workflow.js"})`. (Resume-by-runId is same-session only and won't carry to a new machine — just re-run fresh. The existing T1/T2/T7 files will be regenerated; that's fine, or trim the `TRACKS` array in the script to only the missing ones.)
3. **Run the writing-plans self-review yourself** (skill: `superpowers:writing-plans`) on the full plan set — spec coverage, placeholder scan, type/signature consistency across tracks — and apply any cross-track fixes the lenses flagged.
4. **Execute** via `superpowers:subagent-driven-development` (fresh agent per task) or parallel sessions. **Wave 0 first** (contracts must merge before tracks fork).

## Key artifacts (all committed on the branch)

- **Spec (THE design + scalability bar):** `docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md`
- **Data-model plan:** `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md`
- **Kickoff:** `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-step-shapes-kickoff.md`
- **Partial plan files:** `docs/superpowers/plans/2026-06-07-diagram-{T1,T2,T7}.md`
- **Decomposition:** `.design-shots/tracks.json` + `.design-shots/scope-dialin-result.json`
- **Exploration output (15 shape designs + data model + visual spec + adversarial):** `.design-shots/canvas-exploration-result.json`
- **Throwaway prototype (REFERENCE ONLY — not the build target):** `.design-shots/mockups/proto-meter.html` (+ `.v1.bak.html`). Screenshot harness: `node .design-shots/cap-meter-walk.mjs` → `.design-shots/out/meter-walk-sheet.png`.
- **Real scene fixture:** `.design-shots/scene-data.json` (25-part 6.7L P0087 fuel).
- **Workflow scripts:** `.design-shots/{canvas-exploration,scope-dialin,plan-authoring}.workflow.js`

## Watch-outs (from session memory)

- **Apply the T1 migration to live Supabase**, not just the PGlite test DB — `test_actions.step_kind` + `pin_scenario_readings.is_out_of_range` (both nullable), plus un-dropping the 4 meter columns + `branch_logic.routes_to_test_action_id`/`reasoning` and surfacing `symptom_test_implications.priority`. Hand-written Drizzle migrations need statement-breakpoint markers or the unit suite breaks; rerun `pnpm test` once on cold cache before trusting failures.
- The loader contract change is **additive only** — `tsc` across all existing consumers must stay green.
- This targets **staging-curator / V2**, not prod. Never push to main; Brandon merges.

## Task list at pause

#1–5 complete (explore → confirm root → approaches → present design → write+commit spec). **#6 (writing-plans) in progress, PAUSED** — 3/8 track plans written, master + 5 tracks pending.
