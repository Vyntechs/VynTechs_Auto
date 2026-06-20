# Diagnostic Diagram — Design Spec

**Date:** 2026-06-07 · **Branch:** `feat/system-data-ingest` · **Direction:** THE METER (locked)
**Complements:** the data-model plan in `docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md` (the deterministic driver). This spec defines the **visual** side: the parts, the rule for what shows, and how the few parts are arranged.

---

## 1. Why this exists (the root problem)

The exploration nailed three things — the data model, the reading/gauge ("the Meter"), and the step-shape taxonomy — but treated the **diagram itself** as a quiet backdrop and rendered it as abstract labeled dots, **drawn ad-hoc on every render**. To a tech that reads wrong: abstract, not self-explanatory, and it leaks elements that don't belong to the current step (e.g. `12V`/`GND` showing on a fuel-*pressure* step). Patching individual symptoms (quieting a pin, hiding a label) made the mess worse.

**Root cause:** the picture is *generated* each time. That can't be consistent and it puts the whole load on the AI/code to re-invent the drawing per case.

**Root fix:** build a **fixed kit of designed visual parts once** (in Figma), and **compose the diagram deterministically from data that's already modeled**. The AI never draws a diagram again; adding a make/system/symptom/step is **data only**.

## 2. Principles (must hold) — scalability is the driver, not a feature

**THE BAR (everything else serves this):** drop in *any* system, symptom, make, or concern → the correct screen renders itself, with **zero new design and zero new code**. The 6.7L fuel case is one *fixture*, never the thing we design around; generality is proven across multiple unlike systems (fuel + electrical + a non-fuel system such as DEF / charging / air), not on a single happy path.

**Why it can scale — the mechanism everything hinges on:** every vehicle system on every make is built from the same finite list of building-block *types* the data already speaks — part types (`components.kind`), connection types (`connectionKind`), wire roles (`electricalRole`), the ways a test is observed (`observationMethod`), and operating states (`system_scenarios`). That vocabulary is **identical for fuel, air, hydraulics, DEF, charging — all of it.** The kit + engine + templates are built **once against that vocabulary**; a new system is then just its parts and tests written in the same vocabulary = pure data.

Supporting principles:
- **Load off the AI.** The drawing path has zero AI and zero per-case work. Parts are designed once; data snaps in.
- **Built once against the *whole* vocabulary, with a graceful fallback.** The kit/engine cover every enum value, not the slice fuel happens to use; an unseen part/test/role still renders something sane — never a blank, never a break. Adding a system can never produce a broken screen.
- **Templates key off the *kind of test* (pressure / electrical / reading / scope / look), never a system's shape** — so an air-brake circuit or a DEF line lays out as cleanly as a fuel circuit.
- **The screen IS the circuit you're testing, not the truck.** Only the parts the current step involves are drawn; no whole-system map to lay out.
- **Reads like a real circuit to a tech.** Wiring-diagram conventions on the electrical side; recognizable parts on the fluid/mechanical side.
- **Contextually exact.** A step shows only what that test involves; nothing leaks.
- **Partial/incomplete data is the steady state, not an error** — it degrades honestly (the universal "needs field check" path), so systems come online progressively as curators fill them in.

## 3. The element kit (built once, in Figma)

A small, fixed library of reusable parts. Each is designed once as a Figma component, aligned to the existing vt design tokens (bone surface ramp, navy `--vt-signal-*`, amber, Instrument Serif / JetBrains Mono), then exported to the app (SVG / component) and never redrawn per case.

**The kit is keyed to the COMPLETE building-block vocabulary** — every `components.kind`, every `electricalRole`, every `connectionKind`, and every `observationMethod` / test hookup — **plus a generic fallback** symbol for any value not yet given a bespoke glyph. That is what makes it system-agnostic: fuel, air, hydraulic, DEF, charging all decompose into these same parts, and a never-before-seen value still renders sanely instead of blank.

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
- **Kept:** the data model (the deterministic driver); the Meter/reading block; the provenance grammar + three-color discipline; the bottom-sheet/mobile behavior; the scenario chip.

### 7a. Interaction decisions (v1 — Brandon, confirmed)
- **Tap any shown part to inspect it — KEPT.** The current step drives the default view, but the tech can tap any part on screen to pull up its detail. (This overrides the scope-dial-in synthesis, which had proposed removing free part-selection; the selection mechanism is adapted, not deleted.)
- **"Whole system" button → the existing full view.** It drops the tech into the current whole-topology / faded-system browser, not a placeholder. (Overrides the synthesis's v1 placeholder.)
- **Mobile reading sheet → tap-to-toggle** (peek ↔ expanded), not a free-drag sheet. Matches what the prototype proved; avoids fragile drag-physics at 375px.

## 8. Non-goals / out of scope

- No change to the loader contract / DB. Data deltas are proposed separately (the data-model plan).
- Not redesigning the Meter/reading (already done).
- Not building the full whole-system reference view beyond the existing escape hatch.

## 9. Open items (build-time, not spec blockers)

- The exact visual of each component symbol gets validated with Brandon as the first few Figma parts exist (a quick look-at-the-real-thing check), since "reads like a real circuit to a tech" is his call to confirm on concrete parts — not decided from words.

## 10. Success criteria — the scalability bar

**Primary (the bar):** adding a new system / symptom / make / concern is **data-only** — no new design, no new code, no AI — and the correct screen renders itself. This is proven **across multiple unlike systems** (at minimum: a fuel case, a purely-electrical case, and one non-fuel system such as DEF / charging / air — synthetic fixtures are fine where real data isn't authored yet), not on the fuel example alone.

Held to that bar:
- The kit + engine + templates contain **zero system-specific or per-case branching**; everything is a pure function of the building-block vocabulary (`kind` / `connectionKind` / `electricalRole` / `observationMethod` / scenario / `stepKind`).
- An **unseen** part type, role, connection type, or test method renders via the generic fallback — never a blank, never a crash.
- A tech glances at any step and reads it as a real circuit, with **only** that step's elements present (a pressure step never shows `12V`/`GND`) — and can tap any shown part to inspect it.
- The diagram's parts are a **single Figma component set**; the app contains **no per-case drawing logic**.
- Desktop and 375px mobile both read clean; partial data degrades honestly.
