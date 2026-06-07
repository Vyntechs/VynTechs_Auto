# Plan — Diagnostic Canvas step shapes (The Meter), data model, and prototype

**Date:** 2026-06-06 · **Direction:** THE METER (locked) · **Status:** plan + working prototype, for Brandon to react to.
**Supersedes the exploration ask in** `2026-06-06-diagnostic-canvas-step-shapes-kickoff.md`.

Artifacts:
- **Prototype (updated):** `.design-shots/mockups/proto-meter.html` — 6 shapes end-to-end, desktop + mobile. Backup of the prior version at `proto-meter.v1.bak.html`.
- **Full machine output (15 shape specs + data model + visual spec + adversarial):** `.design-shots/canvas-exploration-result.json`.
- **Screenshot walk:** `.design-shots/out/meter-walk-sheet.png` (+ per-frame in `.design-shots/out/walk/`). Re-run with `node .design-shots/cap-meter-walk.mjs`.

---

## 1. The one idea

**The shape of the screen is decided by the kind of test, and the kind of test is already a field in the data.** Every test in the database is tagged with how you'd check it — scan-tool reading, electrical probe, pressure gauge, scope, or "just look at it." That tag (`test_actions.observationMethod`, a 9-value list) is the screen-shape selector, almost one-to-one with the shapes below. Add vetted data for a new truck/system/symptom and the finished screen draws itself — **zero per-case design**. That is the scaling bet, and the data already supports most of it.

---

## 2. The step-shape catalog (no air gaps)

Every shape has a defined screen **and** a defined honest "data is thin" state. What fires it is real data.

| Shape | Fires when | The screen (hero) | When data is thin (honest) |
|---|---|---|---|
| **Confirm complaint** (entry) | first step, before any test | the whole fuel spine quiet, ONE part raised = the symptom's pin (FRP); states the complaint | shows "reported low" from prose, **neutral** — never red unless a fact marks it wrong |
| **Electrical probe** (volts DC) | `electrical_measurement_at_pin` | lit source→part→ground path, lead drawn on the pin, **EXPECT 12V vs NOW** gauge | EXPECT degrades to the prose expectation; no fabricated number |
| **Continuity / resistance** | same, key-off, GND pin | two-point hookup, cold wire, Ω gauge | "continuity" qualitative, no fake ohms |
| **Voltage drop** (the differentiator) | same, under load | TWO probe points spanning the conductor + a bracket | needs the two endpoints authored (see gaps); else one point + "second point not captured" |
| **Duty / PWM** | running, PWM pin | one lead, square-wave wire, a duty **band** | qualitative band from the wire state — **no invented %** |
| **Scope / waveform** | `waveform_capture` | a trace window: live vs a fixed known-good shape | "no reference trace captured" honest note |
| **Fluid / pressure** | `pressure_test_with_gauge` | a gauge teed onto the fuel line, **PSI target** | qualitative target band |
| **Single-value PID** | `scan_tool_pid` | barely a diagram — one part + its gauge (the Meter at its purest) | shows the target band, neutral verdict |
| **Look / inspect** | `direct_visual_*` / `audible` / `touch` / `smell` | **good-vs-bad compare**, no number; tap the fault → what it means | the good/bad text is the content; nothing fabricated |
| **Fork / decision** | a reading resolves a branch | verdict → the ONE next part lights, the route draws on | words-only route if the next-target isn't linked yet |
| **Locate / orient** | a "find the part" step | location text is the hero, **reading band suppressed** | location string only |

Tiers 3–4 (amps clamp, bidirectional command, Hz, AC ripple, diode, min/max) **degrade gracefully** onto the electrical canvas — name the test, the hookup, the expected, honest gaps — never blank.

---

## 3. The data model (surgical — mostly surfacing what exists)

**Shape selector (no new work):** `test_actions.observationMethod` (already loaded) picks the parent shape. Electrical sub-type (volts/ohms/drop/duty/amps) reads from `test_actions.meterMode` (exists, just dropped by the loader). Hookup form (one-lead / across-two / clamp / scope / gauge-tee) is **derived**, not stored.

**Surface these columns that already exist but the loader throws away** (`load-system-topology.ts`):
- `test_actions.meterMode` — the sub-quantity + gauge-face.
- `test_actions.expectedValue` / `expectedUnit` / `expectedTolerance` — the EXPECT digit + the ± band that makes the verdict real. **Highest-leverage change.**
- `branch_logic.routesToTestActionId` + `reasoning` — the fork target (the next part that lights) + the "why this road?" pull.
- `test_actions.sourceProvenance` — so a step states its own grade.

**Genuinely new fields (minimal):**
- **`test_actions.stepKind`** (must-have, one nullable column) — the only thing the 9-method list can't say: "locate / orient" (find the part, hide the number). Nullable → no regression when absent.
- **`pin_scenario_readings.isOutOfRange`** (must-have, nullable yes/no) — a tiny curator flag so **red only ever lights on a fact you marked**. Absent → neutral, never red.
- `symptoms.symptomPinId` (nice-to-have) — the complaint's hero pin; otherwise derived from the top-priority test.

**Smaller follow-ons** (nice-to-have, surfaced by the review): an `expected_comparator` (lt/lte/eq…) so voltage-drop can say "near-zero is GOOD"; a known-good reference-trace handle for scope; treating `meterMode` as a small agreed vocabulary.

**Verdict honesty (resolves last round's #1 risk) — strict precedence, neutral when unsure:**
1. numeric (expectedValue ± tolerance vs a captured number) — **deferred** until measured numbers are loaded; do NOT parse prose.
2. `isOutOfRange` boolean — authoritative when present (true → red + unfold the failure tree).
3. `branch_logic.verdict = fail` → red.
4. **Default: NEUTRAL graphite** — no red, no green, failure tree stays collapsed. The tool never colors a reading wrong it can't prove wrong.

**Ordering / "what's next":** no step table. A step **is** a test_action; order = `symptom_test_implications.priority`; the fork graph reroutes on a resolved verdict; "next" is computed silently (no "step N of M").

**Loader contract:** all changes are **additive** (new optional keys, nullable columns) — proposed, not applied. See §6.

---

## 4. Today vs. after the data work (honest split)

- **Renders today, on current data:** every shape's *layout*, the light marks, the role-colored path, the fade, the per-step fact budget (locate suppresses the reading, look shows good-vs-bad, fork shows one road), the provenance "from theory · why?" pull. Verdicts are **neutral**; EXPECT shows qualitative bands.
- **Needs the approved data work to reach "hero" state:** the fat EXPECT *number* vs band (un-drop 4 columns + curators author them), red/failure-tree on a flipped scenario (`isOutOfRange`), the fork auto-lighting the next part (`routesToTestActionId`), real locate steps (`stepKind`).

The prototype is built to the honest state — e.g. the FRP PID screen shows **"idle target,"** not a fabricated number, and says so.

---

## 5. Visual vocabulary

Marks = a role-colored point + a one-line serif name (no cards). Labels **knock out** the wire behind them (schematic convention) so a horizontal path never strikes through a name. Wires colored by role; the active circuit glows + flows, the rest recedes to a non-zero floor (never vanishes). The Meter rises from the bottom, never covers the lit part. Three colors only: **graphite = drafted ("from theory"), amber = needs field check (from `labelGap`/`electricalContract`, NOT a provenance grade — in this scene provenance is uniformly "from theory"), red = measured-wrong (gated).**

**Tokens to define in `app/globals.css`** (currently undefined in the app, defined in the prototype): the six `--role-*` (`--role-12v` warm-red, `--role-ground` graphite, `--role-signal` navy, `--role-5v-ref`, `--role-low-ref` cool, `--role-pwm` violet), `--vt-recede: 0.16`, `--vt-amber-600`. Replace the 1.4px node border with a 0.5px engraved hairline; kill the standing `topo-node__gap` chip (provenance modulates the draw instead).

---

## 6. No air gaps — and the real gaps

The adversarial pass confirmed **every shape has a screen + an honest thin-data state**. The genuine gaps are not "the tool doesn't know what to draw" — they're:
1. **Ground reference / two-point span is a missing data primitive** (treated before as a CSS gap). Voltage-drop and the ground side of the hookup need `component_connections.fromPinId/toPinId` authored; otherwise degrade to one probe + "second point not captured" (amber). Prefer authoring on the connection over new columns.
2. **`waveform_capture` doesn't appear in repo data** — the scope shapes can't be confirmed against this scene (real test_actions live only in live Supabase). PWM likely carries `electrical_measurement_at_pin`, not `waveform_capture` — confirm against live data.
3. **Tier-1 numeric verdict is genuinely deferred** — needs `tech_outcomes` loaded (new table in the ORM + a join), not just un-dropping columns. Ship on the boolean + branch verdict + neutral default.

---

## 7. The prototype

Open `.design-shots/mockups/proto-meter.html` (file:// works) and use NEXT TEST to walk: **confirm → electrical probe (12V) → locate → single-value PID → look/inspect → fork.** Each step redraws the canvas to exactly that shape; the Meter rises with the step-appropriate fact; tap "why?" for see-source, tap the look fault swatch to see consequence. Verified: zero console errors, 375px mobile keeps the lit part above the sheet, no "AI" word, no "step N of M," no cards.

---

## 8. Open decisions for Brandon

1. **Populate the EXPECT numbers** (`expectedValue`/`expectedUnit`/`expectedTolerance` + `meterMode`) on tests? Single highest-leverage change — turns the prose Meter into a real gauge. They exist today, just empty.
2. **Author the yes/no "out of range" flag** on fault readings so red only ever lights on a fact you marked? Without it, fault readings stay neutral (safe, but the fault tree won't auto-open on a scenario flip).
3. **Add `stepKind`** (one optional column) so "find the part, hide the number" steps are authored, not guessed?
4. **Voltage-drop endpoints** authored on the connection row (vs new columns)?
5. **Complaint hero pin** — derive from the top-priority test (free) or author it explicitly?
6. **`meterMode`** as a small agreed word list, or a strict typed list?
