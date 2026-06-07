# Diagnostic Diagram — Design Spec

**Date:** 2026-06-07 · **Branch:** `feat/system-data-ingest` · **Direction:** THE METER (locked)
**Complements:** the data-model plan in `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md` (the deterministic driver). This spec defines the **visual** side: the parts, the rule for what shows, and how the few parts are arranged.

---

## 1. Why this exists (the root problem)

The exploration nailed three things — the data model, the reading/gauge ("the Meter"), and the step-shape taxonomy — but treated the **diagram itself** as a quiet backdrop and rendered it as abstract labeled dots, **drawn ad-hoc on every render**. To a tech that reads wrong: abstract, not self-explanatory, and it leaks elements that don't belong to the current step (e.g. `12V`/`GND` showing on a fuel-*pressure* step). Patching individual symptoms (quieting a pin, hiding a label) made the mess worse.

**Root cause:** the picture is *generated* each time. That can't be consistent and it puts the whole load on the AI/code to re-invent the drawing per case.

**Root fix:** build a **fixed kit of designed visual parts once** (in Figma), and **compose the diagram deterministically from data that's already modeled**. The AI never draws a diagram again; adding a make/system/symptom/step is **data only**.

## 2. Principles (must hold)

- **Load off the AI.** The drawing path has zero AI and zero per-case work. Parts are designed once; data snaps in.
- **The screen IS the circuit you're testing, not the truck.** Only the 3–6 parts the current step involves are ever drawn. There is no whole-system map to lay out.
- **Reads like a real circuit to a diesel tech.** Wiring-diagram conventions on the electrical side; recognizable parts on the fuel/mechanical side.
- **Contextually exact.** A step shows only what that test involves; nothing leaks.
- **Scales with zero per-case AND zero per-system layout work.**

## 3. The element kit (built once, in Figma)

A small, fixed library of reusable parts. Each is designed once as a Figma component, aligned to the existing vt design tokens (bone surface ramp, navy `--vt-signal-*`, amber, Instrument Serif / JetBrains Mono), then exported to the app (SVG / component) and never redrawn per case.

**Component symbols** — one per `components.kind` (the 8-value enum already in the data): `pump`, `sensor`, `actuator`, `valve`, `module` (PCM/controller), `mechanical`, `splice`, `connector`. Each a recognizable schematic-style glyph.
**Role-special symbols** (resolved by role/name, not `kind`): `ground` (standard ground symbol), `relay`, `fuse` (when present), `power source / battery`.

**Connection primitives:**
- `terminal` — a connection point on a component, colored by what it carries.
- `wire` by `componentConnections.electricalRole` — `12v` (power, hot), `ground`, `signal`, `5v-ref`, `low-ref`, `pwm` — each a fixed color + line style (the six `--role-*` tokens, defined once in `globals.css`).
- `fuel-line` and `mechanical-link` (`connectionKind`) — distinct styles.

**Test-overlay primitives** (the meter hookup; exactly one shows, only on the relevant step): `probe lead` (one-lead-to-ground), `two-point / voltage-drop bracket`, `amp-clamp ring`, `scope clip`, `pressure-gauge tee`, `test-point marker`.

**Reading primitive:** the gauge / "Meter" block (EXPECT vs NOW vs verdict) — already designed; kept as-is.

**Provenance is built into how a part is drawn** (not a badge): from-theory = drafted (graphite, default), field-verified (quiet navy tick), needs-field-check (amber). The amber "needs field check" register is sourced from `labelGap`/`electricalContract` content, never a provenance grade.

## 4. The hard rule — what's allowed to show on a step

Each step declares what it's testing (from data: `test_actions.observationMethod` + the focus component/pin + `scenarioRequired`). The renderer shows **only**: the parts in the step's circuit set, the wire(s) connecting them, **exactly one** test overlay (the hookup for this test), and the gauge (or none).

The lock that kills the leak-class of bug:
- **Terminals/pins render ONLY on an electrical metering step** (`observationMethod = electrical_measurement_at_pin`, or an electrical waveform/scope test).
- **Pressure** (`pressure_test_with_gauge`) → fuel path + gauge tee; **never** electrical pins.
- **Single-value PID** (`scan_tool_pid`) → the one part + its gauge; no leads.
- **Look/inspect** (`direct_visual_*` / `audible` / `touch` / `smell`) → the part + good-vs-bad; no wires/pins.
- **Locate/orient** (`stepKind`) → suppress the reading; mark the part to find.
- **Fork** → the cleared path + the one next part; only the chosen road.

This rule is a pure function of step-shape, coded **once** — not re-decided per case.

## 5. Templated layout (no map, no manual placement)

Because only the step's few parts are ever shown, **there is no system map to lay out** — which is why both "auto-arrange the whole system" (spaghetti) and "curator places each system by hand" (doesn't scale) are rejected. Layout = a **template per step-shape** with named slots; the step's parts drop into slots **by their role, derived from data**. No coordinates are authored per case or per system.

| Step shape | Template (slots) |
|---|---|
| Electrical test | **source** (top) · **device-under-test** (center) · **ground** (bottom) · downstream/anchor (faint, edge); hookup on the tested terminal |
| Pressure / flow | left → right along the fuel path: upstream · device · downstream; gauge tee at the test point |
| Single reading (PID) | device centered + gauge |
| Look / inspect | device centered + good-vs-bad beside it |
| Locate / orient | the part-to-find marked + its location context |
| Fork | cleared run (dimmed) → the one next device (highlighted); chosen branch only |
| Confirm complaint | the symptom's part raised; the rest a quiet field (the one allowed system glimpse) |

**Slot assignment from data (deterministic):**
- `device-under-test` = the step's focus component.
- `source` = the component feeding the active wire (upstream end of the `electricalRole = 12v`/power connection).
- `ground` = the component/terminal on the `electricalRole = ground` connection (or the ground symbol).
- `downstream / anchor` = the fuel-out (`connectionKind = fluid-line`, outbound) or the symptom-anchor component.

The template + the data fully determine placement. Reads right every time; zero layout work, per case or per system.

## 6. Figma's role

The kit (§3) is built once in Figma as a component set, matched to the vt design system, then exported (SVG/React) into the app. Figma is the **source of the parts**; the app is **assembly only**. Updating a symbol = update the Figma component and re-export — no per-case work.

## 7. What's replaced / what's kept

- **Replaced:** the abstract dot+label nodes; ad-hoc per-case drawing; pins rendered on every part regardless of step; the "draw the whole faded system" backdrop as the default.
- **Kept:** the data model (the deterministic driver); the Meter/reading block; the provenance grammar + three-color discipline; the bottom-sheet/mobile behavior; the scenario chip; the whole-system view as an explicit escape hatch.

## 8. Non-goals / out of scope

- No change to the loader contract / DB. Data deltas are proposed separately (the data-model plan).
- Not redesigning the Meter/reading (already done).
- Not building the full whole-system reference view beyond the existing escape hatch.

## 9. Open items (build-time, not spec blockers)

- The exact visual of each component symbol gets validated with Brandon as the first few Figma parts exist (a quick look-at-the-real-thing check), since "reads like a real circuit to a tech" is his call to confirm on concrete parts — not decided from words.

## 10. Success criteria

- A diesel tech glances at any step and reads it as a real circuit, with **only** that step's elements present (a pressure step never shows `12V`/`GND`).
- Adding a new make/system/symptom/step requires **data only** — no layout, no drawing, no AI.
- The diagram's parts are a **single Figma component set**; the app contains **no per-case drawing logic**.
- Desktop and 375px mobile both read clean.
