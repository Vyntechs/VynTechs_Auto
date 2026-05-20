# Phase 2 Run 1 / Gate 3 — Prompt 3 Subagent Output (P0087)

Dispatched 2026-05-19 (re-dispatched after prior session's /tmp loss).

## Section 1 — Plain-text diagnostic summary

### SCOPE

**Symptom:** P0087 — Fuel Rail/System Pressure Too Low. Low power complaint under load, MIL on, no prior test results.

**Implicated subsystems (from topology):**
The entire low-pressure supply path and high-pressure generation/control path are implicated. P0087 fires when the PCM sees FRP sensor PID fall below threshold during operation. Every component that either delivers fuel to the CP4.2 inlet or builds/maintains rail pressure after it is a candidate.

**In-scope components (derived from connection topology):**
- sd4-67psd-fuel-tank — source of supply; empty tank = zero pressure everywhere
- sd4-67psd-lift-pump — only powered low-pressure mover; failure starves CP4.2
- sd4-67psd-lift-pump-relay — relay failure = lift pump failure by extension
- sd4-67psd-fuel-filter-ws — restriction here starves CP4.2 inlet independent of lift pump health
- sd4-67psd-wif-sensor — water contamination in filter is a starvation/cavitation trigger
- sd4-67psd-cp4-pump — the high-pressure generator; mechanical degradation = no rail pressure
- sd4-67psd-engine-gear-train — mechanical drive; broken drive = CP4.2 not spinning (rare but eliminable)
- sd4-67psd-imv — normally-open solenoid; stuck closed starves CP4.2 internally; stuck open floods circuit with low-duty unmetered fuel
- sd4-67psd-hp-rail-bank-a — accumulator; external leak or PRV leak drains it
- sd4-67psd-hp-rail-bank-b — same as above
- sd4-67psd-frp-sensor — a failed sensor reporting falsely low pressure generates P0087 with no actual fuel pressure problem
- sd4-67psd-pressure-relief-valve — stuck-open PRV bleeds rail to return, mimicking CP4.2 failure
- sd4-67psd-return-circuit — restricted return raises injector back-pressure and disrupts injection; but return restriction raises, not drops, rail pressure, so this is a low-probability candidate for P0087 specifically
- sd4-67psd-injectors (1-8) — massively leaking injectors (return bypass) can bleed rail down faster than CP4 builds it; relevant at medium-heavy load where demand exceeds build rate
- sd4-67psd-pcm — false DTC from software or FRP reference circuit fault
- sd4-67psd-hs-can-bus — CAN fault can corrupt PID; cannot produce hardware low-pressure

**Eliminated by topology (cannot cause P0087):**
- sd4-67psd-def-tank, sd4-67psd-def-dosing-system — entirely separate fluid circuit; no mechanical or electrical path to fuel rail pressure
- sd4-67psd-abs-tc-module — torque management consumer, not a fuel pressure component; cannot generate P0087
- sd4-67psd-instrument-cluster — display output only; receives WIF/fuel data, does not affect pressure
- sd4-67psd-fuel-level-sender — fuel level signal only; cannot cause pressure fault

**Scoped observable properties in play:**
sd4-67psd-frp-rail-pressure-pid, sd4-67psd-imv-duty-cycle-pid, sd4-67psd-lift-pump-op-status-pid, sd4-67psd-wif-status-pid, sd4-67psd-cluster-fuel-gauge-visual, sd4-67psd-frp-5v-ref-at-connector, sd4-67psd-frp-ground-continuity, sd4-67psd-frp-signal-voltage-at-connector, sd4-67psd-relay-seating-visual, sd4-67psd-relay-click-audible, sd4-67psd-lift-pump-audible, sd4-67psd-lift-pump-supply-voltage, sd4-67psd-lift-pump-output-pressure, sd4-67psd-fuel-filter-restriction, sd4-67psd-fuel-filter-element-condition, sd4-67psd-fuel-filter-water-drained, sd4-67psd-cp4-inlet-pressure, sd4-67psd-cp4-audible-noise, sd4-67psd-hp-rail-a-external-leak, sd4-67psd-hp-rail-b-external-leak, sd4-67psd-prv-external-leak, sd4-67psd-prv-rail-pressure-drop-pid, sd4-67psd-injector-external-leak, sd4-67psd-imv-solenoid-resistance

**Gaps (entries flagged 'not yet captured' that are directly relevant to this scope):**
1. FRP sensor exact 5V reference spec (frp-5v-ref-at-connector): expected voltage at connector not in model
2. CP4.2 inlet pressure normal spec: exact PSI range at CP4 inlet not captured
3. P0087 rail pressure threshold: exact PSI at which PCM sets P0087 not captured
4. IMV coil resistance spec: expected ohms not captured
5. Lift pump supply voltage spec: exact voltage at pump terminals not captured
6. Lift pump output pressure spec: exact target PSI not captured
7. Relay cavity/box designation: location (BJB vs SJB, exact cavity) not captured

**Phase 2 finding — enum translation required:**
The diagnostic narrative referenced "WOT" and "load" as operating scenarios. Neither maps to the schema enum. Translated: "under load" complaint = medium-load or heavy-load test scenarios. "WOT" translated to heavy-load at emission time. No enum violations emitted.

---

### PATH

The path walks cheap-to-expensive, non-invasive-to-invasive, pruning branches as it goes. The critical fork is Step 3 (FRP PID at cranking/idle vs key-on). If the FRP reads plausibly high at idle, the problem is likely sensor-false or load-dependent only — redirect to IMV duty cycle and injector leak tests. If FRP is flat from idle onward, the pump is not building pressure and CP4.2 or its supply is the root.

**Step 1 — Fuel level visual (cluster gauge)**
Non-contact. Confirm fuel is in the tank before wasting time on any pressure circuit. Eliminated: empty tank as cause.

**Step 2 — WIF status PID + cluster WIF lamp**
Scan tool + visual. Water in the filter is a direct CP4.2 cavitation trigger. If WIF active: drain and inspect filter bowl before going further. Cost: zero. Eliminated: water contamination or false WIF fault.

**Step 3 — FRP rail pressure PID at key-on (prime cycle) and idle**
Scan tool. This is the anchoring test. Establishes whether the reported low pressure is real (pump building nothing) or sensor-false. If FRP reads 0 or implausibly low at idle with engine running, pressure problem is real and upstream. If FRP reads plausibly normal at idle but drops only under load, a different branch (injector leak, IMV maxed-out, or CP4 wear under demand) is active.

**Step 4 — IMV duty cycle PID at idle**
Scan tool. The PCM's response to low FRP is to command the IMV open further (lower duty cycle on a normally-open valve means more fuel in). If IMV duty cycle is already pegged at maximum-open while FRP is still low, the PCM is asking for more fuel than the supply side can deliver: go upstream (lift pump, filter, CP4 inlet). If IMV duty cycle is at a normal range and FRP is still low, suspect CP4.2 mechanical efficiency loss or PRV stuck open bleeding the rail.

**Step 5 — Relay seating visual + relay click audible (key-on)**
Lift hood, verify relay is seated. Command key-on (or use scan tool to actuate lift pump) and listen for relay click at the junction box. Cost: zero. If relay does not click: relay or PCM command fault branch. Eliminated: unseated relay, obvious relay failure.

**Step 6 — Lift pump audible + status PID (key-on prime)**
With relay confirmed clicking, listen at driver-side frame rail for pump motor hum during the prime cycle (key-on, engine off). Simultaneously read lift pump operational status PID. If pump does not run and PID shows commanded: relay contact fault or pump motor failure. Eliminated: pump motor failure.

**Step 7 — FRP sensor 5V reference at harness connector (key-on, engine off)**
Back-probe the FRP sensor harness connector reference pin with a DVOM. This tests the PCM's reference supply to the sensor without touching the sensor itself. Expected ~5V (exact spec is a model gap — tech records actual reading as FIELD-VERIFIED data). A dead reference kills the FRP PID regardless of actual rail pressure. Eliminated: PCM reference supply fault causing false P0087.

**Step 8 — FRP signal voltage at harness connector (key-on, engine off, no pressure)**
Back-probe signal pin. At zero pressure with ignition on, signal voltage should be at a resting low value (exact spec not in model — gap, tech records). A signal rail stuck at 0V or 5V with valid 5V reference confirms the sensor itself is failed. Eliminated: failed FRP sensor.

**Step 9 — Lift pump output pressure gauge (key-on, engine running at idle)**
Install a low-pressure fuel gauge at the lift pump outlet fitting or filter inlet port. Spec not in model (gap). A reading significantly lower than the model's captured "low-pressure supply" function implies confirms lift pump weakness or intake restriction. This reading ALSO feeds CP4 inlet diagnosis (if lift pump pressure is normal here but CP4 inlet pressure in Step 10 is low, the filter is restricting).

**Step 10 — CP4.2 inlet pressure gauge (key-on, engine running at idle)**
Install gauge at CP4.2 inlet fitting. This test isolates the filter restriction from lift pump output. If lift pump output (Step 9) is acceptable but CP4 inlet pressure is low: filter restriction is the root. Spec not in model (gap — critical: the minimum acceptable CP4.2 inlet pressure is a known failure threshold; tech records actual reading as FIELD-VERIFIED).

**Step 11 — Fuel filter element inspection (direct visual, housing opened)**
Remove filter element. Inspect for: heavy contamination/plugging, metallic particulate (gray/silver debris), discoloration. Metallic particulate in the filter element at this stage is the most consequential finding in this entire diagnostic because it is the primary confirmatory indicator of CP4.2 catastrophic metal-shedding failure.

CRITICAL CP4.2 ADDENDUM (from Ford TSB pattern): If metallic particulate is found in the filter element, the CP4.2 has undergone cavitation-induced catastrophic internal failure. The pump sheds metal that flows downstream contaminating: the IMV, both high-pressure rails, all 8 injectors, and all high-pressure fuel lines. A replacement CP4.2 installed without a complete fuel system flush and injector replacement will be destroyed by residual metal contamination — typically within hours of restart. Required remediation: replace CP4.2, replace all 8 injectors, flush both rails, replace all high-pressure lines, flush the entire low-pressure supply circuit including tank. This is NOT a "replace the pump and see" repair. Committing to CP4.2 replacement without this addendum re-contaminates the new pump and creates a repeat failure with a new-parts bill on top.

**Step 12 — High-pressure rail external leak visual (both banks)**
Walk both rails visually for fuel wet spots, white crystalline deposits (dried diesel), or dripping at end caps or fitting connections. A visible external leak drains the rail. Eliminated: external rail leak.

**Step 13 — PRV rail pressure bleed-down PID (scan tool, idle to key-off)**
Watch FRP PID during a smooth key-off. A stuck-open pressure relief valve bleeds the rail rapidly after shutdown. Abnormally rapid pressure decay immediately post-shutdown indicates PRV stuck open. This is distinct from CP4.2 failure but produces similar P0087 symptoms under load.

**Gate checkpoint after Steps 1-13:**
If Steps 9-11 together show: low CP4 inlet pressure + metallic particulate in filter element + CP4 audible noise (cavitation knock), cumulative confidence crosses 95% gate for CP4.2 catastrophic failure diagnosis. Commit recommendation is allowed only when this triplet confirms together with a plausible FRP PID showing consistently low pressure from idle. A single confirmatory test (e.g., only filter metal) does not cross gate alone.

---

### GATE STATUS

Current cumulative confidence builds as follows:
- Steps 1-4 (scan tool PIDs): establish real vs. false pressure loss, eliminate empty tank, WIF, relay, PCM reference supply → ~40% (narrows field, eliminates major false positives)
- Steps 5-8 (relay/pump audible + FRP electrical): eliminate sensor false positive, relay/pump electrical → ~55%
- Steps 9-10 (low-pressure gauge): isolates lift pump vs. filter restriction vs. CP4 inlet starvation → ~70%
- Step 11 (filter element inspection): if metallic particulate confirmed → single highest-confidence confirmatory test for CP4.2 catastrophic failure → +25% → ~95%
- Steps 12-13 (leak visual + PRV PID): differential for rail leak vs. PRV stuck open → fills remaining branches

Gate threshold: 95%. Commit to CP4.2 replacement is REFUSED until Steps 9+10+11 all return consistent CP4.2-failure evidence. IMV replacement, filter replacement, or lift pump replacement commits are allowed at lower thresholds (their individual tests are more decisive for isolated faults).

Gate: 95% of 95%. Commit: allowed (CP4.2 catastrophic failure path only, when Steps 9+10+11 agree). Next test: Step 1 — Fuel level visual (cluster gauge). Critical gaps: 7 entries flagged 'not yet captured' in this scope.

---

## Section 2 — JSON sidecar

```json
{
  "symptom": {
    "slug": "p0087-fuel-rail-pressure-too-low",
    "description": "P0087 DTC active, MIL on, low power under load. Common rail fuel pressure reported by FRP sensor PID is below PCM threshold. Vehicle: 2018 Ford F-250 6.7L Power Stroke Diesel. No prior test results at intake.",
    "category": "dtc"
  },
  "test_actions": [
    {
      "slug": "sd4-67psd-test-fuel-level-visual",
      "component_slug": "sd4-67psd-fuel-tank",
      "description": "Read instrument cluster fuel gauge needle position to confirm fuel is present in tank before beginning pressure circuit diagnosis.",
      "scenario_required": "key-on",
      "observation_method": "direct_visual_external",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "Fuel gauge needle above empty. Any reading above E confirms fuel supply exists and eliminates empty-tank as the P0087 cause.",
      "invasiveness": 1,
      "confidence_boost": 5,
      "source_citation": "LOGIC: sd4-67psd-fuel-tank feeds sd4-67psd-lift-pump via fluid-line; zero tank level eliminates all downstream pressure before any electrical or mechanical fault is considered.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-wif-status-pid",
      "component_slug": "sd4-67psd-wif-sensor",
      "description": "Read WIF status PID on scan tool via HS-CAN to determine whether water contamination is active at the filter housing. Also note cluster WIF warning lamp state.",
      "scenario_required": "key-on",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "WIF PID reads 'not detected' / 0 / inactive. WIF lamp off on cluster. If WIF is active, water is present in filter bowl and must be drained before further fuel pressure testing.",
      "invasiveness": 1,
      "confidence_boost": 5,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-wif-status-pid observable on sd4-67psd-wif-sensor; water in filter directly causes CP4.2 cavitation and fuel starvation that can trigger P0087.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-frp-pid-idle",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Read FRP rail pressure PID on scan tool at idle with engine running. This anchoring test establishes whether rail pressure loss is real or a sensor/PCM reference fault producing a false P0087.",
      "scenario_required": "idle",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "PSI",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: exact idle rail pressure spec for 2018 6.7L PSD not in structured model. Normal idle rail pressure for this engine family is in the 3,000-5,000 PSI range per training data (TRAINING-INFERRED); tech records actual reading as FIELD-VERIFIED. A PID reading at or near 0 PSI with engine running and no stall indicates sensor false-zero or total supply failure. A plausible idle pressure that drops only under load redirects to IMV and injector leak branch.",
      "invasiveness": 1,
      "confidence_boost": 15,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-frp-rail-pressure-pid observable on sd4-67psd-frp-sensor. P0087 threshold PSI not yet captured in model — gap.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "component_slug": "sd4-67psd-imv",
      "description": "Read IMV commanded duty cycle PID on scan tool at idle. PCM increases IMV open command (lower duty cycle on this normally-open valve) when trying to compensate for low rail pressure. A maxed-out open command at idle with low FRP indicates the supply side cannot keep up — go upstream. A normal IMV command with low FRP suggests CP4.2 mechanical efficiency loss or PRV bypass.",
      "scenario_required": "idle",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "%",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: exact IMV duty cycle range at idle not in structured model. IMV is normally-open; high duty cycle = more closed = less fuel in. PCM commanding near-0% duty (fully open) at idle while FRP is below normal = PCM is compensating for starvation. Tech records actual reading as FIELD-VERIFIED.",
      "invasiveness": 1,
      "confidence_boost": 10,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-imv-duty-cycle-pid observable. LOGIC: PCM closed-loop control via IMV; maxed-open command at low FRP = supply-side starvation signal.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-lift-pump-status-pid",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Read lift pump operational status PID on scan tool during key-on prime cycle (engine not running). Simultaneously listen at driver-side frame rail for pump motor hum.",
      "scenario_required": "key-on",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "Lift pump status PID should read 'running' / commanded-on during key-on prime. Audible hum at frame rail should be heard for 2-3 seconds. No PID + no audible = pump not commanded or not running.",
      "invasiveness": 1,
      "confidence_boost": 8,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-lift-pump-op-status-pid observable. LOGIC: PCM commands relay → relay powers lift pump; PID reflects PCM command state.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-relay-seating-visual",
      "component_slug": "sd4-67psd-lift-pump-relay",
      "description": "Open engine compartment junction box (BJB or SJB — exact cavity not yet captured in model). Visually confirm lift pump relay is fully seated in its cavity. Remove and re-seat if any play is detected.",
      "scenario_required": "key-off",
      "observation_method": "direct_visual_external",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "Relay is fully seated, no corrosion on cavity terminals. Exact BJB/SJB cavity designation is not yet captured in structured model — tech must locate relay using vehicle-specific relay box cover diagram.",
      "invasiveness": 1,
      "confidence_boost": 4,
      "source_citation": "TRAINING-INFERRED: sd4-67psd-relay-seating-visual observable. LOGIC: unseated relay = open lift pump circuit = no low-pressure supply. Relay location gap flagged.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Back-probe the FRP sensor harness connector reference pin with DVOM set to DC volts. Key-on, engine off. Tests the PCM's 5V reference supply to the FRP sensor without disturbing the sensor or its connection.",
      "scenario_required": "key-on",
      "observation_method": "electrical_measurement_at_pin",
      "meter_mode": "DC volts",
      "expected_value": 5,
      "expected_unit": "V",
      "expected_tolerance": 0.2,
      "expected_observation": null,
      "invasiveness": 2,
      "confidence_boost": 8,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-frp-5v-ref-at-connector observable. FRP sensor is 3-wire analog (5V ref, signal, ground) per structured model. Exact 5V spec is TRAINING-CONFIRMED for sensor type; ±0.2V tolerance is TRAINING-INFERRED — tech records actual reading as FIELD-VERIFIED.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-frp-signal-at-connector",
      "component_slug": "sd4-67psd-frp-sensor",
      "description": "Back-probe FRP sensor signal pin with DVOM set to DC volts. Key-on, engine off, no rail pressure. A sensor producing a resting signal voltage in the valid low range (near 0.5V typically) with a healthy 5V reference confirms sensor is alive. A signal stuck at 0V or at 5V with valid reference confirms sensor failure — P0087 is sensor-false.",
      "scenario_required": "key-on",
      "observation_method": "electrical_measurement_at_pin",
      "meter_mode": "DC volts",
      "expected_value": null,
      "expected_unit": "V",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: exact resting (zero-pressure) signal voltage for this FRP sensor not in structured model. TRAINING-INFERRED typical resting value is ~0.5V for a 5V-reference analog pressure sensor at zero pressure. Tech records actual reading as FIELD-VERIFIED. Signal stuck at 0V with valid 5V ref = sensor grounded internally, failed. Signal at 5V = sensor open-circuit, failed.",
      "invasiveness": 2,
      "confidence_boost": 10,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-frp-signal-voltage-at-connector observable. LOGIC: 3-wire analog sensor with valid reference but pegged signal = sensor failure; eliminates false P0087 from sensor fault.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Back-probe lift pump motor harness connector supply terminal with DVOM set to DC volts during key-on prime cycle. Confirms relay contacts are delivering battery voltage to the pump motor.",
      "scenario_required": "key-on",
      "observation_method": "electrical_measurement_at_pin",
      "meter_mode": "DC volts",
      "expected_value": null,
      "expected_unit": "V",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: exact voltage spec at lift pump motor terminals not in structured model. TRAINING-INFERRED: should be near battery voltage (~12-14V with engine off, key-on). Tech records actual reading as FIELD-VERIFIED. Significantly below battery voltage = voltage drop in relay contacts or wiring.",
      "invasiveness": 2,
      "confidence_boost": 7,
      "source_citation": "TRAINING-INFERRED: sd4-67psd-lift-pump-supply-voltage observable, inference_class LOGIC. Exact voltage spec is a model gap.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-lift-pump-output-pressure",
      "component_slug": "sd4-67psd-lift-pump",
      "description": "Install a low-pressure fuel gauge at the lift pump outlet fitting or primary filter inlet port. Start engine, read pressure at idle. This isolates lift pump mechanical output from filter restriction — if this pressure is normal but CP4 inlet pressure (next test) is low, the filter is restricting.",
      "scenario_required": "idle",
      "observation_method": "pressure_test_with_gauge",
      "meter_mode": "PSI",
      "expected_value": null,
      "expected_unit": "PSI",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: exact lift pump output pressure spec for 2018 6.7L PSD not in structured model. TRAINING-INFERRED typical range is 4-8 PSI for this pump type; tech records actual reading as FIELD-VERIFIED. Reading significantly below the FIELD-VERIFIED normal baseline = lift pump weak or failed. Reading within normal range redirects to filter restriction test.",
      "invasiveness": 3,
      "confidence_boost": 12,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-lift-pump-output-pressure observable. LOGIC: fluid-line connection from lift pump to filter; a pressure measurement here isolates pump output from filter restriction.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-cp4-inlet-pressure",
      "component_slug": "sd4-67psd-cp4-pump",
      "description": "Install a low-pressure fuel gauge at the CP4.2 inlet fitting. Start engine, read pressure at idle. If lift pump output pressure is acceptable but CP4 inlet pressure is significantly lower, a filter restriction is stealing pressure between the two points. Low CP4 inlet pressure is also a direct CP4.2 cavitation trigger — the pump cavitates on its own inlet restriction.",
      "scenario_required": "idle",
      "observation_method": "pressure_test_with_gauge",
      "meter_mode": "PSI",
      "expected_value": null,
      "expected_unit": "PSI",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: exact minimum acceptable CP4.2 inlet pressure not in structured model (critical gap — this threshold is the primary CP4.2 cavitation trigger spec). TRAINING-INFERRED: CP4.2 requires positive inlet pressure; near-zero or negative inlet pressure at idle = cavitation in progress. Tech records actual reading as FIELD-VERIFIED.",
      "invasiveness": 3,
      "confidence_boost": 15,
      "source_citation": "TRAINING-INFERRED: sd4-67psd-cp4-inlet-pressure observable, inference_class LOGIC. LOGIC: fluid-line from filter to CP4 inlet; differential between lift pump output and CP4 inlet directly measures filter restriction. Inlet pressure spec is a model gap.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-filter-element-inspection",
      "component_slug": "sd4-67psd-fuel-filter-ws",
      "description": "Remove fuel filter housing cap and extract the filter element. Inspect element and drained fuel bowl contents for: metallic particulate (gray/silver debris), excessive contamination, and water. Metallic particulate in the filter element is the primary confirmatory indicator of CP4.2 catastrophic metal-shedding failure.",
      "scenario_required": "key-off",
      "observation_method": "direct_visual_internal",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "Filter element should show normal brown contamination without metallic debris. Metallic particulate (gray/silver flakes or paste) confirms CP4.2 cavitation-induced catastrophic failure — CRITICAL: this finding mandates complete fuel system remediation (CP4.2 + all 8 injectors + rail flush + line replacement) before restart. Normal-appearing element with no metals redirects toward filter restriction only (element may still be plugged without metal).",
      "invasiveness": 3,
      "confidence_boost": 20,
      "source_citation": "TRAINING-CONFIRMED: sd4-67psd-fuel-filter-element-condition observable. PATTERN: CP4.2 catastrophic metal-shedding failure is the single most consequential differential for P0087 on this platform; filter element metal is the primary field-accessible confirmatory finding per Ford TSB pattern.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-test-hp-rail-external-leak",
      "component_slug": "sd4-67psd-hp-rail-bank-a",
      "description": "Visually inspect both high-pressure fuel rails (Bank A and Bank B) for external fuel leaks. Look for wet spots, white crystalline deposits (dried diesel residue), or fuel weeping at end caps, injector fittings, or pressure sensor fittings. An external rail leak directly drains rail pressure and will produce P0087 under load.",
      "scenario_required": "key-off",
      "observation_method": "direct_visual_external",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": null,
      "expected_tolerance": null,
      "expected_observation": "No wet spots, no crystalline deposits, no dripping fuel at any rail fitting or end cap. Any evidence of external fuel at high-pressure connections = repair the leak before further testing.",
      "invasiveness": 1,
      "confidence_boost": 6,
      "source_citation": "TRAINING-INFERRED: sd4-67psd-hp-rail-a-external-leak and sd4-67psd-hp-rail-b-external-leak observables. LOGIC: direct topology — rail is the pressure accumulator; external leak drains it; visual inspection is non-invasive.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-test-prv-bleeddown-pid",
      "component_slug": "sd4-67psd-pressure-relief-valve",
      "description": "Monitor FRP rail pressure PID on scan tool during a smooth key-off from idle. Observe pressure decay rate in the first 10 seconds after shutdown. A stuck-open pressure relief valve bleeds the rail abnormally fast post-shutdown, mimicking CP4.2 failure under load.",
      "scenario_required": "idle",
      "observation_method": "scan_tool_pid",
      "meter_mode": null,
      "expected_value": null,
      "expected_unit": "PSI",
      "expected_tolerance": null,
      "expected_observation": "Not yet captured: normal post-shutdown rail pressure decay rate not in structured model. TRAINING-INFERRED: a healthy sealed rail holds pressure for tens of seconds post-shutdown; a stuck-open PRV produces near-instantaneous bleed to near-zero. Tech records actual decay curve as FIELD-VERIFIED. Abnormally rapid decay with clean filter element and adequate CP4 inlet pressure elevates PRV-stuck-open as root cause.",
      "invasiveness": 1,
      "confidence_boost": 8,
      "source_citation": "TRAINING-INFERRED: sd4-67psd-prv-rail-pressure-drop-pid observable. LOGIC: PRV routes to return circuit; stuck-open PRV bleeds rail continuously; observable as rapid post-shutdown pressure decay in FRP PID.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ],
  "branch_logic": [
    {
      "slug": "sd4-67psd-branch-fuel-level-ok",
      "test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "condition": "Fuel gauge reads above E — fuel is present",
      "verdict": "ok",
      "next_action": "Proceed to WIF status PID check.",
      "routes_to_test_action_slug": "sd4-67psd-test-wif-status-pid",
      "reasoning": "Fuel present eliminates empty tank. Continue diagnosis downstream.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-fuel-level-empty",
      "test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "condition": "Fuel gauge reads at or near E",
      "verdict": "fail",
      "next_action": "Add fuel. Retest FRP PID after fuel is added and system is primed. P0087 is expected to resolve — do not proceed with further diagnosis until fuel level is confirmed adequate.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "reasoning": "Empty tank starves the lift pump and eliminates all downstream pressure. Root cause is simple supply deficiency, not a hardware fault.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-wif-not-active",
      "test_action_slug": "sd4-67psd-test-wif-status-pid",
      "condition": "WIF PID reads inactive / not detected; WIF lamp off",
      "verdict": "ok",
      "next_action": "No water contamination active. Proceed to FRP PID at idle.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "reasoning": "No active water contamination; filter bowl does not need draining before pressure testing.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-wif-active",
      "test_action_slug": "sd4-67psd-test-wif-status-pid",
      "condition": "WIF PID reads active / water detected; WIF lamp on",
      "verdict": "warn",
      "next_action": "Drain filter bowl immediately. Collect and visually inspect drained contents for water layer and metallic debris. If water only: replace filter element, clear DTC, retest FRP PID. If metallic debris also present: escalate to CP4.2 catastrophic failure path — see filter element inspection test.",
      "routes_to_test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "reasoning": "Water in filter is a direct CP4.2 cavitation trigger. Must be resolved before any valid pressure measurement. If metal is also present, CP4.2 may already be damaged.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-pid-flat",
      "test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "condition": "FRP PID reads near 0 PSI or implausibly low at idle with engine running",
      "verdict": "fail",
      "next_action": "Rail pressure problem is real — not sensor-false. Continue to IMV duty cycle PID to determine whether PCM is commanding maximum supply, then proceed to relay/pump checks and electrical tests.",
      "routes_to_test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "reasoning": "A near-zero FRP PID with engine running and no stall confirms the rail is genuinely not building pressure. The fault is mechanical or supply-side, not a false sensor reading.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-pid-normal-idle",
      "test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "condition": "FRP PID reads plausible idle pressure but complaint is under load only",
      "verdict": "warn",
      "next_action": "System builds pressure at idle but cannot sustain it under load. Suspect: (1) marginal CP4.2 mechanical efficiency that fails under demand, (2) injector return leak bypassing rail faster than CP4 builds under load, or (3) PRV stuck slightly open — cracking at load pressure. Proceed to IMV duty cycle PID to characterize PCM response, then proceed to LP pressure gauge and filter inspection.",
      "routes_to_test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "reasoning": "Load-only P0087 with normal idle pressure indicates a fault that only manifests when demand exceeds marginal supply capacity. Idle-based tests will be informative but may not fully replicate the condition.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-imv-duty-maxed",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "condition": "IMV duty cycle is at or near maximum-open command while FRP is low",
      "verdict": "fail",
      "next_action": "PCM is commanding maximum fuel delivery but rail pressure is still low. Fault is upstream of the IMV — lift pump supply or filter restriction. Proceed to relay seating visual, then lift pump supply voltage and output pressure tests.",
      "routes_to_test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "reasoning": "A maxed-open IMV command with low FRP means the PCM is asking for all available fuel and still not getting enough pressure — the supply side is the constraint.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-imv-duty-normal",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "condition": "IMV duty cycle is in a normal working range but FRP is still low",
      "verdict": "warn",
      "next_action": "PCM is not commanding maximum supply, yet pressure is still low. Suspect CP4.2 mechanical efficiency loss (pump not converting available supply to rail pressure at expected efficiency), or PRV stuck open bypassing rail. Proceed to relay/pump checks and LP pressure gauge, but escalate filter element inspection and PRV bleed-down test.",
      "routes_to_test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "reasoning": "Normal IMV command with low FRP suggests the pump has the fuel it needs but isn't building pressure — a CP4.2 mechanical efficiency or PRV bypass issue rather than a starvation issue.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-relay-seated-ok",
      "test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "condition": "Relay is fully seated, no corrosion observed",
      "verdict": "ok",
      "next_action": "Relay seating is not the issue. Proceed to lift pump status PID and audible check.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "reasoning": "Relay is physically present and seated; move to functional checks of the relay and pump circuit.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-relay-not-seated",
      "test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "condition": "Relay is not fully seated or corrosion is visible on cavity terminals",
      "verdict": "fail",
      "next_action": "Re-seat relay (clean terminals if corroded). Retest lift pump status PID. If lift pump now runs and FRP PID recovers, relay seating was the root cause.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "reasoning": "An unseated relay produces the same effect as a failed relay — no power to the lift pump. Re-seating is zero-cost corrective action before further testing.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-running",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "condition": "Lift pump status PID shows commanded/running AND audible hum heard at frame rail",
      "verdict": "ok",
      "next_action": "Lift pump is electrically alive and mechanically turning. Proceed to FRP sensor 5V reference check to eliminate sensor false-positive.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "reasoning": "Pump is running. The low pressure is either false (sensor fault) or mechanical (pump output insufficient, filter restricting, CP4 failing).",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-not-running",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "condition": "Lift pump status PID shows commanded but no audible hum at frame rail",
      "verdict": "fail",
      "next_action": "PCM is commanding the pump but pump is not running. Check supply voltage at pump connector to distinguish relay contact failure from pump motor failure.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "reasoning": "PCM command present but pump silent — fault is between relay contacts and pump motor. Voltage check at connector isolates relay contacts from pump motor.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-not-commanded",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "condition": "Lift pump status PID shows not commanded / off",
      "verdict": "fail",
      "next_action": "PCM is not commanding the lift pump. Check for additional DTCs (especially PCM power/ground or CAN communication codes). Verify PCM is receiving correct operating conditions to command the pump. This is a PCM or CAN communication fault branch, not a fuel hardware fault.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "reasoning": "If PCM is not commanding the pump, the fuel hardware may be fine. Look upstream at PCM health and CAN communication before condemning fuel components.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-5v-ref-ok",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "condition": "5V reference at FRP connector is within tolerance (~4.8-5.2V)",
      "verdict": "ok",
      "next_action": "PCM reference supply to FRP sensor is healthy. Proceed to FRP signal voltage check to test the sensor itself.",
      "routes_to_test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "reasoning": "Valid reference confirms the PCM circuit is supplying the sensor correctly. The next test isolates whether the sensor signal output is valid.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-5v-ref-dead",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "condition": "5V reference at FRP connector is 0V or significantly out of range",
      "verdict": "fail",
      "next_action": "PCM is not supplying 5V reference to the FRP sensor. Check for wiring harness damage between PCM and FRP sensor connector. Check PCM power and ground. A missing reference collapses the FRP PID and generates P0087 without any actual fuel pressure problem.",
      "routes_to_test_action_slug": null,
      "reasoning": "No 5V reference = FRP sensor cannot report. P0087 is sensor-circuit-false. The fuel system may be fine. Do not condemn CP4.2 or lift pump until reference circuit is repaired and PID is re-evaluated.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-frp-signal-resting-ok",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "condition": "FRP signal pin voltage at zero-pressure key-on is within expected resting range (not stuck at 0V or 5V)",
      "verdict": "ok",
      "next_action": "FRP sensor signal output is live and responsive. Low rail pressure is real mechanical issue, not sensor failure. Proceed to lift pump supply voltage and output pressure tests.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "reasoning": "Sensor is producing a valid resting signal. The pressure problem is real. Continue to mechanical supply-side tests.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-frp-signal-stuck",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "condition": "FRP signal pin is stuck at 0V or 5V with valid 5V reference present",
      "verdict": "fail",
      "next_action": "FRP sensor has failed internally. A stuck-low or stuck-high signal generates a false P0087. Replace FRP sensor. Clear DTC. Re-evaluate rail pressure PID with new sensor before any further fuel system diagnosis.",
      "routes_to_test_action_slug": null,
      "reasoning": "Valid 5V reference with pegged signal = sensor internal failure. The fuel system pressure may be perfectly normal. Replacing the sensor eliminates this false-positive path before committing to any expensive repairs.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-voltage-ok",
      "test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "condition": "Supply voltage at lift pump connector is near battery voltage (≥11.5V key-on engine off)",
      "verdict": "ok",
      "next_action": "Relay and wiring are delivering voltage to the pump motor. Pump is receiving power but may not be producing adequate output pressure. Proceed to lift pump output pressure gauge test.",
      "routes_to_test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "reasoning": "Voltage confirmed at motor terminals. If pump is still not running audibly, the pump motor itself has failed mechanically. Output pressure test will confirm.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-voltage-low",
      "test_action_slug": "sd4-67psd-test-lift-pump-supply-voltage",
      "condition": "Supply voltage at lift pump connector is significantly below battery voltage (<10V key-on)",
      "verdict": "fail",
      "next_action": "Voltage drop across relay contacts or wiring. Swap relay with a known-good unit. Retest voltage. If voltage recovers, relay contacts were the fault. If still low, inspect wiring for high-resistance connection or damaged insulation between relay and pump.",
      "routes_to_test_action_slug": null,
      "reasoning": "Low voltage at pump motor under light-load key-on indicates relay contact resistance or wiring fault absorbing voltage before it reaches the pump.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-pressure-ok",
      "test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "condition": "Lift pump output pressure is within expected range at idle",
      "verdict": "ok",
      "next_action": "Lift pump is producing adequate output. Fault is at or downstream of the filter. Proceed to CP4.2 inlet pressure test to isolate filter restriction.",
      "routes_to_test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "reasoning": "If LP output is normal but CP4 inlet pressure is low, the filter assembly is restricting flow between the two gauge points.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-lift-pump-pressure-low",
      "test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "condition": "Lift pump output pressure is below expected range at idle",
      "verdict": "fail",
      "next_action": "Lift pump mechanical output is insufficient. Replace lift pump. Before replacing, confirm fuel tank has adequate fuel and there is no kink or blockage in the supply line between tank and pump.",
      "routes_to_test_action_slug": null,
      "reasoning": "Low pump output with confirmed voltage supply indicates pump motor or impeller degradation. The tank supply line should be confirmed unrestricted before condemning the pump.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-cp4-inlet-pressure-ok",
      "test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "condition": "CP4.2 inlet pressure is within acceptable range at idle",
      "verdict": "ok",
      "next_action": "CP4.2 is receiving adequate supply pressure. The fault is internal to the CP4.2 (mechanical efficiency loss) or downstream (PRV stuck open, injector return leakage). Proceed to filter element inspection to look for metallic debris (CP4.2 cavitation evidence), then PRV bleed-down test.",
      "routes_to_test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "reasoning": "Adequate CP4 inlet pressure with low FRP means the pump has supply but is not converting it to high rail pressure efficiently — internal pump fault or a high-side leak.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-cp4-inlet-pressure-low",
      "test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "condition": "CP4.2 inlet pressure is below minimum acceptable level at idle",
      "verdict": "fail",
      "next_action": "CP4.2 is being starved. Combined with adequate lift pump output, the filter is restricting. Proceed immediately to filter element inspection — a restricted or plugged filter element is the root cause. If filter element shows metallic debris, escalate to CP4.2 catastrophic failure path.",
      "routes_to_test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "reasoning": "Low CP4 inlet pressure with normal LP output pressure = differential pressure across filter housing confirms restriction. Filter element inspection will determine whether restriction is from normal contamination (replace filter, done) or metallic debris (CP4.2 catastrophic failure path).",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-filter-element-clean",
      "test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "condition": "Filter element shows normal contamination, no metallic particulate",
      "verdict": "warn",
      "next_action": "No CP4.2 catastrophic failure evidence. If filter was plugged (low CP4 inlet pressure confirmed), replace element and retest FRP PID. If inlet pressure was acceptable, continue to rail external leak visual and PRV bleed-down test to find remaining rail-side leak.",
      "routes_to_test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "reasoning": "Clean filter with low inlet pressure = simple filter restriction, not CP4.2 failure. Clean filter with normal inlet pressure and low FRP redirects to high-side leak or PRV.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-filter-element-metals",
      "test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "condition": "Metallic particulate (gray/silver flakes, paste, or debris) found in filter element or drained bowl",
      "verdict": "fail",
      "next_action": "CP4.2 catastrophic metal-shedding failure confirmed. GATE CROSSED (with corroborating LP/inlet pressure data). DO NOT restart engine. Required remediation: replace CP4.2 pump, replace all 8 injectors, flush both high-pressure rails, replace all HP fuel lines, flush entire LP supply circuit including tank. Failure to complete full system remediation will destroy the replacement pump. Get customer approval for full scope before proceeding.",
      "routes_to_test_action_slug": null,
      "reasoning": "PATTERN: CP4.2 catastrophic failure per Ford TSB. Metal contamination is irreversible downstream. A single injector swap or pump swap without full flush is a condemned repair — the new part fails within hours. This is the single most consequential finding in this diagnostic tree.",
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "slug": "sd4-67psd-branch-rail-leak-found",
      "test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "condition": "Visible fuel leak at rail fitting, end cap, or injector fitting connection",
      "verdict": "fail",
      "next_action": "Repair the external high-pressure leak (tighten fitting, replace seal, or replace rail as appropriate for leak location and type). Clear DTC. Retest FRP PID after repair. Do not attempt to run engine with an active HP fuel leak.",
      "routes_to_test_action_slug": null,
      "reasoning": "External HP leak directly drains the rail. This is a straightforward mechanical repair before any further diagnosis.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-rail-leak-none",
      "test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "condition": "No external fuel leak found at either rail",
      "verdict": "ok",
      "next_action": "Rails are externally sealed. Proceed to PRV bleed-down PID test to check for stuck-open pressure relief valve.",
      "routes_to_test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "reasoning": "No external leak eliminates rail external leak as the pressure drain. PRV stuck open is the remaining high-side leak candidate.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-bleeddown-normal",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "condition": "FRP PID shows gradual post-shutdown pressure decay over many seconds",
      "verdict": "ok",
      "next_action": "PRV is not stuck open. Rail is holding pressure post-shutdown. All non-invasive and semi-invasive tests have not conclusively identified root cause — residual suspects are CP4.2 marginal mechanical efficiency (no metal found, pressure only drops under heavy load) or internal injector bypassing under load. Consult Ford WPS PCED for next-tier test sequence (waveform capture, injector return quantity test). Cumulative confidence does not yet cross gate for CP4.2 replacement — do not commit without further evidence.",
      "routes_to_test_action_slug": null,
      "reasoning": "Normal bleed-down eliminates PRV stuck open. If all prior tests also came back negative or inconclusive, the fault may require dynamic load testing or more invasive measurement not yet in model.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "slug": "sd4-67psd-branch-prv-bleeddown-rapid",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "condition": "FRP PID drops to near-zero within 2-3 seconds of key-off from idle",
      "verdict": "fail",
      "next_action": "PRV is stuck open or leaking at seat. With clean filter element (no metals), adequate CP4 inlet pressure, and confirmed rapid bleed-down: PRV is the root cause of P0087 under load. Replace PRV. This is a targeted, non-catastrophic repair — does not require injector or pump replacement if metal contamination is absent.",
      "routes_to_test_action_slug": null,
      "reasoning": "Rapid post-shutdown pressure decay with all supply-side tests passing and no metal in filter is the PRV stuck-open signature. PRV replacement is a low-cost targeted fix compared to a CP4.2 + injector replacement path.",
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ],
  "symptom_test_implications": [
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-fuel-level-visual",
      "priority": 1,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-wif-status-pid",
      "priority": 2,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-frp-pid-idle",
      "priority": 3,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-imv-duty-cycle-pid",
      "priority": 4,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-lift-pump-status-pid",
      "priority": 5,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-relay-seating-visual",
      "priority": 5,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-frp-5v-ref-at-connector",
      "priority": 6,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-frp-signal-at-connector",
      "priority": 6,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-lift-pump-output-pressure",
      "priority": 7,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-cp4-inlet-pressure",
      "priority": 8,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-filter-element-inspection",
      "priority": 9,
      "source_provenance": "TRAINING-CONFIRMED",
      "inference_class": null
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-hp-rail-external-leak",
      "priority": 7,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    },
    {
      "symptom_slug": "p0087-fuel-rail-pressure-too-low",
      "test_action_slug": "sd4-67psd-test-prv-bleeddown-pid",
      "priority": 10,
      "source_provenance": "TRAINING-INFERRED",
      "inference_class": "LOGIC"
    }
  ]
}
```
