# METER Layout — Locked Specification

The METER layout is one of five layout families in the diagnostic interactive surface. Each layout family has a single template; the diagnostic engine adapts it per step via data parameters, not by writing new code.

## Scope

METER covers diagnostic steps where a technician uses a digital multimeter on the vehicle's electrical system. Validated test types:

- DC voltage at a pin
- Current draw (inline, specialty routing — see below)
- (Resistance, continuity to be validated next pass — same template, same parameters)

**PWM / waveform tests do NOT belong in METER.** A handheld DMM in Hz/duty mode can confirm "PWM is present, duty roughly in range" but cannot show waveform shape, rise/fall edges, or noise. PWM testing routes to **SCOPE** layout (sixth family — see LAYOUT-SCOPE.md when defined). The Hz%/duty function on a DMM is a fallback only when no scope is available; the diagnostic engine should prefer SCOPE routing.

## What the layout renders, every time

1. **Scoped circuit slice** — only the components and wires in scope for the active step. Out-of-scope components dim to ~13% opacity.
2. **Probe icons on the diagram** — red lead anchored at the test terminal (pin, stud, or eyelet — never mid-wire), black lead anchored at the ground reference (chassis ground stud, not the wire approaching it).
3. **Test leads as physical cables** — curved lines from the meter's lit jacks to the probe heads. Visually wired.
4. **Meter** — full DMM rendering with rotary dial, all measurement modes labeled around the perimeter, knob with pointer rotated to the correct position for the active test, input jacks with the correct two jacks outlined in amber.
5. **Screen contents** — mode label, large numeric reading, unit, expected-range bar with pass band and current-reading marker. **Every expected value carries a source provenance badge** (see Source Provenance section below).
6. **Step banner** with:
   - Test tag (METER · DC V, METER · Hz%, METER · A═, etc.)
   - Step title with expected reading range
   - Required Condition pill (green, with pulsing dot)
   - Leverage pill (amber, showing causes eliminated + invasiveness + effort)
7. **Progressive disclosure** on pin click — first click traces wire and labels destination; second click zooms source connector with target cavity highlighted; third click toggles to destination connector zoom.

## What the layout does NOT render

- Prose instructions telling the tech what to do
- Multiple-choice swatches for grading their reading subjectively (the system grades against expectation)
- Generic placeholder meter graphics
- Floating probes not anchored to physical contact points
- Wires that disappear into the meter (leads must be visible cables to jacks)

## Data parameters the engine feeds per step

```yaml
step:
  id: string
  test_type: enum(DC_V, AC_V, mV, Hz_pct, ohm, continuity, A_DC, A_AC, mA, uA)
  scope:
    components: [list of component ids to keep visible]
    wires: [list of wire ids to keep visible]
    pin_in_scope: string (the pin being probed)
  probe_anchors:
    red: { x, y, terminal_label, parent_component_id }
    black: { x, y, terminal_label, parent_component_id }
    placement_mode: enum(back_probe, terminal_contact, inline_break)
  meter:
    knob_angle_deg: number  # clock position, 0° = top
    screen:
      mode_label: string  # "DC V · AUTO RANGE"
      value: number
      unit: string
      waveform: bool  # show square-wave overlay (PWM only)
    range_bar:
      min: number
      max: number
      pass_low: number
      pass_high: number
      reading: number
    jacks_lit: [enum(VOhmHz, COM, "10A", mA)]
  required_condition: string  # "Engine at idle · warm"
  leverage:
    eliminates: number
    of_total_remaining: number
    invasiveness: integer 1-5
    effort_label: enum(low, medium, high)
  connector_map:  # for progressive disclosure
    source: { component_id, cavity_count, target_cavity }
    target: { component_id, cavity_count, target_cavity }
```

## Source provenance — required on every expected value

The pass band and expected reading on the meter screen must always carry one of three provenance tags. **No value without a source.**

```
provenance:
  source: enum(TRAINING_CONFIRMED, FIELD_VALIDATED, NOT_YET_CAPTURED)
  citation: string (nullable)
  field_outcome_count: integer (nullable — only when FIELD_VALIDATED)
  field_avg: number (nullable)
  field_stdev: number (nullable)
```

**Rendering rules:**

- **TRAINING_CONFIRMED** — pass band renders normally with a small `OEM` badge under the range bar. Citation tooltip available.
- **FIELD_VALIDATED** — pass band renders normally with a `FIELD n=47` badge showing how many techs have measured this. The pass band itself is computed from field statistics (e.g., field_avg ± 2·stdev), not from OEM spec.
- **NOT_YET_CAPTURED** — pass band does NOT render. Range bar shows `——` and an explicit badge: `expected range not yet captured · field-verify`. The tech can still enter a measurement; the system stores it as the first field outcome for this test node. Once 5+ outcomes accumulate, the provenance auto-promotes to FIELD_VALIDATED.

This is non-negotiable. A rendered pass band without provenance is a violation of the refusal protocol. The tech must always know whether they're looking at OEM spec, accumulated field truth, or an AI guess.

```
OFF  →   0°
V~   →  30°
V═   →  60°    <- DC Voltage
mV   →  90°
Ω    → 120°
▶|)) → 150°    <- diode / continuity
Hz%  → 180°    <- PWM frequency / duty
⊣⊢   → 210°    <- capacitance
°C   → 240°
A~   → 270°
A═   → 300°    <- DC current
mA   → 330°
```

## Jack lighting per test type

```
DC_V, AC_V, mV, Hz_pct, ohm, continuity → VOhmHz + COM
A_DC, A_AC (10A range)                  → 10A + COM
mA, uA                                  → mA + COM
```

## Probe placement modes

- **back_probe** — tip lands on the back of an installed connector pin (intact circuit, sensor still wired). Used for voltage.
- **terminal_contact** — tip lands on a disconnected component terminal directly. Used for resistance, continuity (component must be unpowered).
- **inline_break** — circuit is broken at a defined point in the middle of the wire run. Red probe goes upstream of the break, black probe goes downstream of the break, current flows through the meter as a series element. The diagram must render:
  - A visible gap in the middle of the wire (not at either terminal)
  - "CIRCUIT BROKEN / METER INLINE" indicator inside the gap
  - Red probe anchored on the upstream side of the break
  - Black probe anchored on the downstream side of the break
  Used for current draw only.

## Current draw — diagnostic engine routing rules

Current draw is a **specialty test**, not a routine one. The diagnostic engine should route to current draw ONLY when one of these conditions is true:

1. **Fuse keeps blowing on this circuit** (or has blown in the current case)
2. **Suspected dragging motor or solenoid** — component runs but exhibits weakness, noise, heat, or downstream effect inconsistent with normal mechanical health
3. **Parasitic draw investigation** — battery dies overnight, finding what isn't sleeping
4. **Charging system verification** — alternator output under load
5. **Voltage present but no work happening** — confirming current is actually flowing (downstream open suspected)

If none of these apply, current draw should NOT be routed even if it's technically a valid test. Voltage check, audible/visual confirmation, and prime/pressure measurements are higher-leverage and lower-invasiveness for most no-start and performance cases.

The engine's leverage calculation must factor in the **specialty nature of inline current testing**: the invasiveness rating is at least 3/5 (circuit must be broken, fuse may need to be pulled, harness disturbed) and the effort is medium minimum. Current draw scores well on leverage only when the symptom payload directly implicates it.

## Required Condition values

Always one of: `key_off`, `key_on_engine_off`, `cranking`, `idle_warm`, `idle_cold`, `medium_load`, `heavy_load`, `wide_open_throttle`, `hot_soak`, `inspection_only`.

The condition pill renders the human-readable version and pulses the green dot to indicate "this is what the vehicle must be in *right now* for the reading to be valid."

## Leverage indicator

The diagnostic engine computes this from the graph state:
- `eliminates` = number of remaining candidate causes that would be ruled out (or confirmed) by this test's result
- `of_total_remaining` = current count of unresolved candidate causes
- `invasiveness` = 1 (glance / no tool) through 5 (major teardown)
- `effort_label` = low (< 2 min), medium (2–10 min), high (> 10 min)

The pill renders: `Eliminates {eliminates} of {of_total_remaining} remaining causes · Invasiveness {invasiveness}/5 · Effort {effort_label}`.

## Validation status

- DC voltage at FRP signal pin (idle, warm) — passed
- Current draw inline on lift pump (key-on prime) — **pending re-render** with break in middle of wire (the v1.2 version drew probes incorrectly at the pump end)
- Resistance across disconnected component — not yet rendered
- Continuity check — not yet rendered
- PWM via DMM — **removed from METER scope**, routed to SCOPE layout family (to be defined)

Source provenance rendering — **not yet implemented** in the v1.2 reference HTML. Spec is locked; reference renders need updating to show OEM / FIELD / NOT_YET_CAPTURED badges.

## Locked
This specification is final. Do not modify without re-validating against currently-passing test types and updating the reference renders.
