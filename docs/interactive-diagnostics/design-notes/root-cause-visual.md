# Root cause analysis — VISUAL observation-method failure

## What broke

The VISUAL layout for fuel filter inspection produced a checklist with questions like "Is there a visible water layer in the bottom of the drain bowl?" — a question that assumes the bowl is transparent. Real fuel filter bowls are opaque metal or opaque plastic. The tech cannot see through them. The only way to know whether water is in the bowl is to drain it, check the water-in-fuel sensor, or remove the bowl entirely.

The layout's zoom detail reinforced the error by rendering a stylized cutaway that looked like a transparent see-through bowl, so the schematic and the questions agreed with each other while both being wrong about how observation actually works in the field.

## Where the prompts went wrong

Reading the locked prompts back, the failure is not in Prompt 3 (Diagnostic Session) — it is in **Prompt 2 (System Operation Intake)**. The Intake prompt captures entities and relationships but does not capture **observability**.

Specifically, Prompt 2 captures, for each entity:
- Identifier, name, kind, location, inputs, outputs, function, relationships

Prompt 2 does NOT capture:
- Whether the entity's internal state is **directly observable from the outside**
- Which **observation methods** are valid for the entity's properties (direct visual through housing wall, drained fluid into container, removed component on bench, sensor electrical state, etc.)
- Which properties of the entity are **only inferable** (cannot be directly observed at all)

Because Prompt 2 doesn't capture observability, Prompt 3 has no way to know that "fuel filter drain bowl internal water content" is not visually observable through an opaque housing. The model fell back on its training prior, which is loaded with diagrams of clear inline filters and cutaway illustrations from training materials, and generated a question that would only be valid if the bowl were transparent.

This is the same class of failure the prompts were designed to prevent — filling a gap with a training-data assumption — but it surfaced through a hole in the schema rather than through a violation of the refusal protocol. The protocol caught wire colors and pin numbers because those gap categories were explicit. Observability wasn't an explicit gap category, so it wasn't tagged, so the model defaulted silently.

## Why this matters beyond fuel filters

Any test that depends on observation method will have the same failure mode unless the schema captures it explicitly:

- An oil cap held against the engine — can you tell oil is foamy by looking at the cap, or does the engine have to be running and the cap removed?
- A radiator hose — can you tell if it's collapsed by looking, or do you have to squeeze it?
- An evap canister — can you tell it's saturated by looking, or only by smell or weight?
- A wheel bearing — can you tell it's failed by looking, or only by spin-and-listen?
- A coolant reservoir — can you see the level (yes, translucent) or do you have to open it (no, opaque)?

Every one of these is a different observability profile, and the model cannot be trusted to infer it correctly from component name alone.

## The fix — at the prompt layer, not the layout layer

The root fix is **adding observability as a first-class concept in Prompt 2**. Then Prompt 3 inherits it automatically, and every layout (VISUAL, METER, GAUGE, ACTIVE TEST, SCAN TOOL, SCOPE) gets correct observation methods downstream.

### Prompt 2 schema additions

For each entity captured in EXTRACTED, add:

```
observability:
  housing_transparency: enum(transparent, translucent, opaque, partial)
    # how visible the internal state is through the enclosure
  observable_properties:
    - property: string  (e.g., "fluid level", "fluid color", "sediment", "temperature")
      observation_methods: [list]
        # valid methods to capture this property. Examples:
        #   direct_visual_external
        #   direct_visual_internal_through_housing
        #   drained_into_container
        #   removed_for_bench_inspection
        #   borescope_or_mirror
        #   sensor_electrical_state
        #   audible_at_location
        #   thermal_imaging
        #   touch_temperature
        #   touch_vibration
        #   smell
        #   weight_change
        #   pressure_test
        #   vacuum_test
        #   flow_rate_measurement
      gap_if_not_captured: boolean
        # if true, missing observability data BLOCKS test rendering rather
        # than defaulting to direct_visual_external
```

If `housing_transparency: opaque` and the property is internal, the only valid observation methods are `drained_into_container`, `removed_for_bench_inspection`, `borescope_or_mirror`, or `sensor_electrical_state`. The model cannot use `direct_visual_internal_through_housing` — the schema makes that combination invalid.

### Prompt 3 changes

When generating a VISUAL step, Prompt 3 must:

1. Look up the component's `housing_transparency` and the property being checked.
2. Select only observation methods valid for that combination.
3. Refuse to render the step if no valid method exists (gap state).
4. Pass the observation method to the layout so the canvas can render it correctly (drained container vs. cutaway vs. external surface).

### Refusal protocol addition

Add to Prompt 3's refusal section:

> OBSERVABILITY HALT: if a candidate test requires observing an internal property of an entity with `housing_transparency: opaque` and no non-visual observation method is captured in the model — STOP. Surface the gap. Ask the expert to specify how this property is actually observed in the field. Do not generate a visual-inspection step that assumes the housing is transparent.

### Layout-engine changes

Every layout's data parameter schema gains an `observation_method` field. The layout uses it to choose the right rendering:

- METER: probe placement mode (back_probe, terminal_contact, inline_break) — already implicitly observation-method-aware
- GAUGE: tap point fitting type — already observation-method-aware
- VISUAL: observation method drives whether the canvas shows external surface, cutaway, drained fluid, removed component on bench, sensor state, etc.
- ACTIVE TEST, SCAN TOOL, SCOPE: same — each gains explicit observation method

The rule unifies across all layouts: **a step cannot be rendered without a valid observation method, and the canvas representation must match the method.**

## Why this is the actual root fix

It addresses the failure at the layer where it can be prevented permanently — the schema the upstream model has to fill. After the fix:

- Prompt 2 cannot complete intake without capturing observability for every entity that has an internal state.
- The expert is forced to declare "the fuel filter bowl is opaque; water content can only be confirmed by draining into a clear container or by reading the WIF sensor."
- Prompt 3 inherits this and refuses to generate a "look through the bowl" question.
- The VISUAL layout receives `observation_method: drained_into_container` and renders the canvas accordingly (clear container with fluid in it, not a stylized cutaway of the sealed bowl).
- Every future VISUAL test on every future system gets the same protection — not just fuel filters.

The previous layout-level fix ("change the questions to ask about draining") would have patched fuel filters specifically and left every other opaque component vulnerable to the same failure.
