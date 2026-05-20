-- Run 2 / Prompt 3 inserts -- F-250 6.7L PSD + P0088 fuel-rail-pressure-too-high
-- 1 symptom + 7 NEW test_actions + 23 branch_logic + 12 symptom_test_implications (7 new + 5 reused-from-Run-1)
-- Generated 2026-05-19 from validated P3 subagent JSON (subagent-output-p3.md)
-- Branch slugs that collided with Run 1 have been suffixed -p0088 to preserve both rows.

BEGIN;

-- 1. SYMPTOMS
INSERT INTO symptoms (slug, description, category)
VALUES (
  'p0088-fuel-rail-pressure-too-high',
  'P0088 -- Fuel Rail / System Pressure Too High. Customer reports rough running and occasional power loss under load; idle is stable. DTC set under load conditions on a 2018 Ford F-250 6.7L Power Stroke Diesel.',
  'dtc'
)
ON CONFLICT (slug) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category, updated_at = NOW();

-- 2. TEST_ACTIONS (7 NEW rows specific to P0088)
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
  ('sd4-67psd-test-frp-pid-medium-load', 'sd4-67psd-frp-sensor',
   'Monitor FRP sensor PID live data during medium-load acceleration (road test or controlled snap-throttle in bay) to capture the over-pressure event that matches the customer complaint. Observe whether rail pressure climbs beyond normal peak.',
   'medium-load', 'scan_tool_pid',
   NULL, NULL, 'PSI', NULL,
   'Normal peak rail pressure on 6.7 PSD under medium load is approximately 23,000-26,000 PSI. P0088 threshold is not yet captured in model. An abnormal reading would show pressure climbing toward or past 29,000 PSI with no relief-valve bleed-down event.',
   1, 20,
   '6.7 PSD common rail operating pressure range and P0088 threshold are TRAINING-CONFIRMED for this platform; exact OEM threshold value is a model gap.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-frp-waveform-load', 'sd4-67psd-frp-sensor',
   'Capture FRP sensor signal voltage waveform at the sensor harness connector signal pin during medium-load operation. Compare signal voltage ramp against the expected linear pressure-to-voltage curve.',
   'medium-load', 'waveform_capture',
   NULL, NULL, 'V', NULL,
   'FRP sensor output voltage should rise linearly and smoothly with increasing pressure. Expected voltage range is approximately 0.5V (low pressure) to 4.5V (max pressure) proportional to rail pressure PID reading. A spike to near 5V with no corresponding mechanical evidence, erratic high-frequency noise, or trace diverging from the PID indicates sensor false-high.',
   2, 12,
   '3-wire analog pressure sensor voltage behavior (0.5-4.5V proportional) is TRAINING-CONFIRMED generic; exact Ford WSM curve spec is a model gap.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-imv-pwm-waveform-idle', 'sd4-67psd-imv',
   'Capture the IMV solenoid PWM waveform at the IMV connector while the engine is at idle. Confirm the PCM is outputting a valid PWM signal and that duty cycle at the connector matches the IMV duty cycle PID.',
   'idle', 'waveform_capture',
   NULL, NULL, NULL, NULL,
   'A clean PWM square wave should be present at the IMV connector with frequency and duty cycle matching the IMV PID reading. Exact PWM frequency spec is a model gap. A missing or severely distorted waveform with a normal PID reading indicates harness fault. A clean waveform with normal duty cycle but persistent over-pressure directs suspicion to IMV mechanical sticking.',
   2, 8,
   'IMV PWM electrical contract partially captured in model. Waveform approach is TRAINING-CONFIRMED diagnostic method for solenoid command verification.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-imv-solenoid-resistance', 'sd4-67psd-imv',
   'With key-off and IMV connector unplugged, measure IMV solenoid coil resistance at the harness connector (component side). An open circuit, short to ground, or out-of-spec reading indicates internal coil fault.',
   'key-off', 'electrical_measurement_at_pin',
   'resistance', NULL, 'ohms', NULL,
   'IMV solenoid coil resistance specification is a model gap -- exact value not yet captured. Technician must reference Ford WSM or compare to a known-good IMV. OL (open circuit) or near-0 ohms (short) are definitive failures regardless of spec.',
   2, 8,
   'IMV electrical contract in model states wire count, PWM frequency, duty-cycle range, and coil resistance not yet captured. Resistance measurement approach for PWM solenoid integrity is TRAINING-CONFIRMED.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-prv-external-leak', 'sd4-67psd-pressure-relief-valve',
   'With key-off and engine cool, visually inspect the pressure relief valve body and the area immediately surrounding it on the high-pressure rail for evidence of external fuel leakage (wet spots, dried fuel residue, fuel odor at the valve).',
   'key-off', 'direct_visual_external',
   NULL, NULL, NULL, NULL,
   'No fuel seepage, wet residue, or staining at the PRV body or fitting. Any fuel presence at the PRV on a P0088 case is unexpected (a leaking PRV relieves pressure) and would indicate a co-existing PRV leak masking a higher underlying pressure.',
   1, 4,
   'PRV location in model. External visual is TRAINING-CONFIRMED standard inspection step before high-pressure fitting removal.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-return-backpressure', 'sd4-67psd-return-circuit',
   'Install a low-pressure gauge at an accessible injector return fitting (or return line junction point) and measure return circuit back-pressure with the engine running at idle. Elevated back-pressure indicates a downstream restriction.',
   'idle', 'pressure_test_with_gauge',
   NULL, NULL, 'PSI', NULL,
   'Return circuit back-pressure specification is a model gap. Expected is near-zero to very low pressure (passive gravity-return system). Any reading above a few PSI warrants further investigation for downstream restriction.',
   3, 8,
   'Return circuit described in model as passive (no return pump). Back-pressure measurement as a restriction test is TRAINING-INFERRED via LOGIC. Spec is a model gap.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-prv-internal-condition', 'sd4-67psd-pressure-relief-valve',
   'INVASIVE -- execute only after gate is reached. Remove the pressure relief valve from the rail per Ford WSM procedure. Inspect the valve seat, spring, and body for carbon buildup, corrosion, scoring, or physical deformation that would prevent the valve from opening at its factory cracking pressure.',
   'key-off', 'direct_visual_internal',
   NULL, NULL, NULL, NULL,
   'A serviceable PRV should have a clean, undamaged seat, a free-moving spring, and no evidence of carbon fouling or corrosion that would hold it closed. The valve should be manually depressible. A PRV that is stuck solid, has a scored seat, or whose spring is collapsed is a definitive failure confirmation.',
   4, 8,
   'PRV function described in model. Internal inspection is TRAINING-INFERRED via LOGIC. Cracking pressure spec is a model gap.',
   'TRAINING-INFERRED', 'LOGIC')
) AS v(
  slug, component_slug, description, scenario_required, observation_method,
  meter_mode, expected_value, expected_unit, expected_tolerance, expected_observation,
  invasiveness, confidence_boost, source_citation, source_provenance, inference_class
)
JOIN components c ON c.slug = v.component_slug AND c.is_retired = false
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  component_id = EXCLUDED.component_id, description = EXCLUDED.description,
  scenario_required = EXCLUDED.scenario_required, observation_method = EXCLUDED.observation_method,
  meter_mode = EXCLUDED.meter_mode, expected_value = EXCLUDED.expected_value,
  expected_unit = EXCLUDED.expected_unit, expected_tolerance = EXCLUDED.expected_tolerance,
  expected_observation = EXCLUDED.expected_observation, invasiveness = EXCLUDED.invasiveness,
  confidence_boost = EXCLUDED.confidence_boost, source_citation = EXCLUDED.source_citation,
  source_provenance = EXCLUDED.source_provenance, inference_class = EXCLUDED.inference_class,
  updated_at = NOW();

-- 3. BRANCH_LOGIC (23 rows; collision-renamed branches have -p0088 suffix)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning, source_provenance, inference_class
)
SELECT
  v.slug, ta.id, v.condition, v.verdict, v.next_action,
  rta.id, v.reasoning, v.source_provenance, v.inference_class
FROM (VALUES
  ('sd4-67psd-branch-frp-idle-normal', 'sd4-67psd-test-frp-pid-idle',
   'FRP PID at idle reads within expected normal idle pressure range (approximately 4,000-6,000 PSI at warm idle)', 'ok',
   'Proceed to IMV duty cycle check; idle pressure is not the anomaly -- over-pressure is load-dependent or sensor artifact.',
   'sd4-67psd-test-imv-duty-cycle-pid',
   'Normal idle FRP PID narrows the fault to a load-triggered event: IMV failure under high duty cycle, sensor drift under dynamic conditions, PRV failing only under elevated pressure, or return restriction building under sustained load.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-idle-elevated', 'sd4-67psd-test-frp-pid-idle',
   'FRP PID at idle reads persistently elevated (outside expected idle pressure range) with stable idle quality', 'warn',
   'Cross-check FRP signal voltage at connector to distinguish real over-pressure from sensor false-high.',
   'sd4-67psd-test-frp-5v-ref-at-connector',
   'Elevated FRP PID at idle with stable idle quality is more consistent with sensor false-high than actual mechanical over-pressure. Verifying 5V reference and signal voltage is the fastest differentiator.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-imv-duty-normal-p0088', 'sd4-67psd-test-imv-duty-cycle-pid',
   'IMV duty cycle PID at idle reads within normal expected range (approximately 50-70% at warm idle -- model gap)', 'ok',
   'IMV command is normal at idle. Proceed to PRV bleed-down observation and then medium-load FRP PID.',
   'sd4-67psd-test-prv-bleeddown-pid',
   'Normal IMV duty at idle does not eliminate IMV mechanical sticking (the valve may stick only under high duty-cycle commands at load). It does eliminate PCM command-level fault at idle conditions.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-imv-duty-high', 'sd4-67psd-test-imv-duty-cycle-pid',
   'IMV duty cycle PID reads anomalously high at idle (well above expected idle range)', 'fail',
   'Abnormal IMV command at idle. Escalate to IMV PWM waveform to determine if the fault is PCM output or IMV mechanical.',
   'sd4-67psd-test-imv-pwm-waveform-idle',
   'High IMV duty cycle at idle is an active PCM command signal issue or a feedback loop fault. Waveform distinguishes PCM driver fault (waveform fault) from IMV mechanical (clean waveform, high PID, over-pressure).',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-prv-pid-normal', 'sd4-67psd-test-prv-bleeddown-pid',
   'FRP PID trace at idle shows expected occasional brief pressure drops consistent with PRV modulating', 'ok',
   'PRV is opening at idle pressures. Proceed to medium-load FRP PID to capture the load-triggered over-pressure event.',
   'sd4-67psd-test-frp-pid-medium-load',
   'PRV opening at idle indicates the valve mechanism is functional at idle-range pressures. However, PRV may still fail to open at higher load-range pressures.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-pid-no-events', 'sd4-67psd-test-prv-bleeddown-pid',
   'FRP PID trace at idle shows no PRV bleed-down events over an extended observation period', 'warn',
   'Absence of PRV events at idle is suspicious. Could indicate PRV stuck closed OR that idle pressure simply never reaches cracking threshold. Escalate to medium-load FRP PID.',
   'sd4-67psd-test-frp-pid-medium-load',
   'PRV bleed-down events are most visible under higher pressure conditions. Absence at idle alone is not conclusive for stuck-closed.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-load-spike', 'sd4-67psd-test-frp-pid-medium-load',
   'FRP PID climbs to or past expected maximum peak pressure under medium load with no corresponding PRV bleed-down event; rough running symptoms present', 'fail',
   'Real over-pressure confirmed dynamically. Two leading candidates: IMV mechanically stuck closed under load, or PRV mechanically stuck closed. Proceed to FRP waveform capture to verify sensor accuracy.',
   'sd4-67psd-test-frp-waveform-load',
   'A genuine pressure spike under load with absent PRV relief points to a real hydraulic over-pressure event. Waveform capture either confirms sensor accuracy or reveals sensor distortion.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-load-normal', 'sd4-67psd-test-frp-pid-medium-load',
   'FRP PID under medium load shows normal pressure values within expected peak range with no spike', 'ok',
   'Over-pressure not reproduced under medium load. DTC may be intermittent or sensor-artifact. Proceed to FRP waveform under load.',
   'sd4-67psd-test-frp-waveform-load',
   'If pressure appears normal under load, the DTC was either set by a transient event, by sensor drift, or requires heavier load to reproduce.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-waveform-erratic', 'sd4-67psd-test-frp-waveform-load',
   'FRP signal voltage waveform under load is erratic, spikes non-linearly, or diverges significantly from the PID reading', 'fail',
   'Sensor false-high confirmed as active contributor. Verify 5V reference stability and signal voltage at connector to quantify the sensor error before replacement.',
   'sd4-67psd-test-frp-5v-ref-at-connector',
   'An erratic waveform that does not correspond to expected pressure-proportional voltage is definitive evidence of sensor fault.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-waveform-clean', 'sd4-67psd-test-frp-waveform-load',
   'FRP signal voltage waveform under load is clean, linear, and consistent with the PID reading', 'ok',
   'Sensor is reading accurately. Over-pressure confirmed as real mechanical event. Proceed to IMV electrical investigation.',
   'sd4-67psd-test-imv-solenoid-resistance',
   'Clean waveform matching the PID eliminates sensor false-high. IMV and PRV remain as primary hardware candidates.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-5v-ref-ok-p0088', 'sd4-67psd-test-frp-5v-ref-at-connector',
   '5V reference at FRP connector measures 4.9-5.1V (stable)', 'ok',
   'Reference supply is stable. Proceed to FRP signal voltage cross-check.',
   'sd4-67psd-test-frp-signal-at-connector',
   '5V reference within tolerance eliminates reference voltage collapse as the cause. Signal voltage cross-check is next.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-5v-ref-low', 'sd4-67psd-test-frp-5v-ref-at-connector',
   '5V reference at FRP connector measures below 4.7V or is unstable/fluctuating', 'fail',
   'Reference voltage fault. The FRP sensor cannot produce an accurate reading without a stable 5V reference. Trace the reference circuit to PCM.',
   NULL,
   'A collapsed or noisy 5V reference causes the FRP sensor signal to be proportionally inaccurate. PCM output or harness fault, not sensor fault.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-signal-high-at-rest', 'sd4-67psd-test-frp-signal-at-connector',
   'FRP signal voltage at connector with engine key-on (not running) reads above expected low-pressure resting value (above approximately 1.0V key-on engine-off)', 'fail',
   'Sensor is outputting a false-high signal at rest. Sensor replacement is the leading recommendation. Confirm with medium-load PID after replacement.',
   NULL,
   'A sensor reading high with the engine off has a mechanical or electrical fault internal to the sensor producing a false-high signal.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-imv-resistance-ooc', 'sd4-67psd-test-imv-solenoid-resistance',
   'IMV solenoid resistance reads OL (open circuit) or significantly outside spec', 'fail',
   'IMV coil has an internal electrical fault. IMV replacement is indicated. GATE CHECK: coil fault alone does not reach 95% -- confirm return circuit and PRV status before component recommendation.',
   'sd4-67psd-test-return-backpressure',
   'An OL or out-of-spec IMV coil means the PCM PWM command cannot produce the intended solenoid force. Confirming return circuit and PRV status covers co-existing faults.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-imv-resistance-ok', 'sd4-67psd-test-imv-solenoid-resistance',
   'IMV solenoid resistance reads within specification range', 'ok',
   'IMV coil is electrically intact. Mechanical sticking remains possible. Proceed to return backpressure test and then PRV inspection.',
   'sd4-67psd-test-return-backpressure',
   'A within-spec coil resistance eliminates winding failure. IMV mechanical sticking is still possible. Return circuit and PRV investigation continue.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-imv-waveform-fault', 'sd4-67psd-test-imv-pwm-waveform-idle',
   'IMV PWM waveform at connector is absent, severely distorted, or does not match the commanded duty cycle PID', 'fail',
   'PCM driver output or harness fault between PCM and IMV connector. Trace the harness. Do not condemn IMV until command signal is verified clean.',
   NULL,
   'The IMV cannot respond to a command it is not receiving. This is a higher-level electrical fault that must be resolved before any IMV mechanical conclusion.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-imv-waveform-ok', 'sd4-67psd-test-imv-pwm-waveform-idle',
   'IMV PWM waveform at connector is clean with correct duty cycle matching PID', 'ok',
   'PCM command signal is reaching the IMV correctly. If over-pressure still present, IMV mechanical sticking or PRV stuck closed remain as leading candidates.',
   'sd4-67psd-test-imv-solenoid-resistance',
   'A clean waveform confirms the PCM is commanding correctly and the harness is intact. The fault is either IMV mechanical or PRV.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-return-backpressure-elevated', 'sd4-67psd-test-return-backpressure',
   'Return circuit back-pressure at idle reads above expected near-zero value', 'fail',
   'Return restriction confirmed as active contributor. Trace return line routing for kinks, collapsed sections, or blocked fittings.',
   'sd4-67psd-test-prv-external-leak',
   'Elevated back-pressure means the return circuit is restricting fuel escape. Under load, this restriction compounds and contributes to rail over-pressure.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-return-backpressure-ok', 'sd4-67psd-test-return-backpressure',
   'Return circuit back-pressure at idle reads within expected range (near-zero for passive return)', 'ok',
   'Return circuit is not restricting. Proceed to PRV external inspection and then internal inspection.',
   'sd4-67psd-test-prv-external-leak',
   'Normal return backpressure eliminates return restriction. Remaining candidates are IMV mechanical sticking and PRV stuck closed.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-external-clean', 'sd4-67psd-test-prv-external-leak',
   'No fuel seepage, staining, or wet residue visible at PRV body or fitting', 'ok',
   'PRV body is sealed externally. Stuck-closed failure mode remains possible. Proceed to PRV internal inspection.',
   'sd4-67psd-test-prv-internal-condition',
   'A dry PRV is consistent with both a functioning PRV and a stuck-closed PRV. External visual does not clear the PRV; internal inspection is required.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-prv-external-leaking', 'sd4-67psd-test-prv-external-leak',
   'Fuel seepage or staining visible at PRV body -- valve is leaking externally', 'warn',
   'PRV external leak is unexpected for P0088 (a leaking PRV relieves pressure). Co-existing fault. The over-pressure cause is elsewhere. Address PRV leak separately.',
   'sd4-67psd-test-prv-internal-condition',
   'An externally leaking PRV is relevant to safety but does not explain P0088. Continue investigation.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-internal-stuck', 'sd4-67psd-test-prv-internal-condition',
   'PRV is stuck closed, has a scored seat, a collapsed or corroded spring, or carbon fouling that prevents valve movement', 'fail',
   'PRV stuck closed confirmed as definitive P0088 cause. Gate reached -- PRV replacement recommended with post-repair verification via medium-load FRP PID.',
   NULL,
   'A physically non-functioning PRV cannot relieve rail pressure when it exceeds cracking pressure. Definitive mechanical failure confirmation.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-internal-ok', 'sd4-67psd-test-prv-internal-condition',
   'PRV valve, seat, and spring are visually clean and mechanically functional', 'ok',
   'PRV eliminated as mechanical cause. If all other checks clean, remaining candidate is IMV mechanical sticking or PCM software fault. IMV replacement as test-by-replacement if gate confidence permits, or PCM reprogramming/substitution.',
   NULL,
   'With PRV functional, sensor accurate, return circuit clear, and IMV electrically intact, the remaining possibility is an IMV valve-needle mechanical fault that passes electrical tests but physically sticks under high-duty-cycle command conditions.',
   'TRAINING-INFERRED', 'LOGIC')
) AS v(
  slug, test_action_slug, condition, verdict, next_action,
  routes_to_slug, reasoning, source_provenance, inference_class
)
JOIN test_actions ta ON ta.slug = v.test_action_slug AND ta.is_retired = false
LEFT JOIN test_actions rta ON rta.slug = v.routes_to_slug AND rta.is_retired = false
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  test_action_id = EXCLUDED.test_action_id, condition = EXCLUDED.condition,
  verdict = EXCLUDED.verdict, next_action = EXCLUDED.next_action,
  routes_to_test_action_id = EXCLUDED.routes_to_test_action_id,
  reasoning = EXCLUDED.reasoning, source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class, updated_at = NOW();

-- 4. SYMPTOM_TEST_IMPLICATIONS (12 rows; 7 new + 5 referencing existing Run 1 test_actions)
INSERT INTO symptom_test_implications (
  symptom_id, test_action_id, priority, source_provenance, inference_class
)
SELECT s.id, ta.id, v.priority, v.source_provenance, v.inference_class
FROM (VALUES
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-frp-pid-idle',              1, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-imv-duty-cycle-pid',        2, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-prv-bleeddown-pid',         3, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-frp-pid-medium-load',       4, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-frp-waveform-load',         5, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-frp-5v-ref-at-connector',   6, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-frp-signal-at-connector',   7, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-imv-pwm-waveform-idle',     8, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-imv-solenoid-resistance',   9, 'TRAINING-INFERRED', 'LOGIC'),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-prv-external-leak',         8, 'TRAINING-CONFIRMED', NULL),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-return-backpressure',       7, 'TRAINING-INFERRED', 'LOGIC'),
  ('p0088-fuel-rail-pressure-too-high', 'sd4-67psd-test-prv-internal-condition',   10, 'TRAINING-INFERRED', 'LOGIC')
) AS v(symptom_slug, test_action_slug, priority, source_provenance, inference_class)
JOIN symptoms s ON s.slug = v.symptom_slug
JOIN test_actions ta ON ta.slug = v.test_action_slug AND ta.is_retired = false
ON CONFLICT (symptom_id, test_action_id) WHERE is_retired = false DO UPDATE SET
  priority = EXCLUDED.priority, source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class, updated_at = NOW();

-- VERIFICATION
SELECT 'symptoms (p0088)' AS t, count(*) AS n FROM symptoms WHERE slug = 'p0088-fuel-rail-pressure-too-high'
UNION ALL
SELECT 'test_actions new (p0088)', count(*) FROM test_actions
WHERE slug IN ('sd4-67psd-test-frp-pid-medium-load','sd4-67psd-test-frp-waveform-load','sd4-67psd-test-imv-pwm-waveform-idle','sd4-67psd-test-imv-solenoid-resistance','sd4-67psd-test-prv-external-leak','sd4-67psd-test-return-backpressure','sd4-67psd-test-prv-internal-condition')
AND is_retired = false
UNION ALL
SELECT 'branch_logic p0088 (incl p0088-suffixed)', count(*) FROM branch_logic
WHERE (slug LIKE 'sd4-67psd-branch-frp-idle-%' OR slug LIKE 'sd4-67psd-branch-imv-duty-%' OR slug LIKE 'sd4-67psd-branch-prv-pid-%' OR slug LIKE 'sd4-67psd-branch-frp-load-%' OR slug LIKE 'sd4-67psd-branch-frp-waveform-%' OR slug = 'sd4-67psd-branch-frp-5v-ref-ok-p0088' OR slug = 'sd4-67psd-branch-frp-5v-ref-low' OR slug = 'sd4-67psd-branch-frp-signal-high-at-rest' OR slug LIKE 'sd4-67psd-branch-imv-resistance-%' OR slug LIKE 'sd4-67psd-branch-imv-waveform-%' OR slug LIKE 'sd4-67psd-branch-return-backpressure-%' OR slug LIKE 'sd4-67psd-branch-prv-external-%' OR slug LIKE 'sd4-67psd-branch-prv-internal-%')
AND is_retired = false
UNION ALL
SELECT 'symptom_test_implications (p0088)', count(*) FROM symptom_test_implications sti
JOIN symptoms s ON s.id = sti.symptom_id
WHERE s.slug = 'p0088-fuel-rail-pressure-too-high' AND sti.is_retired = false
ORDER BY t;

COMMIT;
