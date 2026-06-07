# Kickoff — Diagnostic Canvas: "the screen IS the step" (full exploration)

**Date:** 2026-06-06 · **For:** the NEXT fresh session (run FIRST after `/clear`) · **Owner:** Brandon (non-technical founder + master diesel tech — plain shop English; he reacts to concrete things; he does NOT want to be asked 100 questions — make the calls from his seat, logically, and show the why).

**Session-start paste (one line):** "Run the diagnostic-canvas exploration — read `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-step-shapes-kickoff.md` on branch `feat/system-data-ingest`. Make the calls from my seat; run the full workflow; bring me the plan + an updated prototype."

> Supersedes the canvas-direction part of `2026-06-06-design-phase-kickoff.md` (the 3-direction bake-off is DONE — The Meter won). This kickoff is the next layer: generalize the canvas to every step type, plan for everything, no air gaps.

---

## What's DECIDED this session (do not re-litigate)

1. **Direction chosen: THE METER.** Reading-as-hero — the value you're chasing (EXPECT vs NOW, in-range/out) is the loud beat; the diagram is the quiet proof of where that value comes from. Brandon picked it as "most painless and fitting." The Drive (camera glides) and The Dimmer (lights only) are shelved (specs kept in `.design-shots/mockups/direction-*.json`).

2. **THE CORE PRINCIPLE (Brandon's words, locked):**
   > **The screen should BE the circuit you're testing — not the truck. A clean, exact, directed path from the problem to the part, drawn the way a tech reasons, and built automatically from whatever the current step needs.**
   - NOT a system map with one part highlighted. NOT 25 parts dimmed to 5. Just the few elements the step actually involves.
   - **Rectangles/cards are OUT.** They eat real estate and imply "components parked on a map." Use **light schematic marks** — a small point + a one-line name, role-colored connection points, clean directed lines (flow/current with meaning), the meter hookup drawn where the leads go. Detail (type, location, probe text, theori) lives in the tap sheet + the gauge, never as paragraphs on the canvas.
   - The view is **composed per step from the data** — move to the next step, it redraws to exactly that step's shape. The "whole system" map is an explicit escape hatch, not the default.

3. **GENERALIZATION (Brandon's extension — the thing that makes it scale):** the *shape* of the screen depends on the **step TYPE**. "Circuit" is just the shape for an electrical test. See the step-shape taxonomy below. **Plan for ALL of them — no air gaps where the tool doesn't know what to draw.**

4. **Scalability mandate (Brandon, emphatic):** painless, easy, in mind the entire way. Adding a new make/system/symptom/step = drop in vetted data → finished screen renders itself. Zero per-case design. (See memory `project_canvas_must_scale_library`.)

## The STEP-SHAPE taxonomy (plan a defined screen for EACH — these are the "shapes")

For every shape define: (a) what the screen shows exactly, (b) how it's drawn in the light vocabulary, (c) the data fields that drive it automatically, (d) what it shows when data is incomplete (honest "needs field check", never a fake), (e) mobile.

- **Electrical circuit / path** — a directed power/signal path (source → part → ground), the probe point marked, expected value/band. (The most-developed shape; see electrical sub-shapes below.)
- **Fluid / flow / pressure path** — same directed-line idea, fuel instead of current; a port/gauge with a PSI or volume target (mechanical rail pressure, lift-pump volume, return flow, restriction).
- **Single-point value (scan-tool PID / sensor reading)** — barely a diagram: one part + its gauge. The Meter at its purest. (FRP PID at idle.)
- **Waveform (scope)** — one point + the *shape* the trace should make, to compare against (voltage or current waveform).
- **Look / inspect (visual / physical)** — no number, no path: the part, where it is, and what good-vs-bad looks like (leaks, CP4 debris in the filter, corrosion).
- **Fork / decision** — the two (or more) ways it can go, pick one (supply side vs high-pressure side).
- **Locate / orient** — find the part / set context; suppress the reading band entirely (the Meter prototype already has this as the LOCATE step).
- **Confirm complaint** — state the symptom, maybe the single whole-system glimpse before narrowing.

## The ELECTRICAL test taxonomy + RANKING (Brandon's seat — DECIDED, tiered)

Every electrical test draws from **three axes** (this is what makes the picture exact):
- **Quantity:** volts(DC) · voltage-drop · ohms/continuity · amps · Hz · duty% · waveform
- **Hookup (how the meter connects — drives the drawing):** one lead to ground · across two points (A↔B) · clamp around the wire · scope
- **Circuit state:** off · key-on · running · under-load · cranking
- plus the **Expected:** a value, a band, or a waveform shape.

Ranked by common × important on real diesel (design priority):
- **Tier 1 — daily, design-first:** (1) Voltage DC · (2) Resistance/Continuity · (3) Voltage drop [elevated on purpose — the differentiator] · (4) Duty cycle / PWM.
- **Tier 2 — master-tech depth:** (5) Voltage waveform (scope) · (6) Current waveform (clamp + scope) [diesel injector marquee].
- **Tier 3 — situational:** (7) Amps/current draw (clamp) · (8) Bidirectional/active command [modifier, rides on top] · (9) Frequency (Hz).
- **Tier 4 — rare/edge, graceful:** (10) Charging ripple (AC) · (11) Diode test · Min/Max capture [modifier].

Air-gap rule: Tiers 1–2 get first-class, beautiful screens; Tier 3 supported but not cluttering the common path; Tier 4 handled gracefully (never a blank/"don't know" — at minimum: name the test, the hookup, the expected, honest gaps).

## THE WORKFLOW the next session runs (full exploration — ultracode is ON)

Author a comprehensive Workflow. Suggested shape (adapt):
1. **Phase: Per-shape design (parallel)** — one agent per STEP SHAPE (and per Tier-1/2 electrical sub-shape). Each returns: exact screen contents, the light-vocabulary drawing, the data fields needed to auto-drive it, mapping to the EXISTING schema + what's MISSING, gap/unknown handling, mobile. Ground every agent in the real data + real code (paths below).
2. **Phase: Data-model synthesis** — collapse all the per-shape field needs into ONE coherent data-model proposal: what a `step`/`test` row must carry so code picks the right shape automatically (a `shape`/`observationMethod`, `quantity`, `hookup`, `state`, `expected{value|band|waveform}`, lead endpoints, fork branches…). Map to existing `testActions` (`observationMethod`, `expectedObservation`, `scenarioRequired`, `invasiveness`, `branches`), `componentPins` (`probeLocation`, `expectedReading`, `missingLogic`, `roleAbbreviation`), `systemScenarios`, `branchLogic`. Flag exactly what's missing. **Do NOT change the live loader contract / DB without Brandon — propose it.**
3. **Phase: Visual-vocabulary spec** — the light marks, the meter-hookup overlay (leads where they go), the gauge, the fork UI, provenance, mobile — one coherent contract, reusing the real `--vt-*` tokens (`app/globals.css`, `components/vt/v2.css`).
4. **Phase: Adversarial check** — prove NO AIR GAPS: every step shape and every Tier-1/2 test has a defined screen + a defined "data incomplete" state. Re-verify standing constraints (no "AI" word, no "step N of M", mobile passes, provenance honest, premium-not-default-AI, scales with zero per-case design).
5. **Phase: Build** — update the Meter prototype (`.design-shots/mockups/proto-meter.html`) to show 2–3 of the NEW shapes end-to-end (an electrical circuit step + a single-value step + a look/inspect or fork step), in the light vocabulary, touchable, desktop+mobile. Screenshot via `.design-shots/proto-sheet.mjs` + `proto-interact.mjs`. Bring Brandon the plan + the prototype to react to — don't black-box to a "final."

## Artifacts on disk (USE them — don't re-derive)

- **Chosen prototype (WIP):** `.design-shots/mockups/proto-meter.html` — mid-rebuild toward light markers + contextual-only + clean layered layout. Validate/finish or rebuild per the new model. Serve: `python3 -m http.server 3300` from `.design-shots/mockups`, or `file://` it. Screenshot harness: `.design-shots/proto-sheet.mjs`, `.design-shots/proto-interact.mjs`.
- **Real data slice:** `.design-shots/scene-data.json` — the real 25-part 6.7L fuel system (components, 9 pins, 43 connections, 72 readings, 8 scenarios) with real probe locations, expected readings, `missing_logic`, provenance, honest `label_gap`s. All 25 parts are TRAINING-CONFIRMED → label "from theory"; the amber "needs field check" register comes from the real `label_gap` "not yet captured" facts (NO fabricated GAP in this scene).
- **The 3 directions' full specs:** `.design-shots/mockups/direction-{1-the-drive,2-the-dimmer,3-the-meter}.json`.
- **6-lens research:** `.design-shots/mockups/lens-research.json` (premium pro-tool patterns, cognitive load, step-aware mechanics, theming, mobile, felt value — cited real products).
- **Design brief + prior kickoff:** `docs/superpowers/handoffs/2026-06-06-claude-design-fullbleed-diagnostic-canvas.md`, `2026-06-06-design-phase-kickoff.md`.
- **Code:** `components/screens/topology-diagnostic.tsx`, `components/topology/*`, `lib/diagnostics/load-system-topology.ts` (+ `topology-layout.ts`). Live page: `/curator/topology?symptom=p0087-fuel-rail-pressure-too-low` via `PORT=3210 pnpm dev`.
- **Tokens:** `app/globals.css` (`--vt-bone-*`, `--vt-signal-500` navy, `--vt-risk-high` amber, Instrument Serif / Inter Tight / JetBrains Mono), `components/vt/v2.css`, `v2-instruments.css`. Known bug: `topology.css` references undefined `--role-*` wire tokens (define them).

## Standing constraints (unchanged)

No "AI" word in UI · no "step N of M" / no upcoming-work preview (done + now only) · mobile 375–414px is a hard gate · provenance honesty (from-theory / needs-field-check, quiet see-source) · premium pro-tool, never default-AI aesthetic · **don't touch the data/save path or loader contract — propose schema changes, don't apply** · everything data-driven, zero per-case design · this line heads to staging-curator / V2, not prod.

## First moves for the next session
1. Read this kickoff + skim `scene-data.json` and the current `proto-meter.html`.
2. Author + launch the full exploration Workflow (phases above). Read each phase result before the next.
3. Bring Brandon the plan (step-shape screens + data-model proposal, plain English) + an updated prototype showing the new shapes. He reacts; refine with him. Never black-box.
