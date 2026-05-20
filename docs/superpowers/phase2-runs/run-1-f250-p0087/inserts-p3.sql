-- Run 1 / Prompt 3 inserts -- 2018 F-250 6.7L PSD + P0087 fuel-rail-pressure-too-low:
-- symptoms, test_actions, branch_logic, symptom_test_implications.
--
-- Generated 2026-05-19 from validated P3 subagent JSON (subagent-output-p3.md).
-- FK resolution by slug -- same SQL runs on local vyntechs_rehearsal AND on live Supabase.
--
-- Pending Brandon's approval for live execution.

BEGIN;

-- =========================================================================
-- 1. SYMPTOMS (1 row; globally-unique slug, plain ON CONFLICT (slug))
-- =========================================================================
INSERT INTO symptoms (slug, description, category)
VALUES (
  'p0087-fuel-rail-pressure-too-low',
  'P0087 DTC active, MIL on, low power under load. Common rail fuel pressure reported by FRP sensor PID is below PCM threshold. Vehicle: 2018 Ford F-250 6.7L Power Stroke Diesel. No prior test results at intake.',
  'dtc'
)
ON CONFLICT (slug) DO UPDATE SET
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  updated_at = NOW();


-- =========================================================================
-- 2. TEST_ACTIONS (14 rows; FK to components via slug; partial unique on slug WHERE is_retired = false)
-- =========================================================================
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  meter_mode, expected_value, expected_unit, expected_tolerance, expected_observation,
  invasiveness, confidence_boost, source_citation, source_provenance, inference_class
)
SELECT
  v.slug, c.id, v.description, v.scenario_required, v.observation_method,
  v.meter_mode, v.expected_value::real, v.expected_unit, v.expected_tolerance::real, v.expected_observation,
  v.invasiveness, v.confidence_boost::real, v.source_citation, v.source_provenance, v.inference_class
FROM (VALUES
  ('sd4-67psd-test-fuel-level-visual', 'sd4-67psd-fuel-tank',
   'Read instrument cluster fuel gauge needle position to confirm fuel is present in tank before beginning pressure circuit diagnosis.',
   'key-on', 'direct_visual_external',
   NULL, NULL, NULL, NULL,
   'Fuel gauge needle above empty. Any reading above E confirms fuel supply exists and eliminates empty-tank as the P0087 cause.',
   1, 5,
   'LOGIC: sd4-67psd-fuel-tank feeds sd4-67psd-lift-pump via fluid-line; zero tank level eliminates all downstream pressure before any electrical or mechanical fault is considered.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-wif-status-pid', 'sd4-67psd-wif-sensor',
   'Read WIF status PID on scan tool via HS-CAN to determine whether water contamination is active at the filter housing. Also note cluster WIF warning lamp state.',
   'key-on', 'scan_tool_pid',
   NULL, NULL, NULL, NULL,
   'WIF PID reads ''not detected'' / 0 / inactive. WIF lamp off on cluster. If WIF is active, water is present in filter bowl and must be drained before further fuel pressure testing.',
   1, 5,
   'TRAINING-CONFIRMED: sd4-67psd-wif-status-pid observable on sd4-67psd-wif-sensor; water in filter directly causes CP4.2 cavitation and fuel starvation that can trigger P0087.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-frp-pid-idle', 'sd4-67psd-frp-sensor',
   'Read FRP rail pressure PID on scan tool at idle with engine running. This anchoring test establishes whether rail pressure loss is real or a sensor/PCM reference fault producing a false P0087.',
   'idle', 'scan_tool_pid',
   NULL, NULL, 'PSI', NULL,
   'Not yet captured: exact idle rail pressure spec for 2018 6.7L PSD not in structured model. Normal idle rail pressure for this engine family is in the 3,000-5,000 PSI range per training data (TRAINING-INFERRED); tech records actual reading as FIELD-VERIFIED. A PID reading at or near 0 PSI with engine running and no stall indicates sensor false-zero or total supply failure. A plausible idle pressure that drops only under load redirects to IMV and injector leak branch.',
   1, 15,
   'TRAINING-CONFIRMED: sd4-67psd-frp-rail-pressure-pid observable on sd4-67psd-frp-sensor. P0087 threshold PSI not yet captured in model -- gap.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-imv-duty-cycle-pid', 'sd4-67psd-imv',
   'Read IMV commanded duty cycle PID on scan tool at idle. PCM increases IMV open command (lower duty cycle on this normally-open valve) when trying to compensate for low rail pressure. A maxed-out open command at idle with low FRP indicates the supply side cannot keep up -- go upstream. A normal IMV command with low FRP suggests CP4.2 mechanical efficiency loss or PRV bypass.',
   'idle', 'scan_tool_pid',
   NULL, NULL, '%', NULL,
   'Not yet captured: exact IMV duty cycle range at idle not in structured model. IMV is normally-open; high duty cycle = more closed = less fuel in. PCM commanding near-0% duty (fully open) at idle while FRP is below normal = PCM is compensating for starvation. Tech records actual reading as FIELD-VERIFIED.',
   1, 10,
   'TRAINING-CONFIRMED: sd4-67psd-imv-duty-cycle-pid observable. LOGIC: PCM closed-loop control via IMV; maxed-open command at low FRP = supply-side starvation signal.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-lift-pump-status-pid', 'sd4-67psd-lift-pump',
   'Read lift pump operational status PID on scan tool during key-on prime cycle (engine not running). Simultaneously listen at driver-side frame rail for pump motor hum.',
   'key-on', 'scan_tool_pid',
   NULL, NULL, NULL, NULL,
   'Lift pump status PID should read ''running'' / commanded-on during key-on prime. Audible hum at frame rail should be heard for 2-3 seconds. No PID + no audible = pump not commanded or not running.',
   1, 8,
   'TRAINING-CONFIRMED: sd4-67psd-lift-pump-op-status-pid observable. LOGIC: PCM commands relay -> relay powers lift pump; PID reflects PCM command state.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-relay-seating-visual', 'sd4-67psd-lift-pump-relay',
   'Open engine compartment junction box (BJB or SJB -- exact cavity not yet captured in model). Visually confirm lift pump relay is fully seated in its cavity. Remove and re-seat if any play is detected.',
   'key-off', 'direct_visual_external',
   NULL, NULL, NULL, NULL,
   'Relay is fully seated, no corrosion on cavity terminals. Exact BJB/SJB cavity designation is not yet captured in structured model -- tech must locate relay using vehicle-specific relay box cover diagram.',
   1, 4,
   'TRAINING-INFERRED: sd4-67psd-relay-seating-visual observable. LOGIC: unseated relay = open lift pump circuit = no low-pressure supply. Relay location gap flagged.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-frp-5v-ref-at-connector', 'sd4-67psd-frp-sensor',
   'Back-probe the FRP sensor harness connector reference pin with DVOM set to DC volts. Key-on, engine off. Tests the PCM''s 5V reference supply to the FRP sensor without disturbing the sensor or its connection.',
   'key-on', 'electrical_measurement_at_pin',
   'DC volts', 5, 'V', 0.2,
   NULL,
   2, 8,
   'TRAINING-CONFIRMED: sd4-67psd-frp-5v-ref-at-connector observable. FRP sensor is 3-wire analog (5V ref, signal, ground) per structured model. Exact 5V spec is TRAINING-CONFIRMED for sensor type; ±0.2V tolerance is TRAINING-INFERRED -- tech records actual reading as FIELD-VERIFIED.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-frp-signal-at-connector', 'sd4-67psd-frp-sensor',
   'Back-probe FRP sensor signal pin with DVOM set to DC volts. Key-on, engine off, no rail pressure. A sensor producing a resting signal voltage in the valid low range (near 0.5V typically) with a healthy 5V reference confirms sensor is alive. A signal stuck at 0V or at 5V with valid reference confirms sensor failure -- P0087 is sensor-false.',
   'key-on', 'electrical_measurement_at_pin',
   'DC volts', NULL, 'V', NULL,
   'Not yet captured: exact resting (zero-pressure) signal voltage for this FRP sensor not in structured model. TRAINING-INFERRED typical resting value is ~0.5V for a 5V-reference analog pressure sensor at zero pressure. Tech records actual reading as FIELD-VERIFIED. Signal stuck at 0V with valid 5V ref = sensor grounded internally, failed. Signal at 5V = sensor open-circuit, failed.',
   2, 10,
   'TRAINING-CONFIRMED: sd4-67psd-frp-signal-voltage-at-connector observable. LOGIC: 3-wire analog sensor with valid reference but pegged signal = sensor failure; eliminates false P0087 from sensor fault.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-lift-pump-supply-voltage', 'sd4-67psd-lift-pump',
   'Back-probe lift pump motor harness connector supply terminal with DVOM set to DC volts during key-on prime cycle. Confirms relay contacts are delivering battery voltage to the pump motor.',
   'key-on', 'electrical_measurement_at_pin',
   'DC volts', NULL, 'V', NULL,
   'Not yet captured: exact voltage spec at lift pump motor terminals not in structured model. TRAINING-INFERRED: should be near battery voltage (~12-14V with engine off, key-on). Tech records actual reading as FIELD-VERIFIED. Significantly below battery voltage = voltage drop in relay contacts or wiring.',
   2, 7,
   'TRAINING-INFERRED: sd4-67psd-lift-pump-supply-voltage observable, inference_class LOGIC. Exact voltage spec is a model gap.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-lift-pump-output-pressure', 'sd4-67psd-lift-pump',
   'Install a low-pressure fuel gauge at the lift pump outlet fitting or primary filter inlet port. Start engine, read pressure at idle. This isolates lift pump mechanical output from filter restriction -- if this pressure is normal but CP4 inlet pressure (next test) is low, the filter is restricting.',
   'idle', 'pressure_test_with_gauge',
   'PSI', NULL, 'PSI', NULL,
   'Not yet captured: exact lift pump output pressure spec for 2018 6.7L PSD not in structured model. TRAINING-INFERRED typical range is 4-8 PSI for this pump type; tech records actual reading as FIELD-VERIFIED. Reading significantly below the FIELD-VERIFIED normal baseline = lift pump weak or failed. Reading within normal range redirects to filter restriction test.',
   3, 12,
   'TRAINING-CONFIRMED: sd4-67psd-lift-pump-output-pressure observable. LOGIC: fluid-line connection from lift pump to filter; a pressure measurement here isolates pump output from filter restriction.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-cp4-inlet-pressure', 'sd4-67psd-cp4-pump',
   'Install a low-pressure fuel gauge at the CP4.2 inlet fitting. Start engine, read pressure at idle. If lift pump output pressure is acceptable but CP4 inlet pressure is significantly lower, a filter restriction is stealing pressure between the two points. Low CP4 inlet pressure is also a direct CP4.2 cavitation trigger -- the pump cavitates on its own inlet restriction.',
   'idle', 'pressure_test_with_gauge',
   'PSI', NULL, 'PSI', NULL,
   'Not yet captured: exact minimum acceptable CP4.2 inlet pressure not in structured model (critical gap -- this threshold is the primary CP4.2 cavitation trigger spec). TRAINING-INFERRED: CP4.2 requires positive inlet pressure; near-zero or negative inlet pressure at idle = cavitation in progress. Tech records actual reading as FIELD-VERIFIED.',
   3, 15,
   'TRAINING-INFERRED: sd4-67psd-cp4-inlet-pressure observable, inference_class LOGIC. LOGIC: fluid-line from filter to CP4 inlet; differential between lift pump output and CP4 inlet directly measures filter restriction. Inlet pressure spec is a model gap.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-filter-element-inspection', 'sd4-67psd-fuel-filter-ws',
   'Remove fuel filter housing cap and extract the filter element. Inspect element and drained fuel bowl contents for: metallic particulate (gray/silver debris), excessive contamination, and water. Metallic particulate in the filter element is the primary confirmatory indicator of CP4.2 catastrophic metal-shedding failure.',
   'key-off', 'direct_visual_internal',
   NULL, NULL, NULL, NULL,
   'Filter element should show normal brown contamination without metallic debris. Metallic particulate (gray/silver flakes or paste) confirms CP4.2 cavitation-induced catastrophic failure -- CRITICAL: this finding mandates complete fuel system remediation (CP4.2 + all 8 injectors + rail flush + line replacement) before restart. Normal-appearing element with no metals redirects toward filter restriction only (element may still be plugged without metal).',
   3, 20,
   'TRAINING-CONFIRMED: sd4-67psd-fuel-filter-element-condition observable. PATTERN: CP4.2 catastrophic metal-shedding failure is the single most consequential differential for P0087 on this platform; filter element metal is the primary field-accessible confirmatory finding per Ford TSB pattern.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-hp-rail-external-leak', 'sd4-67psd-hp-rail-bank-a',
   'Visually inspect both high-pressure fuel rails (Bank A and Bank B) for external fuel leaks. Look for wet spots, white crystalline deposits (dried diesel residue), or fuel weeping at end caps, injector fittings, or pressure sensor fittings. An external rail leak directly drains rail pressure and will produce P0087 under load.',
   'key-off', 'direct_visual_external',
   NULL, NULL, NULL, NULL,
   'No wet spots, no crystalline deposits, no dripping fuel at any rail fitting or end cap. Any evidence of external fuel at high-pressure connections = repair the leak before further testing.',
   1, 6,
   'TRAINING-INFERRED: sd4-67psd-hp-rail-a-external-leak and sd4-67psd-hp-rail-b-external-leak observables. LOGIC: direct topology -- rail is the pressure accumulator; external leak drains it; visual inspection is non-invasive.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-prv-bleeddown-pid', 'sd4-67psd-pressure-relief-valve',
   'Monitor FRP rail pressure PID on scan tool during a smooth key-off from idle. Observe pressure decay rate in the first 10 seconds after shutdown. A stuck-open pressure relief valve bleeds the rail abnormally fast post-shutdown, mimicking CP4.2 failure under load.',
   'idle', 'scan_tool_pid',
   NULL, NULL, 'PSI', NULL,
   'Not yet captured: normal post-shutdown rail pressure decay rate not in structured model. TRAINING-INFERRED: a healthy sealed rail holds pressure for tens of seconds post-shutdown; a stuck-open PRV produces near-instantaneous bleed to near-zero. Tech records actual decay curve as FIELD-VERIFIED. Abnormally rapid decay with clean filter element and adequate CP4 inlet pressure elevates PRV-stuck-open as root cause.',
   1, 8,
   'TRAINING-INFERRED: sd4-67psd-prv-rail-pressure-drop-pid observable. LOGIC: PRV routes to return circuit; stuck-open PRV bleeds rail continuously; observable as rapid post-shutdown pressure decay in FRP PID.',
   'TRAINING-INFERRED', 'LOGIC')
) AS v(
  slug, component_slug, description, scenario_required, observation_method,
  meter_mode, expected_value, expected_unit, expected_tolerance, expected_observation,
  invasiveness, confidence_boost, source_citation, source_provenance, inference_class
)
JOIN components c ON c.slug = v.component_slug AND c.is_retired = false
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  component_id = EXCLUDED.component_id,
  description = EXCLUDED.description,
  scenario_required = EXCLUDED.scenario_required,
  observation_method = EXCLUDED.observation_method,
  meter_mode = EXCLUDED.meter_mode,
  expected_value = EXCLUDED.expected_value,
  expected_unit = EXCLUDED.expected_unit,
  expected_tolerance = EXCLUDED.expected_tolerance,
  expected_observation = EXCLUDED.expected_observation,
  invasiveness = EXCLUDED.invasiveness,
  confidence_boost = EXCLUDED.confidence_boost,
  source_citation = EXCLUDED.source_citation,
  source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class,
  updated_at = NOW();


-- =========================================================================
-- 3. BRANCH_LOGIC (29 rows; FK to test_actions by slug, LEFT JOIN for nullable routes_to)
-- =========================================================================
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning, source_provenance, inference_class
)
SELECT
  v.slug, ta.id, v.condition, v.verdict, v.next_action,
  rta.id, v.reasoning, v.source_provenance, v.inference_class
FROM (VALUES
  ('sd4-67psd-branch-fuel-level-ok', 'sd4-67psd-test-fuel-level-visual',
   'Fuel gauge reads above E -- fuel is present', 'ok',
   'Proceed to WIF status PID check.',
   'sd4-67psd-test-wif-status-pid',
   'Fuel present eliminates empty tank. Continue diagnosis downstream.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-fuel-level-empty', 'sd4-67psd-test-fuel-level-visual',
   'Fuel gauge reads at or near E', 'fail',
   'Add fuel. Retest FRP PID after fuel is added and system is primed. P0087 is expected to resolve -- do not proceed with further diagnosis until fuel level is confirmed adequate.',
   'sd4-67psd-test-frp-pid-idle',
   'Empty tank starves the lift pump and eliminates all downstream pressure. Root cause is simple supply deficiency, not a hardware fault.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-wif-not-active', 'sd4-67psd-test-wif-status-pid',
   'WIF PID reads inactive / not detected; WIF lamp off', 'ok',
   'No water contamination active. Proceed to FRP PID at idle.',
   'sd4-67psd-test-frp-pid-idle',
   'No active water contamination; filter bowl does not need draining before pressure testing.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-wif-active', 'sd4-67psd-test-wif-status-pid',
   'WIF PID reads active / water detected; WIF lamp on', 'warn',
   'Drain filter bowl immediately. Collect and visually inspect drained contents for water layer and metallic debris. If water only: replace filter element, clear DTC, retest FRP PID. If metallic debris also present: escalate to CP4.2 catastrophic failure path -- see filter element inspection test.',
   'sd4-67psd-test-filter-element-inspection',
   'Water in filter is a direct CP4.2 cavitation trigger. Must be resolved before any valid pressure measurement. If metal is also present, CP4.2 may already be damaged.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-pid-flat', 'sd4-67psd-test-frp-pid-idle',
   'FRP PID reads near 0 PSI or implausibly low at idle with engine running', 'fail',
   'Rail pressure problem is real -- not sensor-false. Continue to IMV duty cycle PID to determine whether PCM is commanding maximum supply, then proceed to relay/pump checks and electrical tests.',
   'sd4-67psd-test-imv-duty-cycle-pid',
   'A near-zero FRP PID with engine running and no stall confirms the rail is genuinely not building pressure. The fault is mechanical or supply-side, not a false sensor reading.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-pid-normal-idle', 'sd4-67psd-test-frp-pid-idle',
   'FRP PID reads plausible idle pressure but complaint is under load only', 'warn',
   'System builds pressure at idle but cannot sustain it under load. Suspect: (1) marginal CP4.2 mechanical efficiency that fails under demand, (2) injector return leak bypassing rail faster than CP4 builds under load, or (3) PRV stuck slightly open -- cracking at load pressure. Proceed to IMV duty cycle PID to characterize PCM response, then proceed to LP pressure gauge and filter inspection.',
   'sd4-67psd-test-imv-duty-cycle-pid',
   'Load-only P0087 with normal idle pressure indicates a fault that only manifests when demand exceeds marginal supply capacity. Idle-based tests will be informative but may not fully replicate the condition.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-imv-duty-maxed', 'sd4-67psd-test-imv-duty-cycle-pid',
   'IMV duty cycle is at or near maximum-open command while FRP is low', 'fail',
   'PCM is commanding maximum fuel delivery but rail pressure is still low. Fault is upstream of the IMV -- lift pump supply or filter restriction. Proceed to relay seating visual, then lift pump supply voltage and output pressure tests.',
   'sd4-67psd-test-relay-seating-visual',
   'A maxed-open IMV command with low FRP means the PCM is asking for all available fuel and still not getting enough pressure -- the supply side is the constraint.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-imv-duty-normal', 'sd4-67psd-test-imv-duty-cycle-pid',
   'IMV duty cycle is in a normal working range but FRP is still low', 'warn',
   'PCM is not commanding maximum supply, yet pressure is still low. Suspect CP4.2 mechanical efficiency loss (pump not converting available supply to rail pressure at expected efficiency), or PRV stuck open bypassing rail. Proceed to relay/pump checks and LP pressure gauge, but escalate filter element inspection and PRV bleed-down test.',
   'sd4-67psd-test-relay-seating-visual',
   'Normal IMV command with low FRP suggests the pump has the fuel it needs but isn''t building pressure -- a CP4.2 mechanical efficiency or PRV bypass issue rather than a starvation issue.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-relay-seated-ok', 'sd4-67psd-test-relay-seating-visual',
   'Relay is fully seated, no corrosion observed', 'ok',
   'Relay seating is not the issue. Proceed to lift pump status PID and audible check.',
   'sd4-67psd-test-lift-pump-status-pid',
   'Relay is physically present and seated; move to functional checks of the relay and pump circuit.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-relay-not-seated', 'sd4-67psd-test-relay-seating-visual',
   'Relay is not fully seated or corrosion is visible on cavity terminals', 'fail',
   'Re-seat relay (clean terminals if corroded). Retest lift pump status PID. If lift pump now runs and FRP PID recovers, relay seating was the root cause.',
   'sd4-67psd-test-lift-pump-status-pid',
   'An unseated relay produces the same effect as a failed relay -- no power to the lift pump. Re-seating is zero-cost corrective action before further testing.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-running', 'sd4-67psd-test-lift-pump-status-pid',
   'Lift pump status PID shows commanded/running AND audible hum heard at frame rail', 'ok',
   'Lift pump is electrically alive and mechanically turning. Proceed to FRP sensor 5V reference check to eliminate sensor false-positive.',
   'sd4-67psd-test-frp-5v-ref-at-connector',
   'Pump is running. The low pressure is either false (sensor fault) or mechanical (pump output insufficient, filter restricting, CP4 failing).',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-lift-pump-not-running', 'sd4-67psd-test-lift-pump-status-pid',
   'Lift pump status PID shows commanded but no audible hum at frame rail', 'fail',
   'PCM is commanding the pump but pump is not running. Check supply voltage at pump connector to distinguish relay contact failure from pump motor failure.',
   'sd4-67psd-test-lift-pump-supply-voltage',
   'PCM command present but pump silent -- fault is between relay contacts and pump motor. Voltage check at connector isolates relay contacts from pump motor.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-not-commanded', 'sd4-67psd-test-lift-pump-status-pid',
   'Lift pump status PID shows not commanded / off', 'fail',
   'PCM is not commanding the lift pump. Check for additional DTCs (especially PCM power/ground or CAN communication codes). Verify PCM is receiving correct operating conditions to command the pump. This is a PCM or CAN communication fault branch, not a fuel hardware fault.',
   'sd4-67psd-test-frp-5v-ref-at-connector',
   'If PCM is not commanding the pump, the fuel hardware may be fine. Look upstream at PCM health and CAN communication before condemning fuel components.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-5v-ref-ok', 'sd4-67psd-test-frp-5v-ref-at-connector',
   '5V reference at FRP connector is within tolerance (~4.8-5.2V)', 'ok',
   'PCM reference supply to FRP sensor is healthy. Proceed to FRP signal voltage check to test the sensor itself.',
   'sd4-67psd-test-frp-signal-at-connector',
   'Valid reference confirms the PCM circuit is supplying the sensor correctly. The next test isolates whether the sensor signal output is valid.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-5v-ref-dead', 'sd4-67psd-test-frp-5v-ref-at-connector',
   '5V reference at FRP connector is 0V or significantly out of range', 'fail',
   'PCM is not supplying 5V reference to the FRP sensor. Check for wiring harness damage between PCM and FRP sensor connector. Check PCM power and ground. A missing reference collapses the FRP PID and generates P0087 without any actual fuel pressure problem.',
   NULL,
   'No 5V reference = FRP sensor cannot report. P0087 is sensor-circuit-false. The fuel system may be fine. Do not condemn CP4.2 or lift pump until reference circuit is repaired and PID is re-evaluated.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-signal-resting-ok', 'sd4-67psd-test-frp-signal-at-connector',
   'FRP signal pin voltage at zero-pressure key-on is within expected resting range (not stuck at 0V or 5V)', 'ok',
   'FRP sensor signal output is live and responsive. Low rail pressure is real mechanical issue, not sensor failure. Proceed to lift pump supply voltage and output pressure tests.',
   'sd4-67psd-test-lift-pump-supply-voltage',
   'Sensor is producing a valid resting signal. The pressure problem is real. Continue to mechanical supply-side tests.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-signal-stuck', 'sd4-67psd-test-frp-signal-at-connector',
   'FRP signal pin is stuck at 0V or 5V with valid 5V reference present', 'fail',
   'FRP sensor has failed internally. A stuck-low or stuck-high signal generates a false P0087. Replace FRP sensor. Clear DTC. Re-evaluate rail pressure PID with new sensor before any further fuel system diagnosis.',
   NULL,
   'Valid 5V reference with pegged signal = sensor internal failure. The fuel system pressure may be perfectly normal. Replacing the sensor eliminates this false-positive path before committing to any expensive repairs.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-voltage-ok', 'sd4-67psd-test-lift-pump-supply-voltage',
   'Supply voltage at lift pump connector is near battery voltage (>= 11.5V key-on engine off)', 'ok',
   'Relay and wiring are delivering voltage to the pump motor. Pump is receiving power but may not be producing adequate output pressure. Proceed to lift pump output pressure gauge test.',
   'sd4-67psd-test-lift-pump-output-pressure',
   'Voltage confirmed at motor terminals. If pump is still not running audibly, the pump motor itself has failed mechanically. Output pressure test will confirm.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-voltage-low', 'sd4-67psd-test-lift-pump-supply-voltage',
   'Supply voltage at lift pump connector is significantly below battery voltage (<10V key-on)', 'fail',
   'Voltage drop across relay contacts or wiring. Swap relay with a known-good unit. Retest voltage. If voltage recovers, relay contacts were the fault. If still low, inspect wiring for high-resistance connection or damaged insulation between relay and pump.',
   NULL,
   'Low voltage at pump motor under light-load key-on indicates relay contact resistance or wiring fault absorbing voltage before it reaches the pump.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-pressure-ok', 'sd4-67psd-test-lift-pump-output-pressure',
   'Lift pump output pressure is within expected range at idle', 'ok',
   'Lift pump is producing adequate output. Fault is at or downstream of the filter. Proceed to CP4.2 inlet pressure test to isolate filter restriction.',
   'sd4-67psd-test-cp4-inlet-pressure',
   'If LP output is normal but CP4 inlet pressure is low, the filter assembly is restricting flow between the two gauge points.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-lift-pump-pressure-low', 'sd4-67psd-test-lift-pump-output-pressure',
   'Lift pump output pressure is below expected range at idle', 'fail',
   'Lift pump mechanical output is insufficient. Replace lift pump. Before replacing, confirm fuel tank has adequate fuel and there is no kink or blockage in the supply line between tank and pump.',
   NULL,
   'Low pump output with confirmed voltage supply indicates pump motor or impeller degradation. The tank supply line should be confirmed unrestricted before condemning the pump.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-cp4-inlet-pressure-ok', 'sd4-67psd-test-cp4-inlet-pressure',
   'CP4.2 inlet pressure is within acceptable range at idle', 'ok',
   'CP4.2 is receiving adequate supply pressure. The fault is internal to the CP4.2 (mechanical efficiency loss) or downstream (PRV stuck open, injector return leakage). Proceed to filter element inspection to look for metallic debris (CP4.2 cavitation evidence), then PRV bleed-down test.',
   'sd4-67psd-test-filter-element-inspection',
   'Adequate CP4 inlet pressure with low FRP means the pump has supply but is not converting it to high rail pressure efficiently -- internal pump fault or a high-side leak.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-cp4-inlet-pressure-low', 'sd4-67psd-test-cp4-inlet-pressure',
   'CP4.2 inlet pressure is below minimum acceptable level at idle', 'fail',
   'CP4.2 is being starved. Combined with adequate lift pump output, the filter is restricting. Proceed immediately to filter element inspection -- a restricted or plugged filter element is the root cause. If filter element shows metallic debris, escalate to CP4.2 catastrophic failure path.',
   'sd4-67psd-test-filter-element-inspection',
   'Low CP4 inlet pressure with normal LP output pressure = differential pressure across filter housing confirms restriction. Filter element inspection will determine whether restriction is from normal contamination (replace filter, done) or metallic debris (CP4.2 catastrophic failure path).',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-filter-element-clean', 'sd4-67psd-test-filter-element-inspection',
   'Filter element shows normal contamination, no metallic particulate', 'warn',
   'No CP4.2 catastrophic failure evidence. If filter was plugged (low CP4 inlet pressure confirmed), replace element and retest FRP PID. If inlet pressure was acceptable, continue to rail external leak visual and PRV bleed-down test to find remaining rail-side leak.',
   'sd4-67psd-test-hp-rail-external-leak',
   'Clean filter with low inlet pressure = simple filter restriction, not CP4.2 failure. Clean filter with normal inlet pressure and low FRP redirects to high-side leak or PRV.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-filter-element-metals', 'sd4-67psd-test-filter-element-inspection',
   'Metallic particulate (gray/silver flakes, paste, or debris) found in filter element or drained bowl', 'fail',
   'CP4.2 catastrophic metal-shedding failure confirmed. GATE CROSSED (with corroborating LP/inlet pressure data). DO NOT restart engine. Required remediation: replace CP4.2 pump, replace all 8 injectors, flush both high-pressure rails, replace all HP fuel lines, flush entire LP supply circuit including tank. Failure to complete full system remediation will destroy the replacement pump. Get customer approval for full scope before proceeding.',
   NULL,
   'PATTERN: CP4.2 catastrophic failure per Ford TSB. Metal contamination is irreversible downstream. A single injector swap or pump swap without full flush is a condemned repair -- the new part fails within hours. This is the single most consequential finding in this diagnostic tree.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-rail-leak-found', 'sd4-67psd-test-hp-rail-external-leak',
   'Visible fuel leak at rail fitting, end cap, or injector fitting connection', 'fail',
   'Repair the external high-pressure leak (tighten fitting, replace seal, or replace rail as appropriate for leak location and type). Clear DTC. Retest FRP PID after repair. Do not attempt to run engine with an active HP fuel leak.',
   NULL,
   'External HP leak directly drains the rail. This is a straightforward mechanical repair before any further diagnosis.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-rail-leak-none', 'sd4-67psd-test-hp-rail-external-leak',
   'No external fuel leak found at either rail', 'ok',
   'Rails are externally sealed. Proceed to PRV bleed-down PID test to check for stuck-open pressure relief valve.',
   'sd4-67psd-test-prv-bleeddown-pid',
   'No external leak eliminates rail external leak as the pressure drain. PRV stuck open is the remaining high-side leak candidate.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-bleeddown-normal', 'sd4-67psd-test-prv-bleeddown-pid',
   'FRP PID shows gradual post-shutdown pressure decay over many seconds', 'ok',
   'PRV is not stuck open. Rail is holding pressure post-shutdown. All non-invasive and semi-invasive tests have not conclusively identified root cause -- residual suspects are CP4.2 marginal mechanical efficiency (no metal found, pressure only drops under heavy load) or internal injector bypassing under load. Consult Ford WPS PCED for next-tier test sequence (waveform capture, injector return quantity test). Cumulative confidence does not yet cross gate for CP4.2 replacement -- do not commit without further evidence.',
   NULL,
   'Normal bleed-down eliminates PRV stuck open. If all prior tests also came back negative or inconclusive, the fault may require dynamic load testing or more invasive measurement not yet in model.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-bleeddown-rapid', 'sd4-67psd-test-prv-bleeddown-pid',
   'FRP PID drops to near-zero within 2-3 seconds of key-off from idle', 'fail',
   'PRV is stuck open or leaking at seat. With clean filter element (no metals), adequate CP4 inlet pressure, and confirmed rapid bleed-down: PRV is the root cause of P0087 under load. Replace PRV. This is a targeted, non-catastrophic repair -- does not require injector or pump replacement if metal contamination is absent.',
   NULL,
   'Rapid post-shutdown pressure decay with all supply-side tests passing and no metal in filter is the PRV stuck-open signature. PRV replacement is a low-cost targeted fix compared to a CP4.2 + injector replacement path.',
   'TRAINING-INFERRED', 'LOGIC')
) AS v(
  slug, test_action_slug, condition, verdict, next_action,
  routes_to_slug, reasoning, source_provenance, inference_class
)
JOIN test_actions ta ON ta.slug = v.test_action_slug AND ta.is_retired = false
LEFT JOIN test_actions rta ON rta.slug = v.routes_to_slug AND rta.is_retired = false
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  test_action_id = EXCLUDED.test_action_id,
  condition = EXCLUDED.condition,
  verdict = EXCLUDED.verdict,
  next_action = EXCLUDED.next_action,
  routes_to_test_action_id = EXCLUDED.routes_to_test_action_id,
  reasoning = EXCLUDED.reasoning,
  source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class,
  updated_at = NOW();


-- =========================================================================
-- 4. SYMPTOM_TEST_IMPLICATIONS (13 rows; FK to symptoms + test_actions by slug)
-- =========================================================================
INSERT INTO symptom_test_implications (
  symptom_id, test_action_id, priority, source_provenance, inference_class
)
SELECT
  s.id, ta.id, v.priority, v.source_provenance, v.inference_class
FROM (VALUES
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-fuel-level-visual',         1, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-wif-status-pid',            2, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-frp-pid-idle',              3, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-imv-duty-cycle-pid',        4, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-lift-pump-status-pid',      5, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-relay-seating-visual',      5, 'TRAINING-INFERRED',  'LOGIC'),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-frp-5v-ref-at-connector',   6, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-frp-signal-at-connector',   6, 'TRAINING-INFERRED',  'LOGIC'),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-lift-pump-output-pressure', 7, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-hp-rail-external-leak',     7, 'TRAINING-INFERRED',  'LOGIC'),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-cp4-inlet-pressure',        8, 'TRAINING-INFERRED',  'LOGIC'),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-filter-element-inspection', 9, 'TRAINING-CONFIRMED', NULL),
  ('p0087-fuel-rail-pressure-too-low', 'sd4-67psd-test-prv-bleeddown-pid',        10, 'TRAINING-INFERRED',  'LOGIC')
) AS v(
  symptom_slug, test_action_slug, priority, source_provenance, inference_class
)
JOIN symptoms s ON s.slug = v.symptom_slug
JOIN test_actions ta ON ta.slug = v.test_action_slug AND ta.is_retired = false
ON CONFLICT (symptom_id, test_action_id) WHERE is_retired = false DO UPDATE SET
  priority = EXCLUDED.priority,
  source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class,
  updated_at = NOW();


-- =========================================================================
-- VERIFICATION (informational; counts should be 1 / 14 / 29 / 13)
-- =========================================================================
SELECT 'symptoms' AS t, count(*) AS n FROM symptoms WHERE slug = 'p0087-fuel-rail-pressure-too-low'
UNION ALL
SELECT 'test_actions', count(*) FROM test_actions WHERE slug LIKE 'sd4-67psd-test-%' AND is_retired = false
UNION ALL
SELECT 'branch_logic', count(*) FROM branch_logic WHERE slug LIKE 'sd4-67psd-branch-%' AND is_retired = false
UNION ALL
SELECT 'symptom_test_implications', count(*)
FROM symptom_test_implications sti
JOIN symptoms s ON s.id = sti.symptom_id
WHERE s.slug = 'p0087-fuel-rail-pressure-too-low' AND sti.is_retired = false
ORDER BY t;

COMMIT;
