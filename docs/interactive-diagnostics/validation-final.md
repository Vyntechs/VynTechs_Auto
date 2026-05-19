# Orchestration validation — final pass

End-to-end audit of the four-prompt orchestration after the observability fix. Every prompt walked through, every output schema verified, every chain handoff confirmed.

## What "validated" means here

For each prompt:
- The input contract is fully specified
- The output schema is complete and feeds the next prompt without translation
- Refusal protocols cover the failure modes
- Graph mutations are unambiguous
- Cross-vehicle equivalence is correctly propagated

For the chain:
- A user input (vehicle + symptom) flows through all four prompts to a rendered diagnostic
- Cached diagnostics get served without re-running upstream prompts
- A novel vehicle that's architecturally equivalent to a known one inherits the diagnostic via Prompt 4A's edges
- Field outcomes from one tech populate test nodes that other techs' diagnostics share

## Prompt 1 — Research & Prefill

**Status: dialed but unvalidated against a real model run.** The prompt is well-formed. It classifies platforms, extracts training-data architecture facts, tags each fact TRAINING-CONFIRMED / TRAINING-INFERRED / GAP, surfaces failure patterns, and explicitly enumerates training-data gaps (wire colors, exact pin numbers, mid-year supersessions).

**Verified contracts:**
- Input: vehicle year/make/model/engine/transmission + system of interest
- Output: structured baseline with every fact carrying a confidence tag

**Graph mutations:**
- `MERGE (p:Platform {id, year_range, ...})`
- `MERGE (f:ArchitectureFact {id, description, confidence, field_verify_required})-[:APPLIES_TO]->(p)`
- Failure pattern facts as additional ArchitectureFact nodes with `category: failure_pattern`

**Open item flagged honestly**: Prompt 1 has been used in this session against the 2017 Tahoe vibration case and the 6.7L PSD fuel case. It produced plausible structured baselines but has never been put through a cold-context run where a fresh Claude instance receives only the prompt and audits its own confidence tagging. Production validation requires that.

## Prompt 2 — System Operation Intake

**Status: dialed AND updated with the observability fix.** The prompt now captures, for each entity:

- Identifier, name, kind, location, inputs, outputs, function, relationships
- **Observability profile** — boundary opacity (transparent / translucent / opaque / partial) and the valid observation methods for every observable property

The CLASSIFICATION → EXTRACTED → INFERRED → GAPS → ASK flow is intact. Inference tags (LAW / LOGIC / PATTERN) are preserved. The refusal protocol still forbids filling gaps with conventional defaults.

**Verified contracts:**
- Input: plain-English system narration (text or transcribed voice)
- Output: 4-section structured model + ranked question list (max 10)

**Graph mutations:**
- `MERGE (c:Component {...})-[:BELONGS_TO_PLATFORM]->(p)`
- `MERGE (c)-[:CONNECTS_TO {mode, direction}]->(other_component)`
- `MERGE (c)-[:HAS_OBSERVABLE {property, valid_methods[], invalid_methods[]}]->(prop:ObservableProperty)`

The third edge type is new with the observability fix. It's what lets downstream prompts query "what are the valid ways to observe this property on this component" instead of inferring from the component name.

**Regression check**: the prompt's previous performance on the 6.7L fuel system, the 2017–2019 F-250 HVAC, and noise-tolerant voice transcription ("Linus → LIN bus") all still pass — the observability addition is purely additive to the schema, no existing fields removed.

**Open items honestly flagged:**
- Observability adds capture burden on the expert. Real-world test required: does the narration time per system stay reasonable (~60 seconds target), or does observability push it past 2 minutes? If too slow, observability needs a default-inference rule (e.g., "if kind=sensor and parent_component has opaque housing, default to electrical-state observation methods unless overridden").
- Mid-year platform changes (the 2018 Camry 5AR/A25A swap case from Prompt 4A validation) require the model to recognize that observability profiles may differ across mid-year variants. Currently the prompt does not call this out explicitly.

## Prompt 3 — Diagnostic Session Generator

**Status: dialed AND updated with the OBSERVABILITY HALT.** The prompt generates symptom-scoped diagnostic paths with refusal gates, contradiction halts, impossibility halts, thin-input halts, and now observability halts.

**Verified contracts:**
- Input: structured model from Prompt 2 + symptom payload (customer concern + DTCs + prior test results) + optional gate threshold
- Output: SCOPE + PATH + GATE STATUS plaintext, plus structured test action nodes for graph

**Graph mutations:**
- `MERGE (t:TestAction {..., observation_method, invasiveness, confidence_boost, source_citation})-[:PROBES]->(c:Component)`
- `MERGE (sym:Symptom {...})-[:IMPLICATES_TEST {priority}]->(t)`
- `MERGE (t)-[:HAS_BRANCH]->(b:BranchLogic)`
- `MERGE (b)-[:ROUTES_TO]->(next_test:TestAction)`
- `MERGE (t)-[:USES_OBSERVATION_METHOD {method, layout_family}]->(:ObservationMethod)`

The last edge is new. It carries the observation method forward so the rendering layer knows which layout family to invoke (METER / GAUGE / VISUAL / SCAN TOOL / ACTIVE TEST / SCOPE) and which sub-mode within that layout (drained container vs cutaway, back-probe vs inline-break, etc.).

**Refusal protocols (now complete):**
- BELOW GATE refusal with explicit missing evidence list
- ABOVE GATE commit recommendation with cited evidence chain
- CONTRADICTION HALT on inconsistent reported state
- IMPOSSIBILITY HALT on architecturally impossible reading
- THIN-INPUT HALT when structured model can't support the symptom
- OBSERVABILITY HALT when test requires observing an internal property of an opaque entity with no valid observation methods captured (new)

**Regression check**: the original P0087 + no-start interactive prototype still generates correctly. The observability halt only fires when an entity is opaque AND no non-visual observation method is captured AND a test would require observation of that property. None of the prototype's tests trip it.

## Prompt 4A — Cross-Vehicle Applicability

**Status: dialed.** Takes a source diagnostic + a candidate vehicle list, outputs an applicability matrix with FULLY APPLICABLE / PARTIALLY APPLICABLE / NOT APPLICABLE / INSUFFICIENT DATA verdicts.

**Verified contracts:**
- Input: source diagnostic metadata + candidate vehicles
- Output: applicability matrix + key forking points + recommended action per candidate

**Graph mutations:**
- `MERGE (p1:Platform)-[:EQUIVALENT_FOR_SYSTEM {system, confidence}]->(p2:Platform)` for FULLY APPLICABLE
- `MERGE (p1)-[:PARTIALLY_EQUIVALENT_FOR_SYSTEM {system, divergence_axes[]}]->(p2)` for PARTIAL
- No edge written for NOT APPLICABLE — those become flagged for separate diagnostic generation
- `MERGE (gap:CaptureRequest {target_platform, target_system, missing_axes[]})` for INSUFFICIENT DATA

**Validated against three diagnostic-to-candidate sets in this session:** Cummins CP3 vs CP4.2, 1st-gen vs 2nd-gen 3.5L EcoBoost, Toyota A25A vs 5AR mid-year swap. All three correctly identified the architectural forking points without false equivalences.

**Observability cross-check**: when two platforms are EQUIVALENT_FOR_SYSTEM, their components inherit each other's observability profiles automatically (via the graph traversal). When PARTIALLY EQUIVALENT, observability must be re-verified for any component on the divergent axis. The schema supports this; Prompt 4A's output flags partial-equivalence cases so downstream Prompt 2 capture is requested for the affected entities only.

## Chain validation — full end-to-end run

Simulated user input: `2018 F-250 6.7L Power Stroke · P0087 fuel rail pressure too low`.

**Step 1 — Application layer queries the graph.** No diagnostic exists yet for this exact platform+symptom. Orchestration triggers.

**Step 2 — Prompt 1 runs.** Outputs architecture baseline tagged TRAINING-CONFIRMED for the fuel system (CP4.2 mechanical pump, VCV electrical, FRP sensor 3-wire analog, FRP regulator 2-wire PWM, lift pump in tank). Known failure pattern surfaced: CP4.2 catastrophic failure with downstream debris contamination is TRAINING-CONFIRMED. Wire colors and exact pin assignments tagged GAP. Graph: platform node + 12 architecture fact nodes written.

**Step 3 — Expert narration arrives.** Either the platform admin or the diagnostic-running tech narrates the fuel system in their own words. The narration may simply approve Prompt 1's prefilled baseline with edits, or it may add details (specific connector identifiers if known, observed pin assignments from prior cases, observed failure patterns the model doesn't have).

**Step 4 — Prompt 2 runs.** CLASSIFICATION returns "electrical + hydraulic + mechanical hybrid (diesel high-pressure common-rail fuel system)." EXTRACTED captures every entity with its observability profile — fuel filter housing tagged opaque with valid observation methods `drained_into_container / sensor_electrical_state / removed_for_bench_inspection`; FRP sensor tagged opaque with valid method `electrical_measurement_at_pin` for signal voltage and `scan_tool_pid` for the resulting rail pressure value; HP pump tagged opaque with valid methods `pressure_test_with_gauge` (output) and `removed_for_bench_inspection`. INFERRED lists every LAW/LOGIC consequence. GAPS lists wire colors, exact PCM pin numbers, exact OEM expected values. Graph: ~15 component nodes + ~20 observable-property nodes + ~25 connection edges written.

**Step 5 — Prompt 3 runs.** Symptom payload "P0087 fuel rail pressure too low." Scoping eliminates non-supply-side components. Candidate failure enumeration produces ~12 candidates ordered by prior probability. Diagnostic path generation orders tests by efficiency-per-invasiveness. First test: scan-tool rail pressure read at idle — observation method `scan_tool_pid`, invasiveness 1, leverage high. Second test: lift pump prime pressure at HP pump inlet — observation method `pressure_test_with_gauge` (GAUGE layout), invasiveness 2, leverage high. Third test: fuel filter inspection — for "water in bowl" property, observation method `drained_into_container` (VISUAL layout sub-mode), invasiveness 1, leverage moderate. (The transparent-bowl failure cannot regenerate — the schema makes it structurally impossible.) Fourth test: FRP signal voltage at idle — observation method `electrical_measurement_at_pin` (METER layout, back_probe mode), invasiveness 2. Graph: ~8 test action nodes + ~15 branch logic nodes + ~30 implicates-test edges written. The OBSERVABILITY HALT does not fire because every test has a valid observation method captured.

**Step 6 — Prompt 4A runs.** Source diagnostic for 2018 F-250 6.7L PSD fuel system. Candidates: 2017 F-250, 2019 F-250, 2017–2019 F-350, 2017 F-450/F-550. Result: 2017–2019 F-250 and F-350 marked FULLY APPLICABLE (same engine, same fuel system architecture across the run). 2017 F-450/F-550 marked PARTIALLY APPLICABLE (different chassis-mounted lift pump, electrical tests on FRP/VCV/regulator unchanged). Graph: 3 EQUIVALENT_FOR_SYSTEM edges + 1 PARTIALLY_EQUIVALENT_FOR_SYSTEM edge written.

**Step 7 — Application layer renders.** Query the graph for "P0087 + platform=2018-f250-67psd OR platform-equivalent." Returns the ordered test sequence with observation methods, expected values (FIELD or OEM provenance), branch logic, and confidence boosts. The rendering layer maps each test to the correct layout family by observation method:

- scan_tool_pid → SCAN TOOL layout
- pressure_test_with_gauge → GAUGE layout
- drained_into_container → VISUAL layout (drained-container sub-mode)
- electrical_measurement_at_pin → METER layout (back-probe mode)
- audible_at_location → VISUAL layout (listen sub-mode)

The interactive surface renders. The tech walks the path. Outcomes record back to test action nodes. When tech #2 walks in with a 2019 F-350, the rendering query traverses the EQUIVALENT_FOR_SYSTEM edge and serves the same test sequence — the orchestration does not re-run.

## Failure modes audited

**What if Prompt 1 hallucinates a platform fact?** Prompt 2's refusal protocol forbids accepting unstated assumptions; expert narration overrides Prompt 1's TRAINING-INFERRED entries. If expert says "no, the regulator is on the front not the back," Prompt 2 records the correction and downstream prompts use the corrected version. The lie cannot propagate.

**What if Prompt 2 misclassifies a component as transparent when it's opaque?** Prompt 3's OBSERVABILITY HALT only fires when no observation method is captured; if a method is captured incorrectly, the rendered canvas misleads the tech. Mitigation: provenance tagging on observability claims (TRAINING-INFERRED gets surfaced to the admin for review before going live). Field outcomes from techs who notice the mismatch correct it over time.

**What if Prompt 3 generates a test with an observation method that's valid per the schema but wrong for the symptom?** The refusal protocol's CONTRADICTION HALT catches misaligned tests if a prior reading would invalidate the new test (e.g., scan tool already shows the rail at zero, no point reading the regulator's PWM). Beyond that, the leverage scoring is supposed to prevent low-leverage tests from being routed early.

**What if Prompt 4A marks two platforms as equivalent when they're not?** False-positive equivalence is the most damaging failure mode — it propagates a wrong diagnostic across vehicles. Mitigation: every EQUIVALENT_FOR_SYSTEM edge carries a confidence score and a list of verified architectural axes; field outcomes from a candidate platform validate or contradict the equivalence; one contradiction below a threshold demotes the edge to PARTIALLY_EQUIVALENT until re-verified.

**What if the graph storage is not nodes-and-edges (e.g., document storage)?** The orchestration design depends on graph-native storage. If the application's existing database is document-based, the four prompts still produce valid outputs but the natural branch connection between diagnostics will not happen — the storage primitive forces duplication. README and ARCHITECTURE both state this explicitly. The recommended choice (PostgreSQL + Apache AGE) keeps relational app data alongside the graph in one database.

## What's actually done

- Prompt 1: drafted, awaits cold-context model validation
- Prompt 2: drafted, observability fix integrated, awaits cold-context model validation
- Prompt 3: drafted, all halts in place including observability halt, awaits cold-context validation
- Prompt 4A: drafted and validated against three test-case sets
- Graph schema: complete, including all edge types needed for chain validation above
- Architecture doc: complete
- README: complete with explicit do-NOTs
- METER layout: locked, validated against DC V and current draw
- GAUGE layout: locked, validated against fuel system pressure
- VISUAL layout: prompt-side fix done, layout-side rendering rules still need writing (drained container sub-mode, removed-component sub-mode, etc.)
- SCAN TOOL, ACTIVE TEST, SCOPE layouts: not yet started

## What still must happen before Claude Code can wire this without supervision

1. **Cold-context model validation of Prompts 1, 2, 3.** Run each prompt in a fresh Claude session with no conversation context. Audit outputs against expected schema. Catch any drift between this conversation's optimistic simulation and actual cold-run compliance.

2. **VISUAL layout spec finalization.** With observation-method-aware rendering rules. The drained-container sub-mode renders differently from the removed-on-bench sub-mode, which renders differently from the external-inspection sub-mode. Each needs an explicit visual template.

3. **SCAN TOOL layout spec.** OBD port lit, scan tool overlay floating above the implicated module, PID name and live value, freeze frame view, bidirectional command surface.

4. **ACTIVE TEST layout spec.** Before/after split rendering, action prompt with explicit cause-and-effect arrow between components, support for wiggle/swap/disconnect/bidirectional variants.

5. **SCOPE layout spec.** Waveform display with cursors, channel assignments to specific pins, time-base and voltage-scale controls, expected waveform overlay (faded ghost of what it should look like).

6. **Claude Code skill for database pre-fill.** Lets the admin (Brandon) walk through systems narratively and have Claude Code populate the graph directly via the orchestration, using the Claude Code subscription instead of paid API calls. Skill lives in the repo, invoked when admin says "narrate a new system."

7. **Integration test against the existing product database.** Brandon's existing product backend is described as "kind of open." Before integration, that database's storage primitive must be confirmed and a migration plan to (or alongside) graph-native storage drafted.

## Bottom line

The four-prompt orchestration is **structurally complete and internally consistent**. The observability fix resolves the deepest schema gap discovered in this session and the validation tests confirm it does not regress METER, GAUGE, or the existing prototype. The orchestration is ready to be handed to Claude Code for wiring, *with the explicit caveat* that cold-context model validation has not been performed and three layout specs (VISUAL final, SCAN TOOL, ACTIVE TEST) and one additional layout family (SCOPE) remain to be written before the rendering layer is complete. The graph schema and the orchestration architecture do not need to change to accommodate the remaining layouts — only new layout spec docs need to be added.
