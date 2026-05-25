# Agent validation — observability fix

Five stress-test cases run against the updated Prompt 2 + Prompt 3. Each one I simulate as if I were the model receiving the prompts, then check whether the output matches what the system should produce.

## Test 1 — the original failure case (regression test)

**Input to Prompt 2**: Same 6.7L PSD fuel system narration as before, with the added requirement that observability is now a first-class field.

**Expected behavior**: Prompt 2 should now classify the fuel filter housing as `opaque` (correct first-principles inference — diesel filter housings are metal or opaque plastic by LAW; transparent housings would not survive engine bay temperatures and UV). For the property "water in drain bowl," it should enumerate valid methods: `drained_into_container`, `sensor_electrical_state` (the WIF sensor), `removed_for_bench_inspection`. It should explicitly EXCLUDE `direct_visual_internal`.

**Simulated output (relevant excerpt)**:
```
EXTRACTED — Fuel Filter / Water Separator
  housing_opacity: opaque [LOGIC — diesel filter housings are pressure-rated
                           and heat-resistant; opacity follows from material
                           requirements absent contrary information]
  observable_properties:
    - property: water_in_bowl
      valid_observation_methods:
        - drained_into_container
        - sensor_electrical_state (via water-in-fuel sensor)
        - removed_for_bench_inspection
      invalid_methods:
        - direct_visual_internal (housing opaque, blocked by LOGIC)
    - property: housing_integrity_external
      valid_observation_methods:
        - direct_visual_external
    - property: filter_element_condition
      valid_observation_methods:
        - removed_for_bench_inspection
        - sensor_electrical_state (restriction sensor if equipped)
```

**Pass/fail**: Pass. The schema now captures observability explicitly, and the opaque housing blocks `direct_visual_internal` from being a valid method.

**Downstream Prompt 3 simulation**: Given a P0087 symptom, Prompt 3 generates a fuel filter inspection step. It looks up `water_in_bowl`, sees that `direct_visual_internal` is not in the valid methods, and instead selects `drained_into_container` or `sensor_electrical_state`. The generated checklist now reads:

```
1. "Open the drain valve briefly into a clear container.
    Does water come out before clean fuel arrives?"
    observation_method: drained_into_container
2. "Read the water-in-fuel sensor state via scan tool.
    Is the WIF active?"
    observation_method: sensor_electrical_state
3. "External inspection: any cracks, weeping, or fuel stains
    on the housing?"
    observation_method: direct_visual_external
```

The transparent-bowl question is now structurally impossible to generate. **Pass.**

---

## Test 2 — clear coolant reservoir (positive case, must not regress)

**Input**: System operation narration including a clear plastic coolant overflow bottle with side markings.

**Expected behavior**: Prompt 2 classifies the bottle as `transparent` (or `partial` if side markings are the only translucent area). For property "coolant level," `direct_visual_internal` AND `direct_visual_external` are both valid.

**Simulated output**:
```
EXTRACTED — Coolant Overflow Bottle
  housing_opacity: transparent [EXTRACTED — expert stated "clear plastic"]
  observable_properties:
    - property: coolant_level
      valid_observation_methods:
        - direct_visual_internal
        - direct_visual_external (side markings visible)
    - property: coolant_color
      valid_observation_methods:
        - direct_visual_internal
```

**Downstream Prompt 3**: For "coolant loss" symptom, the VISUAL step asks "Is the coolant level visible at or above the COLD line on the side of the bottle?" with `observation_method: direct_visual_external`. The canvas renders the bottle from the side with the markings visible — correct representation.

**Pass.** The fix does not over-correct and incorrectly block transparent components from being looked at.

---

## Test 3 — radiator hose collapse (touch-required case)

**Input**: System narration including a rubber upper radiator hose between engine and radiator.

**Expected behavior**: Prompt 2 classifies the hose as `opaque`. For property "internal collapse under vacuum," valid methods are `touch_vibration` or `touch_temperature_at_surface` for the side effects, but the actual collapse property is `pressure_test_with_gauge` (vacuum side) or `removed_for_bench_inspection`. Direct visual won't reveal internal collapse on a soft rubber hose because it springs back when not under load.

**Simulated output**:
```
EXTRACTED — Upper Radiator Hose
  housing_opacity: opaque
  observable_properties:
    - property: internal_collapse_under_vacuum
      valid_observation_methods:
        - touch_during_engine_running (squeeze hose, feel for
          stiffness loss / collapse springback)
        - pressure_test_with_gauge (cooling system pressure test
          and inspect for hose deformation under pressure)
        - removed_for_bench_inspection
      invalid_methods:
        - direct_visual_external (hose appears normal when at rest)
    - property: external_cracking_weeping
      valid_observation_methods:
        - direct_visual_external
```

**Downstream Prompt 3**: For "overheating at idle" symptom, the VISUAL step on the hose now generates "With engine running and pressurized, gently squeeze the upper radiator hose. Does it feel stiff and pressurized, or does it collapse under light pressure?" — observation method `touch_during_engine_running`. The canvas renders a hand-squeezing icon at the hose location, not a "look at the hose" callout.

**Pass.** The model correctly recognized that visual inspection alone does not reveal hose collapse.

---

## Test 4 — wheel bearing roughness (audible / kinetic case)

**Input**: System narration including a front wheel hub assembly with integrated bearing.

**Expected behavior**: Prompt 2 classifies the bearing as `opaque` (sealed assembly). For property "bearing roughness/wear," valid methods are `audible_at_location` (spin and listen), `touch_vibration` (feel for roughness during rotation), `removed_for_bench_inspection`. NOT `direct_visual_internal`.

**Simulated output**:
```
EXTRACTED — Front Wheel Bearing (Hub Assembly)
  housing_opacity: opaque (sealed unit)
  observable_properties:
    - property: bearing_roughness
      valid_observation_methods:
        - audible_at_location (spin wheel by hand, listen for
          grinding/rumbling)
        - touch_vibration (hand on hub during rotation)
        - touch_play (rock wheel at 12/6 with vehicle lifted,
          feel for play)
        - removed_for_bench_inspection
      invalid_methods:
        - direct_visual_external (sealed, cannot inspect race)
        - direct_visual_internal (sealed)
```

**Downstream Prompt 3**: For "humming noise that changes with speed" symptom, the test routes to a SENSE-family step: "Lift vehicle. Spin wheel by hand. Do you hear grinding or rumbling that changes with rotation speed?" — observation method `audible_at_location`. The canvas renders the wheel from underneath with a sound-waves icon, not a "look at the bearing" callout.

**Pass.** The model correctly recognized that audible and kinetic methods are needed for sealed mechanical components.

---

## Test 5 — adversarial input (model with a property and NO observation methods captured)

**Input**: A deliberately incomplete intake where the expert described a component but never specified how its internal state is observed.

**Expected behavior**: Prompt 2 marks the missing observability as a GAP. Prompt 3 hits the OBSERVABILITY HALT — refuses to generate a test for that property.

**Simulated output from Prompt 2**:
```
EXTRACTED — Mystery Component X
  housing_opacity: not yet captured
  observable_properties:
    - property: internal_state
      valid_observation_methods: [GAP — not yet captured]

GAPS
  - Mystery Component X: housing opacity not stated by expert,
    must be captured before downstream test generation.
  - Mystery Component X: observation methods for internal_state
    not enumerated, must be captured before downstream test
    generation.

QUESTIONS (ranked)
  1. Is Mystery Component X's housing transparent, translucent,
     opaque, or partial? Top priority — blocks generation of any
     test that depends on observing its internal state.
  2. How is the internal state of Mystery Component X actually
     observed in the field? List the methods the expert uses
     (visual, drain, sensor read, etc.).
```

**Downstream Prompt 3 simulation** (given the gappy model and a symptom that implicates Mystery Component X):

```
OBSERVABILITY HALT.

The diagnostic for [symptom] requires observing the internal state
of Mystery Component X. The structured model does not yet capture
how this entity's internal state is actually observable in the field.

Missing capture:
  - Mystery Component X: housing opacity
  - Mystery Component X: valid observation methods for internal_state

What unlocks this step:
  - The expert returns to Prompt 2 with: "Mystery Component X is
    [opaque/translucent/transparent]. Its internal state is checked
    in the field by [drain/sensor/visual/removal/etc.]"
  - With that captured, Prompt 3 can generate the appropriate VISUAL
    or sensor-based step.

Diagnostic gate: refused. No alternative path available without
this capture.
```

**Pass.** The halt fires correctly. The model refuses to generate a fabricated test rather than defaulting to "just look at it."

---

## Regression check — does the fix break METER or GAUGE?

**METER**: The METER layout already required `probe_anchors.placement_mode` (back_probe / terminal_contact / inline_break). This is an implicit observation-method declaration. The new observability schema in Prompt 2 makes that explicit at the entity level — the FRP sensor's `signal_voltage` property gets valid methods `electrical_measurement_at_pin`, and METER consumes it. **No regression.**

**GAUGE**: The GAUGE layout already required `tap_point.fitting_type` for the physical interface. The new observability schema captures `pressure` and `vacuum` as observable properties of flow lines with valid methods `pressure_test_with_gauge` and `vacuum_test_with_gauge`. GAUGE consumes those. **No regression.**

**Reference prototype (P0087 fuel system)**: The prototype was built before the observability schema existed. Re-running it through the updated prompts, every electrical step still generates correctly (the FRP sensor signal voltage test, the VCV PWM test, etc.) because their observation methods (`electrical_measurement_at_pin`) are obvious LAW-class inferences for sensor terminals. The only step that would now require an updated narration is the fuel filter inspection — which is the exact step that was broken. **No regression; the broken case is fixed.**

---

## Summary

The observability fix is correct at the schema level. All five stress tests pass. The fix does not over-correct (transparent components can still be inspected visually). The fix does not break existing METER and GAUGE layouts because their observation methods were already implicit; the new schema makes them explicit. The fix catches the adversarial gap case (entity with no observation methods captured) via the OBSERVABILITY HALT.

The VISUAL layout can now be re-rendered with the corrected questions, but more importantly, every future test on every future system gets this protection automatically — not just the fuel filter.

## What I have not validated

- Running this through an actual fresh model invocation rather than simulating the model's output from inside the same context. The agent validation above is reasoning about how the prompts would constrain a model, not literally running them. To do true agent validation, a separate Claude or model call would need to receive the updated Prompt 2, narrate a fresh system, and have its output audited against the expected schema. I'm flagging this because the difference matters: my simulation of the model's compliance is more optimistic than a true cold-context run would be.

- The downstream layout rendering changes (the VISUAL canvas needs to switch from "stylized cutaway" to "drained container" when the observation method is `drained_into_container`). The prompts are fixed; the layout spec for VISUAL still needs to be written with the observation-method-aware rendering rules. That's the next step before VISUAL can be locked.
