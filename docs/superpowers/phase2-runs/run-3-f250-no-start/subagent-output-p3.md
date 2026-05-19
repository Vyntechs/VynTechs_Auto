# Run 3 — F-250 6.7L PSD No-Start Diagnostic
## Prompt 3 Output: Scope / Path / Gate Status + JSON Sidecar

---

## SECTION 1 — SCOPE / PATH / GATE STATUS

### STEP 1 — SYMPTOM SCOPING

**Symptom:** 2018 Ford F-250 6.7L PSD cranks normally but will not fire. Battery and starter confirmed good by customer report. No compression issue suspected. No DTCs stored (or not yet read; DTC scan is step zero).

**Implicated subsystems from structured model:**

The fuel delivery chain is the primary suspect. The 6.7L PSD is a compression-ignition engine — there is no spark system. The equivalent of "ignition signal" on a diesel is: (a) cam/crank signal confirming engine rotation is being sensed, and (b) injector command pulses confirming the PCM is trying to inject. Both are observable through scan-tool PIDs on the HS-CAN bus.

Implicated components (from structured model):
1. fuel-tank — is there fuel?
2. fuel-level-sender — is the gauge reading real?
3. lift-pump-relay — is the lift pump even powered?
4. lift-pump — is low-pressure fuel reaching the filter?
5. fuel-filter-ws — is it restricted, full of water, or full of gel?
6. wif-sensor — is the PCM seeing water contamination?
7. cp4-pump — is the high-pressure pump receiving adequate supply and spinning?
8. imv — is the PCM commanding the IMV to allow fuel into the CP4 high-pressure circuit?
9. frp-sensor — is rail pressure building during crank, and is the sensor reading it accurately?
10. hp-rail-bank-a / hp-rail-bank-b — are the rails holding pressure during crank?
11. injectors 1–8 (all) — is the PCM commanding injection events during crank?
12. pcm — is the controller even running and commanding the system?
13. hs-can-bus — can the scan tool talk to the PCM at all?
14. engine-gear-train — is the CP4 mechanically driven (cranking RPM implies it is, but zero rail pressure build-up could indicate a spun/stripped gear — this is a PATTERN-level concern for catastrophic events only)

**Eliminated by topology / control logic (cannot cause this symptom as primary):**
- def-tank / def-dosing-system: DEF is an emissions aftertreatment system; it does not affect engine combustion start. A DEF fault can impose derate after the engine is running, but it does not prevent initial start. ELIMINATED.
- abs-tc-module: No control authority over fuel delivery or injector firing. ELIMINATED.
- instrument-cluster: Display only. A faulty cluster cannot prevent starting. ELIMINATED.
- pressure-relief-valve: The PRV is a passive mechanical overpressure device. During a cold no-start with brief cranking, rail pressure will never build high enough to open it. It cannot prevent pressure from building. ELIMINATED as primary (could be relevant if rail pressure is building but bleeding down instantly — that would require cross-referencing FRP PID trace).
- return-circuit: A restriction in the return circuit would cause rail overpressure, not a no-start. A total return line failure could theoretically pin the injectors open, but that scenario is extremely rare and would produce other symptoms (hard injection knock, fuel in oil). Not a first-order candidate. PARKED — revisit only if rail pressure reads absurdly high during crank.

**Model gaps relevant to this symptom:**

The following facts needed for complete diagnosis are marked as not-yet-captured in the model:
- Crank sensor (crankshaft position sensor) is NOT a component in the structured model. This is a GAP. A failed crank sensor is a known no-start cause on this platform — the PCM will not fire injectors without a valid RPM/position signal. THIS GAP IS SURFACED AS CONTENT: the diagnostic path will include a scan-tool RPM PID check during cranking as a proxy. If RPM reads zero or implausible during confirmed cranking, the crank/cam sensor circuit is suspect and falls outside the current model boundary.
- Cam sensor (camshaft position sensor) is NOT in the model. Same gap — affects injection phasing. Same proxy test applies.
- Intake air temperature / manifold pressure / glow plug system are not in the model. In extreme cold, glow plug failure can prevent cold starts, but customer context does not specify extreme cold. This gap is noted; the diagnostic path does not address glow plugs because the model has no basis for that content.
- Injector electrical contract (connector type, resistance spec, driver voltage) is flagged "not yet captured" for all 8 injectors. The model supports commanding-vs-not determination via PID but not a per-cylinder resistance check from the model's own data. Resistance spec is marked GAP below.
- IMV coil resistance spec: not yet captured in model.
- Lift pump connector/current specs: not yet captured.

---

### STEP 2 — CANDIDATE FAILURE ENUMERATION

Ordered by prior probability (most likely first):

1. **Empty or near-empty fuel tank**
   - Failure: no fuel to supply
   - Location: fuel-tank
   - Signature: gauge reads E or near-E; fuel level sender resistance at limit
   - Confidence basis: TRAINING-CONFIRMED — most common no-start cause across all platforms
   - Eliminated by: visual/gauge check (test sd4-67psd-test-fuel-level-visual, already exists)

2. **Lift pump not priming (relay fault, pump fault, or PCM not commanding)**
   - Failure: electric lift pump fails to run or runs but delivers no pressure; or relay not seating; or PCM not commanding relay
   - Location: lift-pump (sd4-67psd-lift-pump), lift-pump-relay (sd4-67psd-lift-pump-relay)
   - Signature: no audible prime on key-on; lift pump status PID shows OFF or fault; zero output pressure; relay not clicking
   - Confidence basis: TRAINING-CONFIRMED — loss of lift pump supply prevents CP4 inlet starvation, causes immediate high-pressure rail failure to build
   - Eliminated by: lift pump status PID (sd4-67psd-test-lift-pump-status-pid, exists), relay seating visual (sd4-67psd-test-relay-seating-visual, exists), lift pump supply voltage (sd4-67psd-test-lift-pump-supply-voltage, exists)

3. **Clogged / plugged fuel filter (restriction or gelled diesel)**
   - Failure: filter element severely restricted or waxed (in cold weather), starving CP4 inlet
   - Location: fuel-filter-ws (sd4-67psd-fuel-filter-ws)
   - Signature: CP4 inlet pressure below acceptable range; filter element appearance; diesel gel odor from drain
   - Confidence basis: TRAINING-CONFIRMED — especially common in cold climates; gelling can fully block filter overnight
   - Eliminated by: filter inspection (sd4-67psd-test-filter-element-inspection, exists), CP4 inlet pressure (sd4-67psd-test-cp4-inlet-pressure, exists)

4. **Water contamination in fuel (WIF active)**
   - Failure: water in fuel bowl displaces diesel from filter; CP4 receives water-diluted fuel, cannot build pressure
   - Location: wif-sensor / fuel-filter-ws
   - Signature: WIF PID active; water visible when drain opened; possible hydrolocked injectors (rare, worst case)
   - Confidence basis: TRAINING-CONFIRMED — WIF is a confirmed cause of no-start on this platform
   - Eliminated by: WIF status PID (sd4-67psd-test-wif-status-pid, exists)

5. **No rail pressure build during cranking (CP4 failure or IMV stuck closed)**
   - Failure: CP4 fails to pressurize rail during crank (worn CP4, broken drive gear, IMV stuck in closed position blocking fuel entry); rail pressure stays at zero or near-zero
   - Location: cp4-pump (sd4-67psd-cp4-pump) / imv (sd4-67psd-imv)
   - Signature: FRP PID at cranking shows zero or <500 PSI (model does not have exact min-crank threshold — marked as NOT YET CAPTURED); IMV duty cycle PID reads abnormally at key-on or shows stuck state
   - Confidence basis: TRAINING-CONFIRMED for CP4 failure; TRAINING-INFERRED for IMV stuck-closed specifically causing no-start (IMV is normally-open, so stuck-closed is the failure mode that starves CP4 — LOGIC inference)
   - LOGIC note on IMV: IMV is normally-open. If it fails electrically open-circuit, it defaults to fully open (max fuel delivery to CP4) — this would NOT cause no-start. If it fails stuck-closed (mechanical seizure or PCM commanding full-close due to a fault), it would starve CP4. The more common failure is the solenoid going open-circuit, which produces overcorrection and rough running, not no-start. IMV stuck-closed as no-start cause is lower probability than CP4 mechanical failure.
   - Eliminated by: FRP PID during cranking (NEW test needed — frp-pid-idle exists but cranking scenario is distinct), IMV duty cycle PID (sd4-67psd-test-imv-duty-cycle-pid, exists but is idle-scenario — also needs a cranking-scenario variant)

6. **PCM not commanding injectors during crank (no RPM/position signal or PCM fault)**
   - Failure: PCM receives no valid crank/cam signal during cranking, so it refuses to command injectors. Or PCM has internal driver fault. Result: injectors don't pulse even with adequate rail pressure.
   - Location: pcm (sd4-67psd-pcm); crank/cam sensors are outside current model boundary (GAP)
   - Signature: scan tool shows PCM communicating (CAN present); RPM PID shows zero or erratic during confirmed cranking; injector duty cycle PID shows zero during crank; no DTCs for cam/crank would be unusual but possible if PCM can't even parse the signal
   - Confidence basis: TRAINING-CONFIRMED for crank sensor no-start on diesel; model boundary gap acknowledged
   - Eliminated by: RPM during cranking PID (NEW test needed — engine RPM observable via PCM on HS-CAN during crank), injector duty cycle during cranking (NEW test needed)

7. **Wrong fuel type or severely contaminated fuel (gasoline misfueling, heavily diluted diesel)**
   - Failure: customer or prior service added gasoline or off-spec fuel; diesel will not ignite gasoline-diluted mixture at compression temperatures
   - Location: fuel-tank (sd4-67psd-fuel-tank), fuel-filter-ws drain (smell test)
   - Signature: smell of gasoline when filter drain opened or fuel cap removed; fuel level drop after known fill event
   - Confidence basis: TRAINING-CONFIRMED — misfueling is a real no-start cause; smell test is definitive
   - Eliminated by: fuel smell test at filter drain (NEW test — smell observation method exists in model)

8. **FRP sensor electrical fault reporting false zero pressure (PCM sees zero, refuses to fire injectors)**
   - Failure: FRP sensor 5V ref dead or signal wire shorted to ground; PCM reads zero or implausible rail pressure and inhibits injection as a protection measure — even if actual rail pressure is fine
   - Location: frp-sensor (sd4-67psd-frp-sensor)
   - Signature: FRP PID reads zero during crank despite adequate lift pump and CP4 operation; 5V ref absent at connector; no DTC (PCM may not set FRP code during initial crank if it interprets sensor as rational zero)
   - Confidence basis: TRAINING-INFERRED (LOGIC) — PCM uses FRP feedback for injection enable/quantity control; a false-zero could cause injection inhibit. This is lower-probability than supply-side failures but electrically verifiable cheaply.
   - Eliminated by: FRP 5V ref at connector (sd4-67psd-test-frp-5v-ref-at-connector, exists), FRP signal at connector (sd4-67psd-test-frp-signal-at-connector, exists)

9. **Injector mechanical failure (all 8 stuck closed or all 8 return paths blocked)**
   - Failure: universal injector failure across all 8 cylinders
   - Basis for LOW probability: 8 injectors failing simultaneously is extremely unlikely without a supply-side cause. This is essentially impossible as a primary no-start mechanism without other evidence. Injector failure presents as misfire / rough run when partial, not as a clean no-start across the board.
   - Status: EFFECTIVELY ELIMINATED as primary root cause. Revisit only if supply-side and PCM-command tests all pass AND injector PWM waveform during crank confirms command pulses are present.

10. **Mechanical CP4 drive failure (spun gear on front gear train)**
    - Failure: gear drive between crankshaft and CP4 fails mechanically; CP4 stops receiving mechanical drive
    - Signature: cranking RPM normal (starter still turns crank), zero rail pressure during crank, possible metallic debris in fuel, catastrophic CP4 contamination pattern
    - Probability note: If this occurred, you'd also have metal contamination throughout the fuel system. This is the worst-case scenario and is detectable only after supply-side and FRP tests. Low probability as initial assumption.
    - Eliminated by: FRP PID during cranking combined with CP4 inlet pressure test

---

### STEP 3 — DIAGNOSTIC PATH GENERATION

Path is ordered: cheapest/fastest non-destructive tests first, escalating invasiveness only when confidence gate not met.

**Cumulative confidence tracking:**
- Before any tests: ~15% (common platform, no data)
- After each step: updated below

**Step A (invasiveness 1): DTC scan + fuel level gauge check + fuel level visual**
- Reuses: sd4-67psd-test-fuel-level-visual (key-on, visual gauge read)
- New: DTC scan at OBD-II to catch any stored codes (PCM-connectivity confirmation)
- Scenario: key-on
- Cost: 0 (free, in-shop)
- Cumulative confidence: 25% (rule out empty tank, confirm PCM communicating)

**Step B (invasiveness 1): WIF status PID + lift pump status PID on scan tool (key-on)**
- Reuses: sd4-67psd-test-wif-status-pid, sd4-67psd-test-lift-pump-status-pid
- Confirms PCM is commanding lift pump; confirms no water contamination flag
- Cumulative confidence: 40%

**Step C (invasiveness 1): Fuel smell / contamination test at filter drain**
- New: sd4-67psd-test-fuel-quality-smell (smell observation, key-off)
- Detects gasoline misfueling or gel contamination before pressurizing anything
- Cumulative confidence: 50%

**Step D (invasiveness 1): Scan tool PIDs during cranking — RPM + FRP + IMV + injector duty cycle**
- New tests:
  - sd4-67psd-test-rpm-pid-cranking (scan tool RPM during crank — proxies cam/crank signal, component: pcm)
  - sd4-67psd-test-frp-pid-cranking (FRP PID during crank — new scenario vs. existing idle version)
  - sd4-67psd-test-imv-duty-cycle-cranking (IMV duty cycle during crank — new scenario)
  - sd4-67psd-test-injector-duty-cycle-cranking (injector commanded duty cycle during crank)
- Scenario: cranking
- Critical decision gate: if RPM shows zero → cam/crank sensor path (outside model, surface GAP); if FRP shows zero → supply-side / CP4 path; if FRP shows build but injectors show zero DC → PCM injection enable path
- Cumulative confidence: 70%

**Step E (invasiveness 2): FRP electrical check + lift pump relay seating visual**
- Reuses: sd4-67psd-test-frp-5v-ref-at-connector, sd4-67psd-test-frp-signal-at-connector, sd4-67psd-test-relay-seating-visual
- Confirms FRP sensor is electrically valid before condemning supply side
- Cumulative confidence: 78%

**Step F (invasiveness 2): Lift pump supply voltage + lift pump output pressure**
- Reuses: sd4-67psd-test-lift-pump-supply-voltage, sd4-67psd-test-lift-pump-output-pressure
- Confirms low-pressure supply is reaching filter
- Expected output pressure: model does not have exact spec — marked NOT YET CAPTURED; typical is 5–10 PSI at idle, spec during crank is similar; GAP noted
- Cumulative confidence: 84%

**Step G (invasiveness 2): Filter inspection + CP4 inlet pressure**
- Reuses: sd4-67psd-test-filter-element-inspection, sd4-67psd-test-cp4-inlet-pressure
- Confirms filter not restricted before condemning CP4
- Cumulative confidence: 91%

**Step H (invasiveness 3): Rail external leak visual + PRV bleed-down check**
- Reuses: sd4-67psd-test-hp-rail-external-leak, sd4-67psd-test-prv-bleeddown-pid
- Confirms high-pressure side is not leaking down (PRV not stuck open)
- Cumulative confidence: 94%

**GATE CHECK after Step H: 94% < 95% — gate not crossed. One more step required.**

**Step I (invasiveness 3): Injector PWM waveform during crank (representative cylinder)**
- New: sd4-67psd-test-injector-pwm-cranking (waveform capture at injector connector during crank)
- Confirms PCM is actually sending driver pulses to injectors during crank
- If pulses present + rail pressure building + supply confirmed → all supply-and-command paths confirmed; no-fire indicates injector mechanical failure or compression issue (outside model boundary)
- If pulses absent despite RPM signal and rail pressure → PCM driver fault
- Cumulative confidence: 96%

**GATE CROSSED: 96% ≥ 95%**

At gate crossing, the evidence chain is sufficient to either:
(a) Identify the specific failed subsystem with a commit recommendation, or
(b) Surface a boundary condition (cam/crank sensor GAP, injector mechanical failure outside model, compression issue outside model) with a structured referral.

**REFUSAL PROTOCOL activations noted:**
- Cam/crank sensor: model gap — OBSERVABILITY HALT for that specific sub-path. Surface as content: "RPM shows zero during cranking — crank or cam sensor circuit suspect; outside current model boundary; escalate to wiring diagram for crank sensor circuit."
- Injector specs (resistance, driver voltage): THIN-INPUT noted. Resistance test is not offered from model data; waveform capture is offered as the model-grounded alternative.
- CP4 inlet pressure expected value: model does not carry spec; test is offered as GAP-acknowledged content with "result should match lift pump output minus filter differential; exact pass/fail threshold not captured."

---

### STEP 4 — SCENARIO RELEVANCE

From the symptom, these scenarios from the model's scenario list are relevant:
- **key-on** (priming, PID checks, electrical checks before cranking)
- **key-off** (visual inspections, filter inspection, relay seating)
- **cranking** (all dynamic pressure and command tests)

**Not relevant for this symptom:**
- idle: engine cannot reach idle; idle-scenario tests from Run 1 are reused only where the observation method is valid during crank (WIF status PID, lift pump status PID) or as reference after-fix validation
- medium-load / heavy-load / hot-soak: all post-start scenarios; irrelevant until engine fires
- none: not applicable to dynamic no-start diagnosis

---

### STEP 5 — REFUSAL PROTOCOL / GATE STATUS

**Post-path gate status:**

BELOW GATE until Step H (94%). Gate crossed at Step I (96%).

**Boundary conditions surfaced (not filled):**
1. Crank/cam sensor: NOT in model. If RPM PID reads zero during confirmed cranking, this subagent HALTS and returns: "RPM-zero-during-crank — cam/crank sensor circuit is suspect; component not in current structured model; escalate." This is an OBSERVABILITY HALT for that branch only; the rest of the path proceeds.
2. Injector solenoid resistance specs: NOT in model. Waveform capture is the model-grounded alternative. No resistance values will be stated.
3. Minimum cranking rail pressure spec: NOT in model. FRP PID test is still valid — a reading of zero is clearly wrong; a reading consistent with idle spec is clearly adequate; the gray zone (very low non-zero pressure) is flagged as GAP in expected_value.
4. Glow plug system: not in model. Not addressed. If cold-weather start difficulty is the actual context, this subagent would need a model extension before advising.
5. Return circuit termination point: GAP in model. Not relevant to no-start diagnosis.

**No CONTRADICTION HALT, IMPOSSIBILITY HALT triggered.**

DEF/ABS/cluster elimination was clean. No contradictions in topology.

---

## SECTION 2 — JSON SIDECAR

```json
{
  "symptom": {
    "slug": "no-start-cranks-normally-fuel-system-suspect",
    "description": "2018 Ford F-250 6.7L Power Stroke Diesel cranks at normal speed (battery and starter confirmed good) but will not fire. No DTCs confirmed; engine has not reached idle. Fuel system supply chain and PCM injection command are suspect.",
    "category": "no-start"
  },
  "test_actions": [
    {
      "slug": "sd4-67psd-test-dtc-scan-initial",
      "component_slug": "sd4-67psd-pcm",
      "description": "Connect scan tool to OBD-II port and read all stored and pending DTCs from the PCM before any other test. Confirms scan tool can communicate with PCM on HS-CAN and captures any codes set during prior crank attempts.",
      "scenario_required": "key-on",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "Scan tool establishes communication and returns a DTC list (empty list is a valid, expected result for a drivability complaint with no stored codes). Any fuel system DTC immediately narrows the diagnostic path. No communication means a CAN or PCM power supply fault and halts this diagnostic path.",
      "invasiveness": 1,
      "confidence_boost": 10,
      "source_citation": "Standard OBD-II initial step for any drivability complaint; HS-CAN access confirmed in structured model at OBD-II port pins 6 and 14",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-fuel-quality-smell",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Open the fuel filter/water separator drain port (or loosen the bowl slightly) and collect a small fuel sample into a clean white shop rag or cup. Smell the sample for gasoline odor or visible cloudiness (gel, water, algae). No tools required beyond a drain catch.",
      "scenario_required": "key-off",
      "observation_method": "smell",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "Diesel fuel with normal petroleum odor — no gasoline smell, no unusual cloudiness beyond normal diesel haze, no visible gel or wax. Gasoline odor is a FAIL and indicates misfueling. Cloudy/waxy sample indicates gelling or water contamination and routes to filter inspection and WIF confirmation.",
      "invasiveness": 2,
      "confidence_boost": 12,
      "source_citation": "Fuel quality smell test at filter bowl drain; filter housing has drain port per standard 6.7L PSD service procedure; smell observation method in structured model (sd4-67psd-fuel-filter-fuel-smell observable property)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-rpm-pid-cranking",
      "component_slug": "sd4-67psd-pcm",
      "description": "With scan tool live-data active on engine RPM PID, have a second tech crank the engine while observing the RPM reading on the scan tool display. Confirms PCM is receiving a valid crankshaft/camshaft position signal during engine cranking. Note: crank and cam sensors are not individually modeled in the current structured model — this test uses the PCM's broadcast RPM as the observable proxy.",
      "scenario_required": "cranking",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": "150",
      "expected_unit": "RPM",
      "expected_tolerance": "±75 RPM (100–300 RPM acceptable for cranking; exact spec not captured in model)",
      "expected_observation": "RPM PID should show approximately 100–250 RPM while the starter is clearly spinning the engine. A reading of zero RPM while the engine is confirmed cranking audibly/physically indicates the PCM is not receiving a valid position signal — cam or crank sensor circuit suspect. This is outside the current model boundary; surface as escalation. An RPM reading within expected range confirms the PCM has position data and is able to sequence injection.",
      "invasiveness": 1,
      "confidence_boost": 15,
      "source_citation": "Engine RPM broadcast by PCM on HS-CAN; observable via sd4-67psd-pcm-fuel-pids property; crank/cam sensor circuit is a known no-start path on 6.7L PSD but is not in current structured model (GAP acknowledged)",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-frp-pid-cranking",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "With scan tool live-data active on FRP (fuel rail pressure) PID, crank the engine for 5–10 seconds while observing the pressure reading. Captures whether the CP4.2 high-pressure pump is building rail pressure during cranking. This is a distinct test from sd4-67psd-test-frp-pid-idle because the engine cannot reach idle — this is the cranking-scenario equivalent.",
      "scenario_required": "cranking",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": "3000",
      "expected_unit": "PSI",
      "expected_tolerance": "minimum threshold not captured in structured model; field pattern suggests minimum ~1,500–2,500 PSI is needed to sustain combustion; exact minimum cranking rail pressure spec is NOT YET CAPTURED — treat any reading below ~1,500 PSI as a FAIL requiring further investigation",
      "expected_observation": "Rail pressure should climb from near-zero at initial crank to at least several thousand PSI within 2–3 crank revolutions if supply side is intact. A flat zero throughout cranking indicates no high-pressure pump output — route to lift pump output pressure and CP4 inlet pressure tests. A pressure that builds partially then plateaus very low suggests supply restriction (filter, lift pump) or CP4 wear. A pressure that builds to normal range but engine still does not start routes to injection command verification.",
      "invasiveness": 1,
      "confidence_boost": 20,
      "source_citation": "FRP sensor PID observable via HS-CAN (sd4-67psd-frp-rail-pressure-pid observable property); cranking-scenario pressure behavior distinct from idle; minimum cranking threshold is a field-pattern value not present in structured model",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-imv-duty-cycle-cranking",
      "component_slug": "sd4-67psd-imv",
      "description": "With scan tool live-data active on IMV commanded duty cycle PID, crank the engine for 5–10 seconds while observing the IMV duty cycle. Confirms the PCM is commanding the IMV to allow fuel into the CP4.2 high-pressure circuit during the crank event. This is a distinct test from sd4-67psd-test-imv-duty-cycle-pid (idle scenario) because the engine cannot reach idle.",
      "scenario_required": "cranking",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "percent duty cycle",
      "expected_tolerance": "exact cranking duty cycle spec not captured in structured model; expect PCM to command a non-zero, fuel-enabling duty cycle during crank; a reading of 100% closed (maximum duty cycle for a normally-open solenoid) during crank would be abnormal",
      "expected_observation": "PCM should be commanding the IMV to an intermediate or high-flow duty cycle position during cranking to maximize fuel delivery to the CP4. Exact expected percentage is NOT YET CAPTURED in the structured model. A PCM commanding maximum restriction (if that interpretation applies to 100% DC on a normally-open solenoid) during crank suggests a PCM control fault or a misread. Cross-reference with FRP PID: if FRP is climbing normally, IMV command is adequate regardless of specific duty cycle number.",
      "invasiveness": 1,
      "confidence_boost": 8,
      "source_citation": "IMV duty cycle PID via HS-CAN (sd4-67psd-imv-duty-cycle-pid observable property); cranking-scenario command behavior; normally-open solenoid behavior per structured model function field",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-injector-duty-cycle-cranking",
      "component_slug": "sd4-67psd-injector-1",
      "description": "With scan tool live-data active on injector commanded duty cycle or pulse width PID (for all available cylinders if scan tool supports, or at least one representative cylinder), crank the engine for 5–10 seconds while observing the injector command values. Confirms the PCM is sending injection commands during the crank event. Scan tool must support manufacturer-specific PIDs for injector duty cycle — generic OBD-II may not expose this.",
      "scenario_required": "cranking",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "percent duty cycle or milliseconds pulse width",
      "expected_tolerance": "exact cranking injection pulse width not captured in structured model; expect non-zero values indicating the PCM is commanding injection events",
      "expected_observation": "If the PCM is commanding injection during crank, the injector duty cycle or pulse width PIDs should show non-zero values corresponding to crank fueling demand. All-zero readings with RPM showing normal cranking speed and rail pressure building to adequate levels indicates the PCM is inhibiting injection — possible crank/cam signal quality issue (model GAP), PCM internal fault, or a safety inhibit condition. Manufacturer-specific scan tool (IDS, FJDS, or equivalent) recommended; generic scan tool may not expose injector PIDs.",
      "invasiveness": 1,
      "confidence_boost": 15,
      "source_citation": "Injector commanded duty cycle PID via HS-CAN (sd4-67psd-injector-duty-cycle-pid observable property); cranking scenario; PCM controls all 8 injectors via dedicated driver circuits per structured model",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-injector-pwm-cranking",
      "component_slug": "sd4-67psd-injector-1",
      "description": "Connect a lab scope to one representative injector harness connector (back-probe signal wire, do not unplug the injector) and capture the PWM waveform while cranking. Confirms actual driver pulses are being delivered to injector solenoids by PCM during crank — provides physical evidence that the injector duty cycle PID reflects reality. Use injector 1 or any accessible cylinder as representative.",
      "scenario_required": "cranking",
      "observation_method": "waveform_capture",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": "exact driver voltage, current, and pulse shape spec not captured in structured model — marked NOT YET CAPTURED; expect clearly visible PWM pulses at injector firing frequency; absence of any waveform is a FAIL",
      "expected_observation": "A healthy injector command circuit during cranking shows distinct high-voltage PWM pulses on the scope. Complete absence of waveform (flat line) while RPM shows normal cranking and rail pressure is building indicates PCM injector driver circuit fault or PCM injection inhibit. Waveform present but injector not mechanically responding is outside model boundary (injector mechanical failure, compression issue). Note: this is a high-invasiveness test relative to the scan-tool tests; perform only after scan-tool injector duty cycle PID confirms zero or ambiguous readings.",
      "invasiveness": 3,
      "confidence_boost": 18,
      "source_citation": "Injector PWM waveform capture at injector connector (sd4-67psd-injector-pwm-waveform observable property); cranking scenario; PCM driver circuit per structured model component_connections",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ],
  "branch_logic": [
    {
      "slug": "sd4-67psd-branch-dtc-no-comm",
      "test_action_slug": "sd4-67psd-test-dtc-scan-initial",
      "condition": "Scan tool cannot establish communication with PCM (no response on HS-CAN)",
      "verdict": "fail",
      "next_action": "Diagnose PCM power supply, ground, and HS-CAN circuit integrity before proceeding. This is outside the current fuel-system diagnostic path.",
      "routes_to_test_action_slug": null,
      "reasoning": "PCM must communicate to allow any PID-based testing. No communication is a prerequisite fail that blocks this entire diagnostic path. The structured model confirms PCM is the sole fuel system controller and all PID access routes through HS-CAN.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-dtc-fuel-system-code",
      "test_action_slug": "sd4-67psd-test-dtc-scan-initial",
      "condition": "DTC scan returns one or more fuel system DTCs (P0087, P0088, P0191, P0192, P0193, injector codes, etc.)",
      "verdict": "warn",
      "next_action": "Route to the appropriate DTC-specific diagnostic path. A P0087 no-start with stored DTC overlaps with Run 1 diagnostic path. The current no-start path continues in parallel but DTC provides additional signal weighting.",
      "routes_to_test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "reasoning": "DTCs narrow the candidate list significantly. A P0087 + no-start points strongly at supply side. P0192/P0193 points at FRP sensor circuit. P0193 (high voltage) + no-start could indicate FRP sensor stuck-high causing PCM to inhibit injection as overpressure protection. Regardless, continue through the physical supply-side path.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-dtc-clean",
      "test_action_slug": "sd4-67psd-test-dtc-scan-initial",
      "condition": "DTC scan returns no stored or pending codes",
      "verdict": "ok",
      "next_action": "Proceed to fuel level visual and WIF/lift pump PID checks.",
      "routes_to_test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "reasoning": "No DTCs on a no-start complaint is common — brief crank attempts may not have run long enough to set a code, or the fault is intermittent/upstream of the PCM's monitoring threshold. Continue diagnostic path.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-fuel-level-empty",
      "test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "condition": "Fuel gauge reads at or below E, or tank confirmed empty on visual check",
      "verdict": "fail",
      "next_action": "Add minimum 5 gallons of quality diesel fuel, allow lift pump to prime (key-on 30 seconds without cranking), attempt restart. If fuel was indeed empty, this is the root cause.",
      "routes_to_test_action_slug": null,
      "reasoning": "Empty tank is the highest-prior-probability no-start cause. If confirmed, stop here — adding fuel is the fix. No further diagnostic steps needed unless engine still does not start after refueling.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-fuel-level-adequate",
      "test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "condition": "Fuel gauge shows 1/4 tank or more (adequate fuel level)",
      "verdict": "ok",
      "next_action": "Proceed to WIF and lift pump status PID checks.",
      "routes_to_test_action_slug": "sd4-67psd-test-wif-status-pid",
      "reasoning": "Adequate fuel level eliminates the simplest no-start cause. Continue supply-side checks.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-wif-active",
      "test_action_slug": "sd4-67psd-test-wif-status-pid",
      "condition": "WIF PID shows water detected / WIF warning lamp is illuminated",
      "verdict": "fail",
      "next_action": "Drain water from filter bowl until clean diesel flows from drain port. Re-check WIF PID. If WIF clears, attempt restart. If WIF cannot be cleared with draining alone, replace filter element and re-check.",
      "routes_to_test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "reasoning": "WIF active on a no-start vehicle indicates water contamination has reached or is near the CP4 inlet. Water will prevent adequate rail pressure build. Address immediately before proceeding to pressure tests.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-wif-clear",
      "test_action_slug": "sd4-67psd-test-wif-status-pid",
      "condition": "WIF PID shows no water detected",
      "verdict": "ok",
      "next_action": "Proceed to lift pump status PID and fuel quality smell test.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "reasoning": "No water contamination. Continue to verify lift pump operation and fuel quality.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-not-commanded",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "condition": "Lift pump status PID shows not commanded / OFF at key-on when PCM should be running prime cycle",
      "verdict": "fail",
      "next_action": "Check relay seating visually. If relay seated, check relay coil voltage and lift pump supply voltage.",
      "routes_to_test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "reasoning": "If PCM is not commanding the lift pump, no fuel reaches the CP4. On key-on, the PCM should run a brief lift pump prime cycle. No command suggests a PCM fault, wiring fault, or relay circuit open.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-commanded",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "condition": "Lift pump status PID shows commanded ON / running during key-on prime cycle",
      "verdict": "ok",
      "next_action": "Proceed to fuel quality smell test and cranking-scenario scan tool tests.",
      "routes_to_test_action_slug": "sd4-67psd-test-fuel-quality-smell",
      "reasoning": "PCM is commanding lift pump. This rules out PCM command fault but does not confirm the pump is actually delivering pressure. Pressure test follows later in the path.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-fuel-misfueled",
      "test_action_slug": "sd4-67psd-test-fuel-quality-smell",
      "condition": "Sample smells of gasoline (lighter, more volatile odor than diesel) or is visibly clear/thin compared to normal diesel",
      "verdict": "fail",
      "next_action": "STOP — misfueling confirmed. Do not crank further. Drain and flush the entire fuel system. CP4 assessment required — gasoline-misfueling on a CP4.2-equipped diesel is a potentially catastrophic pump failure event.",
      "routes_to_test_action_slug": null,
      "reasoning": "Gasoline in the CP4.2 system is catastrophic. The CP4.2 is lubricated solely by diesel fuel. Even a small amount of gasoline degrades lubrication and accelerates internal wear. Further cranking will spread metal debris through injectors and rails. HALT is mandatory.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-fuel-gelled",
      "test_action_slug": "sd4-67psd-test-fuel-quality-smell",
      "condition": "Sample appears waxy, cloudy, or contains visible gel/wax crystals; diesel odor present but consistency abnormal",
      "verdict": "fail",
      "next_action": "Fuel is gelled (cold-weather wax formation). Warm the vehicle/fuel system, use diesel fuel conditioner/antigel additive, replace filter element, allow lift pump to re-prime, attempt restart.",
      "routes_to_test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "reasoning": "Gelled diesel cannot flow through the filter. Filter inspection will confirm blockage. Warming and anti-gel treatment is the remedy.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-fuel-quality-ok",
      "test_action_slug": "sd4-67psd-test-fuel-quality-smell",
      "condition": "Sample smells of normal diesel, appears normal color (amber to dark amber), no cloudiness or gasoline odor",
      "verdict": "ok",
      "next_action": "Proceed to cranking-scenario scan tool PID tests.",
      "routes_to_test_action_slug": "sd4-67psd-test-rpm-pid-cranking",
      "reasoning": "Fuel quality confirmed. Proceed to dynamic cranking tests.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-rpm-zero-during-crank",
      "test_action_slug": "sd4-67psd-test-rpm-pid-cranking",
      "condition": "RPM PID reads zero or shows no change while engine is clearly cranking audibly and physically",
      "verdict": "fail",
      "next_action": "OBSERVABILITY HALT — cam/crank sensor circuit is suspect. Crank and cam sensors are NOT in the current structured model (GAP). Escalate to crank/cam sensor circuit diagnosis using vehicle wiring diagram. The PCM will not command injection without a valid position signal.",
      "routes_to_test_action_slug": null,
      "reasoning": "Zero RPM during confirmed cranking means the PCM is not receiving position data. The PCM will not fire injectors without this signal. This branch exits the current model boundary. No further fuel system testing is warranted until position signal is confirmed.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-rpm-present-during-crank",
      "test_action_slug": "sd4-67psd-test-rpm-pid-cranking",
      "condition": "RPM PID shows 100–300 RPM consistent with normal cranking speed",
      "verdict": "ok",
      "next_action": "PCM is receiving position signal. Proceed to FRP PID during cranking.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-pid-cranking",
      "reasoning": "Normal crank RPM confirms PCM has position data and can sequence injection events. Now determine if rail pressure is building.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-zero-during-crank",
      "test_action_slug": "sd4-67psd-test-frp-pid-cranking",
      "condition": "FRP PID reads zero or near-zero (below ~500 PSI) throughout the cranking event",
      "verdict": "fail",
      "next_action": "Zero rail pressure during crank with normal RPM signal and confirmed fuel supply. Two sub-paths: (1) FRP sensor electrical fault — check 5V ref and signal at connector; (2) CP4 not building pressure — check lift pump output pressure and CP4 inlet pressure.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "reasoning": "Zero FRP during crank with confirmed RPM means either the sensor is not reading correctly (electrical fault) or the CP4 is genuinely not pressurizing. Sensor electrical check is faster and cheaper than pressure gauge installation, so it goes first.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-builds-but-no-start",
      "test_action_slug": "sd4-67psd-test-frp-pid-cranking",
      "condition": "FRP PID shows pressure climbing to >2,000 PSI (field minimum, NOT from model spec) during cranking but engine still does not fire",
      "verdict": "warn",
      "next_action": "Rail pressure is building. Supply side likely OK. Issue is injection command or injector mechanical. Check injector duty cycle PID during cranking.",
      "routes_to_test_action_slug": "sd4-67psd-test-injector-duty-cycle-cranking",
      "reasoning": "If fuel is reaching the rail at pressure and RPM is confirmed, the failure is downstream of the rail — either the PCM is not commanding injection or the injectors are not responding. Injector duty cycle PID will distinguish between PCM-not-commanding vs. commanded-but-not-firing.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-5v-absent",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "condition": "5V reference at FRP sensor connector is absent (reads <4.5V or 0V)",
      "verdict": "fail",
      "next_action": "FRP sensor power circuit open. Diagnose PCM 5V ref circuit for FRP sensor — check for open wire, corroded connector, or PCM 5V supply fault. FRP signal is invalid; PCM may be using fallback or inhibiting injection.",
      "routes_to_test_action_slug": null,
      "reasoning": "No 5V ref means the FRP sensor cannot output a valid signal. PCM will either use a fallback value or detect the fault. Either way, rail pressure PID reading is unreliable and injection behavior is unpredictable.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-5v-present",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "condition": "5V reference at FRP sensor connector is present and within spec (4.75–5.25V)",
      "verdict": "ok",
      "next_action": "FRP sensor power circuit good. Check FRP signal voltage at connector to confirm sensor output is valid.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "reasoning": "5V ref present confirms PCM is powering the sensor. Now check if the signal wire is delivering a rational voltage to confirm the sensor itself is functional.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-signal-abnormal",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "condition": "FRP signal voltage at key-on (engine not cranking, no pressure) reads at or near 0V or at or near 5V (stuck high or stuck low)",
      "verdict": "fail",
      "next_action": "FRP sensor is faulty (stuck signal). If reading 0V, signal wire shorted to ground. If reading 5V, signal wire shorted to ref or open. Replace FRP sensor, re-check rail pressure PID during crank, attempt restart.",
      "routes_to_test_action_slug": null,
      "reasoning": "At zero pressure (key-on, not cranking), FRP signal should read approximately 0.5–0.6V (near-atmospheric calibration offset). Readings at voltage rail extremes indicate a faulty sensor or wiring fault. A false-zero PID from a stuck-low sensor could cause PCM to inhibit injection.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-signal-ok",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "condition": "FRP signal voltage at key-on reads approximately 0.5–0.7V (near-atmospheric reference, consistent with zero rail pressure)",
      "verdict": "ok",
      "next_action": "FRP sensor electrical circuit confirmed good. Zero rail pressure during crank is a real physical condition, not a sensor artifact. Proceed to lift pump output pressure and CP4 inlet pressure.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "reasoning": "Sensor is electrically healthy but reporting zero pressure during crank — this is a real supply-side failure. The CP4 is not pressurizing. Work backward from CP4 inlet to determine whether lift pump, filter, or CP4 itself is the failure point.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-pressure-low",
      "test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "condition": "Lift pump output pressure measures below expected range (exact spec not in model; field pattern: below ~4 PSI is generally inadequate for CP4 supply)",
      "verdict": "fail",
      "next_action": "Lift pump not delivering adequate supply pressure. Route to lift pump supply voltage test and relay check.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "reasoning": "Low lift pump output is either an electrical fault (no voltage to pump) or a mechanical pump failure. Voltage test distinguishes between the two cheaply.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-pressure-ok",
      "test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "condition": "Lift pump output pressure is within expected range",
      "verdict": "ok",
      "next_action": "Lift pump is delivering. Proceed to CP4 inlet pressure to check filter restriction.",
      "routes_to_test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "reasoning": "Lift pump confirmed delivering. Now check what pressure is arriving at the CP4 inlet — differential between lift pump output and CP4 inlet indicates filter restriction.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-voltage-absent",
      "test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "condition": "No battery voltage at lift pump motor terminals during key-on when PCM is commanding pump",
      "verdict": "fail",
      "next_action": "No power to lift pump despite PCM command. Check relay seating visual and relay contacts.",
      "routes_to_test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "reasoning": "PCM is commanding lift pump but voltage is not reaching the motor. The relay contacts are the most likely open point between PCM command and pump motor.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-relay-not-seated",
      "test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "condition": "Lift pump relay is not fully seated in its cavity, is absent, or shows visible damage",
      "verdict": "fail",
      "next_action": "Reseat or replace relay. Confirm lift pump operation audibly and recheck lift pump status PID.",
      "routes_to_test_action_slug": null,
      "reasoning": "Improperly seated relay will fail to close its contacts. Reseating is a free fix. If relay is physically damaged, replace it.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-cp4-inlet-pressure-low",
      "test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "condition": "CP4 inlet pressure is significantly lower than lift pump output pressure, indicating excessive filter restriction",
      "verdict": "fail",
      "next_action": "Filter restriction confirmed. Proceed to filter element inspection and replacement.",
      "routes_to_test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "reasoning": "Large pressure drop across the filter indicates restriction (clogged element, gelled diesel, contamination). Replace filter element, recheck CP4 inlet pressure, attempt restart.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-cp4-inlet-pressure-ok",
      "test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "condition": "CP4 inlet pressure is comparable to lift pump output pressure (minimal filter differential), adequate supply confirmed",
      "verdict": "fail",
      "next_action": "Adequate supply to CP4 but zero rail pressure during crank — CP4 mechanical failure suspected. Check for CP4 audible noise, metal debris in fuel, and consider CP4 replacement. Also check hp-rail external leak visual to rule out rail leak as pressure sink.",
      "routes_to_test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "reasoning": "If lift pump delivers adequate pressure to the CP4 inlet but the rail pressure still reads zero during crank, the CP4 itself is not building pressure. This indicates internal CP4 failure — worn plungers, failed check valves, or mechanical drive failure. Rail external leak check is performed first to rule out a catastrophic leak path downstream of the CP4.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-injector-dc-zero-during-crank",
      "test_action_slug": "sd4-67psd-test-injector-duty-cycle-cranking",
      "condition": "Injector duty cycle PID reads zero during cranking despite normal RPM signal and adequate rail pressure",
      "verdict": "fail",
      "next_action": "PCM is not commanding injectors during crank. Two possible causes: (1) PCM injection inhibit due to a safety condition not yet identified (recheck for any newly-set DTCs); (2) PCM internal driver fault. Proceed to injector PWM waveform capture to confirm whether driver pulses are physically present at injector connector.",
      "routes_to_test_action_slug": "sd4-67psd-test-injector-pwm-cranking",
      "reasoning": "Rail pressure building + RPM signal present + injector DC zero = PCM is choosing not to command injection. This could be a PCM-internal decision (safety inhibit, theft deterrent, PCM fault) rather than a physical fuel supply problem. Waveform capture confirms whether PID is accurately representing physical driver output.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-injector-dc-present-during-crank",
      "test_action_slug": "sd4-67psd-test-injector-duty-cycle-cranking",
      "condition": "Injector duty cycle PID shows non-zero values during cranking (PCM is commanding injection events)",
      "verdict": "warn",
      "next_action": "PCM is commanding injection. Rail pressure is confirmed building. Engine still not starting. Proceed to injector PWM waveform to confirm physical driver pulses at injector connector, then assess injector mechanical condition or compression (both outside current model boundary).",
      "routes_to_test_action_slug": "sd4-67psd-test-injector-pwm-cranking",
      "reasoning": "All command inputs are present. Engine still not starting suggests injector mechanical failure, compression issue, or timing issue — areas outside the current structured model. Waveform capture bridges from PCM command to physical injector terminal to confirm the driver chain is intact.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-injector-pwm-absent",
      "test_action_slug": "sd4-67psd-test-injector-pwm-cranking",
      "condition": "No PWM waveform detected at injector connector during cranking (flat line on scope) despite injector duty cycle PID showing non-zero values",
      "verdict": "fail",
      "next_action": "PCM PID shows command but no physical pulse at injector connector. Wiring fault between PCM injector driver output and injector connector, or PCM injector driver failure. Check injector harness continuity and PCM connector integrity.",
      "routes_to_test_action_slug": null,
      "reasoning": "Contradiction between PID (showing command) and waveform (showing no pulse) indicates either a wiring open between PCM driver output and the injector connector, or a PCM driver circuit fault that outputs digitally to the CAN bus but fails physically at the driver stage.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-injector-pwm-present",
      "test_action_slug": "sd4-67psd-test-injector-pwm-cranking",
      "condition": "PWM waveform is present at injector connector during cranking (clear driver pulses visible on scope)",
      "verdict": "warn",
      "next_action": "PCM is commanding and physically driving the injectors. Rail pressure is building. Engine is still not firing. This is now outside the current structured model boundary — suspect injector mechanical failure, injector hydraulic issue, or compression/timing issue. No further fuel system structured testing is warranted without model extension. Surface as escalation.",
      "routes_to_test_action_slug": null,
      "reasoning": "All model-grounded fuel system tests have passed. The engine is receiving fuel at pressure, the PCM is commanding injection, and physical driver pulses are confirmed at the injectors. Failure to fire is now a combustion-chamber or injector-mechanical issue — neither is in the current structured model. GATE STATUS: 96% on fuel system path — fuel system is exonerated. Root cause lies outside model boundary.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-bleeddown-active",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "condition": "FRP PID shows pressure rapidly dropping or unable to sustain above idle target, consistent with PRV opening",
      "verdict": "warn",
      "next_action": "PRV may be stuck open, preventing adequate rail pressure build. Check PRV external leak visual. If no external leak visible, PRV internal condition test required (invasiveness 4 — requires rail access).",
      "routes_to_test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "reasoning": "A stuck-open PRV bleeds rail pressure back to the return circuit. In a no-start scenario, if rail pressure builds briefly then immediately collapses, PRV is a candidate. However, the PRV test (idle scenario in Run 1) cannot be directly applied here since engine has not reached idle — this branch applies if the technician observes rapid pressure collapse on the cranking FRP trace.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ],
  "symptom_test_implications": [
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-dtc-scan-initial",
      "priority": 1,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "priority": 2,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-wif-status-pid",
      "priority": 3,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "priority": 4,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-fuel-quality-smell",
      "priority": 5,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-rpm-pid-cranking",
      "priority": 6,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-frp-pid-cranking",
      "priority": 7,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-cranking",
      "priority": 8,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-injector-duty-cycle-cranking",
      "priority": 9,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "priority": 10,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "priority": 6,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "priority": 7,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "priority": 7,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "priority": 8,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "priority": 9,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "priority": 8,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "priority": 9,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "priority": 10,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "no-start-cranks-normally-fuel-system-suspect",
      "test_action_slug": "sd4-67psd-test-injector-pwm-cranking",
      "priority": 10,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    }
  ]
}
```
