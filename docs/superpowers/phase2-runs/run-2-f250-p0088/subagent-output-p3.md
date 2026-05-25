# Run 2 — P0088 Fuel Rail Pressure Too High
## Diagnostic Session Generator Output (Prompt 3)
### Vehicle: 2018 Ford F-250, 6.7L Power Stroke Diesel

---

## SECTION 1 — SCOPE / PATH / GATE STATUS

### STEP 1 — SYMPTOM SCOPING

**DTC P0088: Fuel Rail / System Pressure — Too HIGH**
Complaint: rough running + occasional power loss under load; idle stable; vehicle key-off in shop.

**Subsystem implicated:** High-pressure fuel circuit — specifically the pressure-regulation loop: the IMV (inlet metering valve), the FRP sensor (feedback element), the PRV (mechanical over-pressure relief), and the injector return circuit (the only passive pressure escape path).

**Components IMPLICATED (can produce over-pressure):**
- `sd4-67psd-imv` — Normally-open PWM solenoid that limits fuel entering the CP4. If the valve fails stuck closed, or if PCM commands an abnormally high duty cycle (more closed), the CP4 pumps fuel into the rail faster than injectors consume it. Rail pressure rises. Load-dependent presentation fits: at idle the IMV is partially open; under load the PCM increases commanded duty cycle and a stuck/sticky IMV may not track.
- `sd4-67psd-frp-sensor` — If the sensor drifts high (false-high output voltage), the PCM reads rail pressure as exceeding threshold and sets P0088 while actual mechanical pressure is normal. Unstable reading under dynamic load (throttle transients) is a known failure mode. Cannot distinguish sensor-false from real over-pressure until verified.
- `sd4-67psd-pressure-relief-valve` — Passive mechanical valve. If the seat is gummed, corroded, or spring-set too high, it will not open when rail pressure exceeds cracking pressure. No electrical path to diagnose — must be approached via pressure behavior and, ultimately, physical inspection.
- `sd4-67psd-return-circuit` — Injectors consume HP fuel and return excess via the passive return circuit. A restriction (collapsed hose, kinked line, debris-blocked fitting, carbon in return galleries) raises back-pressure at the injector return ports and contributes to residual rail pressure accumulation under sustained load. Not the single most common P0088 cause but is non-trivial on high-mileage trucks.
- `sd4-67psd-pcm` — If all hardware checks pass clean, PCM software fault commanding excessive IMV closure (rare, usually associated with reprogramming events or failed flashes). This is a diagnosis of exclusion — addressed only after all hardware candidates are cleared.

**Components ELIMINATED by topology / control logic:**
- `sd4-67psd-lift-pump` — Supplies low-pressure feed. Weakness or failure = under-pressure at CP4 inlet, not over-pressure in the rail. ELIMINATED.
- `sd4-67psd-fuel-filter-ws` — Restriction reduces CP4 supply pressure. ELIMINATED for over-pressure.
- `sd4-67psd-lift-pump-relay` — Supply chain for lift pump. ELIMINATED.
- `sd4-67psd-fuel-tank` / `sd4-67psd-fuel-level-sender` — Supply-side only. ELIMINATED.
- `sd4-67psd-wif-sensor` — No hydraulic path to rail pressure. ELIMINATED.
- `sd4-67psd-def-dosing-system` / `sd4-67psd-def-tank` — Separate urea circuit. ELIMINATED.
- `sd4-67psd-hp-rail-bank-a` / `sd4-67psd-hp-rail-bank-b` (as failure sources) — The rails are passive accumulators. They do not generate or restrict pressure; they transmit it. External leaks at the rail would relieve pressure (lower, not raise it). The rails are observation points, not failure candidates for P0088. ELIMINATED as causal components; retained as observation surfaces.
- `sd4-67psd-cp4-pump` (as isolated failure) — The CP4 only overpumps if the IMV fails to regulate its inlet. The CP4 itself cannot cause over-pressure without the IMV being the control mechanism that failed. The CP4 is the delivery mechanism; IMV is the failure point. CP4 eliminated as independent P0088 cause.
- `sd4-67psd-injectors` (individually) — Each injector consumes rail pressure and returns excess. A failed-to-open injector solenoid marginally reduces consumption but the return path for that cylinder still exists. As isolated single-cylinder causes of a system-wide P0088, eliminated. (Multiple stuck-closed injectors are theoretically additive but would present with severe misfire codes before P0088.)
- `sd4-67psd-engine-gear-train` — Mechanical drive only; no pressure-regulation relationship. ELIMINATED.
- `sd4-67psd-instrument-cluster`, `sd4-67psd-hs-can-bus`, `sd4-67psd-abs-tc-module` — Display/network/torque-management. No direct pressure-generation or pressure-relief role. ELIMINATED as causal candidates (retained as diagnostic access points).

**SCOPED SLICE:**
IMV → FRP Sensor → PRV → Return Circuit → PCM (exclusion)

---

### STEP 2 — CANDIDATE FAILURE ENUMERATION (ordered by prior probability)

**Candidate 1 — IMV stuck closed or excessive duty-cycle command**
- Failure description: The normally-open IMV solenoid fails mechanically stuck closed, or PCM commands duty cycle unusually high (more restriction), causing CP4 to over-pump.
- Location: `sd4-67psd-imv`, inside the CP4.2 pump body.
- Diagnostic signature: IMV duty cycle PID reads anomalously high at idle or spikes under load. Under load, rail pressure PID climbs past expected value (typically 26,000–29,000 PSI normal peak). IMV coil resistance out of spec if stuck due to winding fault.
- Confidence basis: TRAINING-CONFIRMED most common P0088 cause on 6.7 PSD platform.
- Eliminated by: IMV duty cycle PID normal at all scenarios AND IMV PWM waveform confirms PCM is commanding correctly AND IMV solenoid resistance within spec AND pressure normalizes after IMV replacement.

**Candidate 2 — FRP sensor false-high reading**
- Failure description: FRP sensor signal voltage drifts high (signal pin voltage rises relative to 5V reference), causing PCM to read rail pressure higher than actual mechanical pressure. PCM sets P0088 on sensed value.
- Location: `sd4-67psd-frp-sensor`, on the high-pressure rail.
- Diagnostic signature: FRP PID reads elevated at idle when mechanical pressure should be stable and predictable. Cross-check: signal voltage at connector does not correspond to expected pressure voltage curve. Under load, signal voltage spikes out of linear range. Waveform capture shows erratic trace under dynamic conditions.
- Confidence basis: TRAINING-CONFIRMED; sensor drift is a common P0088 false trigger on this platform.
- Eliminated by: FRP signal voltage at key-on maps correctly to known pressure/voltage curve AND waveform is clean under load AND 5V reference is confirmed stable.

**Candidate 3 — PRV stuck closed (mechanical over-pressure relief failure)**
- Failure description: Pressure relief valve spring-set has hardened, seat is gummed/corroded, or the valve body is scored. Rail pressure cannot bleed down through PRV even when it exceeds cracking pressure.
- Location: `sd4-67psd-pressure-relief-valve`, on the high-pressure rail(s). Note: model captures "whether one per rail or one total — not yet captured." This is a structural gap; technician should inspect both rails for PRV presence.
- Diagnostic signature: FRP PID at idle does not show normal PRV bleed-down events (occasional brief pressure drops visible as the PRV modulates). Under medium load, pressure climbs monotonically with no relief-valve activity. Physical inspection shows scored seat or stuck spring.
- Confidence basis: TRAINING-CONFIRMED cause of P0088; less common than IMV fault but direct mechanical failure.
- Eliminated by: PRV bleed-down PID shows normal relief events at idle AND physical inspection confirms valve operates freely AND pressure trace under load shows expected modulation.

**Candidate 4 — Return circuit restriction**
- Failure description: Restriction in the passive low-pressure return circuit (kinked hose, debris, or carbon accumulation in injector return galleries or line fittings). Back-pressure builds at injector return ports under sustained load, preventing normal return flow and driving residual rail pressure up.
- Location: `sd4-67psd-return-circuit`. Note: model captures "exact routing not yet captured — GAP." Technician must trace the physical return line from injectors to termination.
- Diagnostic signature: Return line back-pressure gauge reading elevated above normal (expected near-zero back-pressure; exact spec not in model — mark as "not yet captured"). Symptom is load-dependent (matches customer complaint). No IMV or FRP anomaly would coexist with a pure return restriction.
- Confidence basis: TRAINING-INFERRED (LOGIC). Model documents the return circuit and the fluid-direction connections from all 8 injectors to the return circuit to tank. Return restriction is a legitimate topology-derived failure mode.
- Eliminated by: Return circuit back-pressure within normal range (spec GAP — comparison to known-good required) AND return lines visually unobstructed AND pressure normalizes when return restriction is removed.

**Candidate 5 — PCM software / calibration fault**
- Failure description: PCM commands IMV with incorrect (too-closed) duty cycle due to software corruption, failed calibration update, or PCM hardware fault in the IMV driver circuit.
- Location: `sd4-67psd-pcm`, passenger-side firewall.
- Diagnostic signature: IMV duty cycle PID reads what appears normal for the command issued, but actual rail pressure is disproportionate to commanded IMV position. IMV solenoid electrical checks are clean. PRV is functional. Return circuit unobstructed. FRP sensor verified accurate.
- Confidence basis: TRAINING-INFERRED (PATTERN). Low prior probability on this platform without prior reprogramming event.
- Eliminated by: Confirming all other candidates are clean; PCM fault confirmed by substitution or factory Ford calibration reflash resolving symptom.

---

### STEP 3 — DIAGNOSTIC PATH (ordered by cost and leverage)

**Gate default: 95% confidence required before any destructive recommendation (component replacement, PRV removal, injector return disassembly).**

**Test 1 — FRP PID at idle** (REUSE: `sd4-67psd-test-frp-pid-idle`)
- Cost: zero (scan tool already connected for DTC pull)
- Eliminates: FRP false-high (if PID matches expected idle pressure) or flags it immediately
- Cumulative confidence after: ~30% (confirms whether over-pressure is real or sensor artifact)

**Test 2 — IMV duty cycle PID at idle** (REUSE: `sd4-67psd-test-imv-duty-cycle-pid`)
- Cost: zero (same scan session)
- Eliminates: IMV command-level anomaly at idle; confirms PCM is requesting normal regulation
- Cumulative confidence after: ~45%

**Test 3 — PRV bleed-down PID at idle** (REUSE: `sd4-67psd-test-prv-bleeddown-pid`)
- Cost: zero (same scan session, monitoring FRP PID for PRV activity events)
- Eliminates: PRV stuck closed (if relief events present) or flags it
- Cumulative confidence after: ~55%

**Test 4 — FRP PID under medium load** (NEW: `sd4-67psd-test-frp-pid-medium-load`)
- Cost: low — road test or snap-throttle in bay
- Eliminates: Sensor drift that only appears dynamically; confirms whether pressure spike is real or sensor artifact under load; directly replicates customer complaint scenario
- Cumulative confidence after: ~65%

**Test 5 — FRP waveform capture under load** (NEW: `sd4-67psd-test-frp-waveform-load`)
- Cost: low-medium — scope connection at FRP connector during test drive or snap-throttle
- Eliminates: Sensor false-high with high confidence if signal voltage traces cleanly against known curve; flags erratic sensor behavior
- Cumulative confidence after: ~72%

**Test 6 — FRP 5V reference and signal voltage at connector** (REUSE: `sd4-67psd-test-frp-5v-ref-at-connector` and `sd4-67psd-test-frp-signal-at-connector`)
- Cost: low — backprobe at connector, key-on
- Eliminates: Reference voltage fault (collapsed 5V ref = sensor cannot read accurately) and confirms signal voltage at rest maps to expected pressure for key-on dead-head scenario
- Cumulative confidence after: ~78%

**Test 7 — IMV PWM waveform at idle** (NEW: `sd4-67psd-test-imv-pwm-waveform-idle`)
- Cost: medium — scope connection at IMV connector
- Eliminates: PCM output-driver fault (confirms the command signal is reaching the valve); crosses into IMV mechanical territory if waveform is clean but duty cycle PID is anomalous
- Cumulative confidence after: ~83%

**Test 8 — IMV solenoid resistance key-off** (NEW: `sd4-67psd-test-imv-solenoid-resistance`)
- Cost: low — DVOM at IMV connector, key-off
- Eliminates: IMV winding fault (open/shorted coil that prevents electromechanical actuation); coil resistance spec is NOT in the model — mark as GAP; technician should reference Ford WSM or known-good comparison
- Cumulative confidence after: ~87%

**Test 9 — PRV external leak visual** (NEW: `sd4-67psd-test-prv-external-leak`)
- Cost: low — visual inspection at rail with light
- Eliminates: PRV weeping/leaking under pressure (would lower pressure, not raise); confirms PRV body integrity before physical removal
- Cumulative confidence after: ~89%

**Test 10 — Return circuit backpressure** (NEW: `sd4-67psd-test-return-backpressure`)
- Cost: medium — pressure gauge T'd into injector return fitting at idle; requires return line access
- Eliminates: Return restriction as cause; back-pressure spec is a MODEL GAP — technician must use known-good comparison or Ford WSM value
- Cumulative confidence after: ~93%

**GATE CHECK after Test 10: ~93% — BELOW 95% gate.**
- Still below gate. Remaining uncertainty: PRV mechanical condition not confirmed by internal inspection.
- Refuse destructive PRV removal until internal inspection test is executed OR technician accepts <95% confidence and documents it.

**Test 11 — PRV internal condition** (NEW: `sd4-67psd-test-prv-internal-condition`)
- Cost: high — PRV removal from rail; high-pressure fitting; requires rail depressurization; invasiveness 4
- Eliminates: PRV stuck closed as definitive confirmation or elimination
- NOTE: Model gap — PRV count (one per rail vs. one total) not captured. Inspect both rails if two PRVs exist.
- Cumulative confidence after: ~97% (ABOVE 95% gate if all prior tests are consistent)

**GATE STATUS after Test 11 (if all prior tests consistent): ABOVE GATE — commit recommendation permissible.**

---

### STEP 4 — SCENARIO RELEVANCE FOR P0088

Scenarios from the platform model that matter for this symptom:
- **key-on** — FRP reference voltage check, signal voltage baseline, IMV duty cycle baseline
- **idle** — FRP PID monitoring, IMV duty cycle PID, PRV bleed-down events, IMV waveform, return backpressure with engine running
- **medium-load** — Replicates customer complaint; the only scenario where the over-pressure spike (real or sensed) is captured dynamically
- **key-off** — IMV solenoid resistance, PRV external leak visual, PRV internal inspection, return circuit visual routing check

Scenarios NOT needed for P0088:
- **cranking** — No value; pressure management is not observable during cranking for over-pressure diagnosis
- **heavy-load** — Medium-load replicates the complaint; heavy-load adds risk without diagnostic gain until medium-load data is reviewed
- **hot-soak** — No evidence this DTC has a hot-soak presentation on this vehicle
- **none** — Not applicable here

---

### STEP 5 — REFUSAL PROTOCOL / GATE STATUS SUMMARY

**Current state (no prior test results — first diagnostic step):**
- Confidence: 0%
- Status: BELOW GATE — no destructive actions permissible
- No component replacement recommended
- No high-pressure fitting removal recommended
- PRV internal inspection (Test 11) is invasive (rating 4) — held behind gate

**Known model gaps that affect this diagnostic:**
1. IMV coil resistance specification — not in model; technician must source from Ford WSM or known-good
2. PRV count (one per rail or one total) — not in model; inspect both rails physically
3. PRV cracking pressure specification — not in model; cannot quantify "too high"; PRV bleed-down PID provides behavioral evidence but not a calibrated value
4. Return circuit routing and back-pressure specification — not in model; known-good comparison required for Test 10
5. FRP sensor pressure-to-voltage curve — not explicitly in model; cross-referencing signal voltage to expected curve requires Ford WSM spec; TRAINING-CONFIRMED that the curve exists and is derivable, but the exact kPa/V relationship is a model GAP

**THIN-INPUT NOTE:** No prior test results were supplied. The diagnostic path above begins at Test 1 with no assumptions about where the fault lies. All five candidates remain live.

**IMPOSSIBILITY HALT check:** No impossibilities detected. P0088 on this vehicle has well-established hardware candidates, all present in the structured model.

**CONTRADICTION HALT check:** No contradictions. Stable idle + rough under load is consistent with all five candidates (sensor drift, IMV, PRV, return restriction all present most severely under load conditions).

---

## SECTION 2 — JSON SIDECAR

```json
{
  "symptom": {
    "slug": "p0088-fuel-rail-pressure-too-high",
    "description": "P0088 — Fuel Rail / System Pressure Too High. Customer reports rough running and occasional power loss under load; idle is stable. DTC set under load conditions on a 2018 Ford F-250 6.7L Power Stroke Diesel. First diagnostic step; no prior test results.",
    "category": "dtc"
  },
  "test_actions": [
    {
      "slug": "sd4-67psd-test-frp-pid-medium-load",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Monitor FRP sensor PID live data during medium-load acceleration (road test or controlled snap-throttle in bay) to capture the over-pressure event that matches the customer complaint. Observe whether rail pressure climbs beyond normal peak and whether the spike correlates with DTC set conditions.",
      "scenario_required": "medium-load",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "PSI",
      "expected_tolerance": null,
      "expected_observation": "Normal peak rail pressure on 6.7 PSD under medium load is approximately 23,000–26,000 PSI. P0088 threshold is not yet captured in model. An abnormal reading would show pressure climbing toward or past 29,000 PSI with no relief-valve bleed-down event. A sensor-false scenario may show an erratic or disproportionate spike relative to load demand.",
      "invasiveness": 1,
      "confidence_boost": 20,
      "source_citation": "6.7 PSD common rail operating pressure range and P0088 threshold are TRAINING-CONFIRMED for this platform; exact OEM threshold value is a model gap.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-frp-waveform-load",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Capture FRP sensor signal voltage waveform at the sensor harness connector signal pin during medium-load operation (snap-throttle or road test). Compare signal voltage ramp against the expected linear pressure-to-voltage curve. An erratic, non-linear, or out-of-range voltage trace indicates sensor false-high; a clean trace proportional to load confirms real over-pressure.",
      "scenario_required": "medium-load",
      "observation_method": "waveform_capture",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "V",
      "expected_tolerance": null,
      "expected_observation": "FRP sensor output voltage should rise linearly and smoothly with increasing pressure. Expected voltage range is approximately 0.5V (low pressure) to 4.5V (max pressure) proportional to rail pressure PID reading. A spike to near 5V with no corresponding mechanical evidence, erratic high-frequency noise on the trace, or a trace that diverges from the PID value indicates sensor false-high. Note: exact voltage-to-pressure curve spec is a model gap — cross-reference Ford WSM.",
      "invasiveness": 2,
      "confidence_boost": 12,
      "source_citation": "3-wire analog pressure sensor voltage behavior (0.5–4.5V proportional) is TRAINING-CONFIRMED generic; exact Ford WSM curve spec for this sensor is a model gap.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-imv-pwm-waveform-idle",
      "component_slug": "sd4-67psd-imv",
      "description": "Capture the IMV solenoid PWM waveform at the IMV connector while the engine is at idle. Confirm the PCM is outputting a valid PWM signal and that duty cycle at the connector matches the IMV duty cycle PID. A waveform that is absent, clipped, or does not match the commanded PID value indicates a PCM driver fault or harness fault, not an IMV mechanical fault.",
      "scenario_required": "idle",
      "observation_method": "waveform_capture",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "A clean PWM square wave should be present at the IMV connector with frequency and duty cycle matching the IMV PID reading. Exact PWM frequency spec for the 6.7 PSD IMV is a model gap — PWM frequency and duty-cycle range not yet captured. A missing or severely distorted waveform with a normal PID reading indicates a harness fault between PCM and IMV. A clean waveform with normal duty cycle but persistent over-pressure directs suspicion to IMV mechanical sticking, not PCM command.",
      "invasiveness": 2,
      "confidence_boost": 8,
      "source_citation": "IMV PWM electrical contract partially captured in model (normally-open PWM solenoid; frequency, duty-cycle range, and coil resistance not yet captured). Waveform approach is TRAINING-CONFIRMED diagnostic method for solenoid command verification.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-imv-solenoid-resistance",
      "component_slug": "sd4-67psd-imv",
      "description": "With key-off and IMV connector unplugged, measure IMV solenoid coil resistance at the harness connector (component side). An open circuit (OL), a short to ground (near 0 ohms), or a reading significantly outside spec indicates an internal IMV coil fault. A normal resistance reading eliminates electrical coil failure and directs suspicion to mechanical sticking.",
      "scenario_required": "key-off",
      "observation_method": "electrical_measurement_at_pin",
      "meter_mode": "resistance",
      "expected_value": null,
      "expected_unit": "ohms",
      "expected_tolerance": null,
      "expected_observation": "IMV solenoid coil resistance specification is a model gap — exact value not yet captured. Technician must reference Ford WSM or compare to a known-good IMV. OL (open circuit) or near-0 ohms (short) are definitive failures regardless of spec. A within-spec reading eliminates coil winding as the failure mode.",
      "invasiveness": 2,
      "confidence_boost": 8,
      "source_citation": "IMV electrical contract in model states 'wire count, PWM frequency, duty-cycle range, and coil resistance not yet captured.' Resistance measurement approach for PWM solenoid integrity is TRAINING-CONFIRMED.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-prv-external-leak",
      "component_slug": "sd4-67psd-pressure-relief-valve",
      "description": "With key-off and engine cool, visually inspect the pressure relief valve body and the area immediately surrounding it on the high-pressure rail for evidence of external fuel leakage (wet spots, dried fuel residue, fuel odor at the valve). A weeping or fully open PRV would lower rail pressure (not raise it) and would present as fuel seepage at the valve location. This test confirms the PRV body is sealed before physical removal.",
      "scenario_required": "key-off",
      "observation_method": "direct_visual_external",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "No fuel seepage, wet residue, or staining at the PRV body or fitting. Any fuel presence at the PRV on a P0088 case is unexpected (a leaking PRV relieves pressure — the opposite of stuck-closed) and would indicate a co-existing PRV leak that is masking a higher underlying pressure. A dry, clean PRV body is consistent with stuck-closed or normally functioning PRV and does not eliminate the stuck-closed failure mode — physical removal (Test 11) is required for that. Note: model gap on PRV count (one total vs. one per rail) — inspect both rail locations if two PRVs are present.",
      "invasiveness": 1,
      "confidence_boost": 4,
      "source_citation": "PRV location in model: 'on the high-pressure fuel rail(s); whether one per rail or one total not yet captured.' External visual is TRAINING-CONFIRMED standard inspection step before high-pressure fitting removal.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-return-backpressure",
      "component_slug": "sd4-67psd-return-circuit",
      "description": "Install a low-pressure gauge at an accessible injector return fitting (or return line junction point) and measure return circuit back-pressure with the engine running at idle. Elevated back-pressure indicates a downstream restriction in the return circuit that is preventing normal return flow from the injectors, contributing to residual rail pressure accumulation under load.",
      "scenario_required": "idle",
      "observation_method": "pressure_test_with_gauge",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "PSI",
      "expected_tolerance": null,
      "expected_observation": "Return circuit back-pressure specification is a model gap — exact spec not yet captured. Expected is near-zero to very low pressure (passive gravity-return system with no return pump). Any reading above a few PSI warrants further investigation for downstream restriction. Technician must reference Ford WSM or compare to a known-good vehicle. Note: model gap on return circuit routing — 'exact routing not yet captured.' Technician must identify the physically accessible measurement point on this vehicle.",
      "invasiveness": 3,
      "confidence_boost": 8,
      "source_citation": "Return circuit described in model as 'passive (no return pump).' Back-pressure measurement as a restriction test is TRAINING-INFERRED via LOGIC from the passive return system topology. Spec is a model gap.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-prv-internal-condition",
      "component_slug": "sd4-67psd-pressure-relief-valve",
      "description": "INVASIVE — execute only after gate is reached (95% confidence) or with documented technician acceptance of sub-gate confidence. Remove the pressure relief valve from the rail per Ford WSM procedure. Inspect the valve seat, spring, and body for carbon buildup, corrosion, scoring, or physical deformation that would prevent the valve from opening at its factory cracking pressure. A stuck, scored, or non-functioning PRV confirms Candidate 3.",
      "scenario_required": "key-off",
      "observation_method": "direct_visual_internal",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "A serviceable PRV should have a clean, undamaged seat, a free-moving spring, and no evidence of carbon fouling or corrosion that would hold it closed. The valve should be manually depressible (spring gives when pressed). A PRV that is stuck solid, has a scored seat, or whose spring is collapsed or corroded is a definitive failure confirmation. PRV cracking pressure specification is a model gap — no quantitative bench-test value available from current model data.",
      "invasiveness": 4,
      "confidence_boost": 8,
      "source_citation": "PRV function described in model as 'passive mechanical overpressure protection; opens at factory-set cracking pressure.' Internal inspection is TRAINING-INFERRED via LOGIC as the definitive mechanical confirmation method. Cracking pressure spec is a model gap.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ],
  "branch_logic": [
    {
      "slug": "sd4-67psd-branch-frp-idle-normal",
      "test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "condition": "FRP PID at idle reads within expected normal idle pressure range (approximately 4,000–6,000 PSI at warm idle — model gap; use Ford WSM spec)",
      "verdict": "ok",
      "next_action": "Proceed to IMV duty cycle check; idle pressure is not the anomaly — over-pressure is load-dependent or sensor artifact.",
      "routes_to_test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "reasoning": "Normal idle FRP PID narrows the fault to a load-triggered event: IMV failure that manifests only under increased commanded duty cycle, sensor drift that appears under dynamic conditions, PRV that fails only under elevated pressure, or return restriction that builds only under sustained load.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-idle-elevated",
      "test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "condition": "FRP PID at idle reads persistently elevated (outside expected idle pressure range) with stable idle quality",
      "verdict": "warn",
      "next_action": "Cross-check FRP signal voltage at connector to distinguish real over-pressure from sensor false-high before proceeding.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "reasoning": "Elevated FRP PID at idle with stable idle quality is more consistent with sensor false-high than actual mechanical over-pressure (true over-pressure at idle would typically cause rough idle or PRV activity). Verifying 5V reference and signal voltage is the fastest, cheapest differentiator.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-imv-duty-normal",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "condition": "IMV duty cycle PID at idle reads within normal expected range (approximately 50–70% at warm idle — model gap; exact range not captured)",
      "verdict": "ok",
      "next_action": "IMV command is normal at idle. Proceed to PRV bleed-down observation and then medium-load FRP PID to capture the load-triggered event.",
      "routes_to_test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "reasoning": "Normal IMV duty at idle does not eliminate IMV mechanical sticking (the valve may stick only under high duty-cycle commands at load). It does eliminate PCM command-level fault at idle conditions. Continue to PRV and then load testing.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-imv-duty-high",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "condition": "IMV duty cycle PID reads anomalously high at idle (well above expected idle range, indicating PCM is commanding excessive restriction even at idle)",
      "verdict": "fail",
      "next_action": "Abnormal IMV command at idle. Escalate to IMV PWM waveform to determine if the fault is PCM output (driver or software) or IMV mechanical.",
      "routes_to_test_action_slug": "sd4-67psd-test-imv-pwm-waveform-idle",
      "reasoning": "High IMV duty cycle at idle is an active PCM command signal issue or a feedback loop fault. The waveform will distinguish between PCM driver output (waveform fault = PCM/harness) and IMV mechanical non-compliance (clean waveform + high PID + over-pressure = IMV stuck mechanically).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-prv-pid-normal",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "condition": "FRP PID trace at idle shows expected occasional brief pressure drops consistent with PRV modulating (bleed-down events visible in live data)",
      "verdict": "ok",
      "next_action": "PRV is opening at idle pressures. Proceed to medium-load FRP PID to capture the load-triggered over-pressure event.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-pid-medium-load",
      "reasoning": "PRV opening at idle indicates the valve mechanism is functional at idle-range pressures. However, PRV may still fail to open at higher load-range pressures if the fault is pressure-threshold-specific. Continue to load test before clearing PRV as a candidate.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-pid-no-events",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "condition": "FRP PID trace at idle shows no PRV bleed-down events over an extended observation period (pressure builds and holds monotonically with no brief drops)",
      "verdict": "warn",
      "next_action": "Absence of PRV events at idle is suspicious. Could indicate PRV stuck closed OR that idle pressure simply never reaches cracking threshold. Escalate to medium-load FRP PID to capture peak pressure, then PRV external inspection.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-pid-medium-load",
      "reasoning": "PRV bleed-down events are most visible under higher pressure conditions. Absence at idle alone is not conclusive for stuck-closed — the cracking pressure threshold may simply not be reached. Load test first to establish peak pressure, then physically inspect PRV.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-load-spike",
      "test_action_slug": "sd4-67psd-test-frp-pid-medium-load",
      "condition": "FRP PID climbs to or past expected maximum peak pressure under medium load with no corresponding PRV bleed-down event; rough running / power loss symptoms present",
      "verdict": "fail",
      "next_action": "Real over-pressure confirmed dynamically. Two leading candidates: IMV mechanically stuck closed under load, or PRV mechanically stuck closed. Proceed to FRP waveform capture to verify sensor accuracy, then investigate both IMV and PRV.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-waveform-load",
      "reasoning": "A genuine pressure spike under load with absent PRV relief points to a real hydraulic over-pressure event. Waveform capture will either confirm sensor accuracy (validating the PID reading) or reveal sensor distortion (shifting suspicion to sensor false-high). Both scenarios need resolution before component recommendation.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-load-normal",
      "test_action_slug": "sd4-67psd-test-frp-pid-medium-load",
      "condition": "FRP PID under medium load shows normal pressure values within expected peak range with no spike",
      "verdict": "ok",
      "next_action": "Over-pressure not reproduced under medium load. DTC may be intermittent or sensor-artifact. Proceed to FRP waveform under load and sensor voltage cross-check to investigate sensor drift that may have set the DTC without a real pressure event.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-waveform-load",
      "reasoning": "If pressure appears normal under load, the DTC was either set by a transient event, by sensor drift, or requires heavier load to reproduce. Waveform capture is next to look for subtle sensor signal instability that could cause intermittent P0088 without the PID showing it.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-waveform-erratic",
      "test_action_slug": "sd4-67psd-test-frp-waveform-load",
      "condition": "FRP signal voltage waveform under load is erratic, spikes non-linearly, or diverges significantly from the PID reading",
      "verdict": "fail",
      "next_action": "Sensor false-high confirmed as active contributor. Verify 5V reference stability and signal voltage at connector to quantify the sensor error before replacement recommendation.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "reasoning": "An erratic waveform that does not correspond to expected pressure-proportional voltage is definitive evidence of sensor fault. Cross-checking the 5V reference eliminates reference voltage collapse as the cause before condemning the sensor itself.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-waveform-clean",
      "test_action_slug": "sd4-67psd-test-frp-waveform-load",
      "condition": "FRP signal voltage waveform under load is clean, linear, and consistent with the PID reading",
      "verdict": "ok",
      "next_action": "Sensor is reading accurately. Over-pressure confirmed as real mechanical event. Proceed to IMV electrical investigation and return circuit back-pressure test.",
      "routes_to_test_action_slug": "sd4-67psd-test-imv-solenoid-resistance",
      "reasoning": "Clean waveform matching the PID eliminates sensor false-high and confirms a genuine hydraulic over-pressure condition. IMV and PRV remain as the primary hardware candidates. IMV resistance is the next lowest-cost electrical check.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-5v-ref-ok",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "condition": "5V reference at FRP connector measures 4.9–5.1V (stable)",
      "verdict": "ok",
      "next_action": "Reference supply is stable. Proceed to FRP signal voltage cross-check.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "reasoning": "5V reference within tolerance eliminates reference voltage collapse as the cause of any sensor reading anomaly. Signal voltage cross-check is the next step.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-5v-ref-low",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "condition": "5V reference at FRP connector measures below 4.7V or is unstable/fluctuating",
      "verdict": "fail",
      "next_action": "Reference voltage fault. The FRP sensor cannot produce an accurate reading without a stable 5V reference. Trace the reference circuit to PCM. Do not condemn the FRP sensor until the reference is repaired and pressure behavior re-evaluated.",
      "routes_to_test_action_slug": null,
      "reasoning": "A collapsed or noisy 5V reference causes the FRP sensor signal to be proportionally inaccurate. This is a PCM output or harness fault, not a sensor fault. Replacing the sensor without fixing the reference will not resolve P0088.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-signal-high-at-rest",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "condition": "FRP signal voltage at connector with engine key-on (not running) reads above expected low-pressure resting value (above approximately 1.0V key-on engine-off)",
      "verdict": "fail",
      "next_action": "Sensor is outputting a false-high signal at rest. Sensor replacement is the leading recommendation. Confirm with medium-load PID after replacement to verify symptom resolution.",
      "routes_to_test_action_slug": null,
      "reasoning": "A sensor that reads high with the engine off (no fuel pressure generated) has a mechanical or electrical fault internal to the sensor producing a false-high signal. This directly explains P0088 without any hydraulic fault. Exact resting voltage spec is a model gap — reference Ford WSM for key-on engine-off expected value.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-imv-resistance-ooc",
      "test_action_slug": "sd4-67psd-test-imv-solenoid-resistance",
      "condition": "IMV solenoid resistance reads OL (open circuit) or significantly outside spec (short to ground near 0 ohms, or high-resistance drift beyond spec range)",
      "verdict": "fail",
      "next_action": "IMV coil has an internal electrical fault. The valve cannot be commanded accurately. IMV replacement is indicated. GATE CHECK: coil fault alone does not reach 95% confidence — confirm return circuit and PRV status before component recommendation unless above-gate confidence is achieved by other tests.",
      "routes_to_test_action_slug": "sd4-67psd-test-return-backpressure",
      "reasoning": "An OL or out-of-spec IMV coil means the PCM PWM command cannot produce the intended solenoid force. A normally-open valve with an open coil will hang in the open position (under-pressure result), but a short or partial resistance fault can cause the valve to close further than commanded. Confirming return circuit and PRV status before recommending replacement covers co-existing faults.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-imv-resistance-ok",
      "test_action_slug": "sd4-67psd-test-imv-solenoid-resistance",
      "condition": "IMV solenoid resistance reads within specification range",
      "verdict": "ok",
      "next_action": "IMV coil is electrically intact. Mechanical sticking of the valve body remains possible (coil ok does not mean valve moves freely). Proceed to return backpressure test and then PRV inspection.",
      "routes_to_test_action_slug": "sd4-67psd-test-return-backpressure",
      "reasoning": "A within-spec coil resistance eliminates winding failure. IMV mechanical sticking (debris on the valve needle, varnish buildup) is still possible and would not be caught by a resistance test. Return circuit and PRV investigation continue in parallel.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-imv-waveform-fault",
      "test_action_slug": "sd4-67psd-test-imv-pwm-waveform-idle",
      "condition": "IMV PWM waveform at connector is absent, severely distorted, or does not match the commanded duty cycle PID",
      "verdict": "fail",
      "next_action": "PCM driver output or harness fault between PCM and IMV connector. Trace the harness. If harness is intact, suspect PCM driver circuit. Do not condemn IMV until command signal is verified clean.",
      "routes_to_test_action_slug": null,
      "reasoning": "The IMV cannot respond to a command it is not receiving. A fault in the drive circuit means the IMV is not being controlled as the PID suggests. This is a higher-level electrical fault that must be resolved before any IMV mechanical conclusion.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-imv-waveform-ok",
      "test_action_slug": "sd4-67psd-test-imv-pwm-waveform-idle",
      "condition": "IMV PWM waveform at connector is clean with correct duty cycle matching PID",
      "verdict": "ok",
      "next_action": "PCM command signal is reaching the IMV correctly. If over-pressure still present, IMV mechanical sticking (valve not following command) or PRV stuck closed remain as leading candidates.",
      "routes_to_test_action_slug": "sd4-67psd-test-imv-solenoid-resistance",
      "reasoning": "A clean waveform confirms the PCM is commanding correctly and the harness is intact. The fault is either IMV mechanical (valve not responding to electrical command) or PRV (pressure cannot be relieved even when IMV is working correctly). Coil resistance check next.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-return-backpressure-elevated",
      "test_action_slug": "sd4-67psd-test-return-backpressure",
      "condition": "Return circuit back-pressure at idle reads above expected near-zero value (spec gap — use Ford WSM or known-good comparison)",
      "verdict": "fail",
      "next_action": "Return restriction confirmed as active contributor. Trace return line routing for kinks, collapsed sections, or blocked fittings. Return circuit routing is a model gap — physical tracing required.",
      "routes_to_test_action_slug": "sd4-67psd-test-prv-external-leak",
      "reasoning": "Elevated back-pressure at idle means the return circuit is restricting fuel escape under all conditions. Under load, this restriction compounds — residual pressure accumulates in the rail and adds to whatever the CP4 is delivering. The return line must be physically traced and the restriction located before any IMV or PRV recommendation, since return restriction can produce P0088 independently.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-return-backpressure-ok",
      "test_action_slug": "sd4-67psd-test-return-backpressure",
      "condition": "Return circuit back-pressure at idle reads within expected range (near-zero for passive return)",
      "verdict": "ok",
      "next_action": "Return circuit is not restricting. Return restriction eliminated. Proceed to PRV external inspection and then internal inspection if not yet at gate.",
      "routes_to_test_action_slug": "sd4-67psd-test-prv-external-leak",
      "reasoning": "Normal return backpressure eliminates return restriction as a standalone P0088 cause. Remaining candidates are IMV mechanical sticking and PRV stuck closed. PRV investigation is the next non-destructive step.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-external-clean",
      "test_action_slug": "sd4-67psd-test-prv-external-leak",
      "condition": "No fuel seepage, staining, or wet residue visible at PRV body or fitting",
      "verdict": "ok",
      "next_action": "PRV body is sealed externally. Stuck-closed failure mode remains possible. If overall confidence is still below 95% gate, proceed to PRV internal inspection.",
      "routes_to_test_action_slug": "sd4-67psd-test-prv-internal-condition",
      "reasoning": "A dry PRV is consistent with both a functioning PRV and a stuck-closed PRV — no external leak is expected in either case. External visual does not clear the PRV as a candidate; internal inspection is required for definitive elimination.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-prv-external-leaking",
      "test_action_slug": "sd4-67psd-test-prv-external-leak",
      "condition": "Fuel seepage or staining visible at PRV body — valve is leaking externally",
      "verdict": "warn",
      "next_action": "PRV external leak is unexpected for P0088 (a leaking PRV relieves pressure, contradicting over-pressure). This is a co-existing fault. The over-pressure cause is elsewhere (IMV or sensor false-high). Address PRV leak as a separate repair after confirming P0088 root cause. Do not halt P0088 path.",
      "routes_to_test_action_slug": "sd4-67psd-test-prv-internal-condition",
      "reasoning": "An externally leaking PRV is relevant to safety and fuel integrity but does not explain P0088. A leaking PRV would tend to lower rail pressure. The over-pressure DTC implies the PRV is either sealed (possibly stuck closed) or that the real cause is IMV or sensor. Continue investigation.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-internal-stuck",
      "test_action_slug": "sd4-67psd-test-prv-internal-condition",
      "condition": "PRV is stuck closed, has a scored seat, a collapsed or corroded spring, or carbon fouling that prevents valve movement",
      "verdict": "fail",
      "next_action": "PRV stuck closed confirmed as a definitive P0088 cause. GATE CHECK: if all prior tests (FRP sensor verified accurate, IMV command and electrical verified normal, return circuit clear) are clean, this represents a single-root-cause finding. Gate reached — PRV replacement recommended with post-repair verification via medium-load FRP PID.",
      "routes_to_test_action_slug": null,
      "reasoning": "A physically non-functioning PRV cannot relieve rail pressure when it exceeds cracking pressure. Under load, pressure rises unabated, CP4 continues to deliver, injectors consume but cannot relieve fast enough, and P0088 sets. This is a definitive mechanical failure confirmation.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-internal-ok",
      "test_action_slug": "sd4-67psd-test-prv-internal-condition",
      "condition": "PRV valve, seat, and spring are visually clean and mechanically functional (spring gives when compressed, seat is undamaged)",
      "verdict": "ok",
      "next_action": "PRV eliminated as a mechanical cause. If all other hardware checks (FRP sensor, IMV electrical, return circuit) are also clean, remaining candidate is IMV mechanical sticking (not detectable by electrical tests alone) or PCM software fault. IMV replacement as a test-by-replacement is the next step if gate confidence permits, or PCM reprogramming/substitution if IMV replacement resolves nothing.",
      "routes_to_test_action_slug": null,
      "reasoning": "With PRV mechanically functional, FRP sensor accurate, return circuit clear, and IMV electrically intact, the remaining possibility is an IMV valve-needle mechanical fault that passes electrical tests but physically sticks under high-duty-cycle command conditions. This is the 'everything else normal' scenario that points to IMV or PCM. Gate status must be confirmed against accumulated test results before replacement is recommended.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ],
  "symptom_test_implications": [
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "priority": 1,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "priority": 2,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "priority": 3,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-frp-pid-medium-load",
      "priority": 4,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-frp-waveform-load",
      "priority": 5,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "priority": 6,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "priority": 7,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-imv-pwm-waveform-idle",
      "priority": 8,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-imv-solenoid-resistance",
      "priority": 9,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-prv-external-leak",
      "priority": 8,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-return-backpressure",
      "priority": 7,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "p0088-fuel-rail-pressure-too-high",
      "test_action_slug": "sd4-67psd-test-prv-internal-condition",
      "priority": 10,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ]
}
```
