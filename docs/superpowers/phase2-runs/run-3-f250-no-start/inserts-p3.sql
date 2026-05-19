-- Run 3 / Prompt 3 inserts -- F-250 6.7L PSD + no-start (cranks normally, drivability complaint, no DTC)
-- 1 symptom + 7 NEW test_actions + 31 branch_logic + 19 symptom_test_implications (7 new + 12 reused-from-Run-1)
-- Generated 2026-05-19 from validated P3 subagent JSON (subagent-output-p3.md)
-- Branch slugs that collided with Run 1 have been suffixed -nostart to preserve both rows.

BEGIN;

-- 1. SYMPTOMS
INSERT INTO symptoms (slug, description, category)
VALUES (
  'no-start-cranks-normally-fuel-system-suspect',
  '2018 Ford F-250 6.7L Power Stroke Diesel cranks at normal speed (battery and starter confirmed good) but will not fire. No DTCs confirmed; engine has not reached idle. Fuel system supply chain and PCM injection command are suspect.',
  'no-start'
)
ON CONFLICT (slug) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category, updated_at = NOW();

-- 2. TEST_ACTIONS (7 NEW rows specific to no-start cranking scenario)
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
  ('sd4-67psd-test-dtc-scan-initial', 'sd4-67psd-pcm',
   'Connect scan tool to OBD-II port and read all stored and pending DTCs from the PCM before any other test. Confirms scan tool can communicate with PCM on HS-CAN and captures any codes set during prior crank attempts.',
   'key-on', 'scan_tool_pid',
   NULL, NULL, NULL, NULL,
   'Scan tool establishes communication and returns a DTC list (empty list is a valid, expected result for a drivability complaint with no stored codes). Any fuel system DTC immediately narrows the diagnostic path. No communication means CAN or PCM power supply fault.',
   1, 10,
   'Standard OBD-II initial step for any drivability complaint; HS-CAN access confirmed in structured model at OBD-II port pins 6 and 14.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-fuel-quality-smell', 'sd4-67psd-fuel-filter-ws',
   'Open the fuel filter/water separator drain port and collect a small fuel sample into a clean white shop rag or cup. Smell the sample for gasoline odor or visible cloudiness (gel, water, algae).',
   'key-off', 'smell',
   NULL, NULL, NULL, NULL,
   'Diesel fuel with normal petroleum odor -- no gasoline smell, no unusual cloudiness, no visible gel or wax. Gasoline odor is a FAIL and indicates misfueling. Cloudy/waxy sample indicates gelling or water contamination.',
   2, 12,
   'Fuel quality smell test at filter bowl drain; smell observation method in structured model.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-rpm-pid-cranking', 'sd4-67psd-pcm',
   'With scan tool live-data active on engine RPM PID, have a second tech crank the engine while observing the RPM reading. Confirms PCM is receiving a valid crankshaft/camshaft position signal during engine cranking. Note: crank and cam sensors are not individually modeled -- this test uses the PCM broadcast RPM as proxy.',
   'cranking', 'scan_tool_pid',
   NULL, 150, 'RPM', 75,
   'RPM PID should show approximately 100-250 RPM while the starter is clearly spinning the engine. A reading of zero RPM while engine is confirmed cranking indicates the PCM is not receiving a valid position signal -- cam or crank sensor circuit suspect (outside current model boundary).',
   1, 15,
   'Engine RPM broadcast by PCM on HS-CAN; crank/cam sensor circuit is a known no-start path on 6.7L PSD but is not in current structured model (GAP acknowledged).',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-frp-pid-cranking', 'sd4-67psd-frp-sensor',
   'With scan tool live-data active on FRP PID, crank the engine for 5-10 seconds while observing the pressure reading. Captures whether the CP4.2 high-pressure pump is building rail pressure during cranking. Distinct from the idle-scenario FRP PID test because no-start engine cannot reach idle.',
   'cranking', 'scan_tool_pid',
   NULL, 3000, 'PSI', NULL,
   'Rail pressure should climb from near-zero at initial crank to at least several thousand PSI within 2-3 crank revolutions if supply side is intact. A flat zero indicates no high-pressure pump output. Pressure that builds partially then plateaus very low suggests supply restriction or CP4 wear. Pressure builds to normal but engine still does not start -- check injection command.',
   1, 20,
   'FRP sensor PID observable via HS-CAN; cranking-scenario pressure behavior distinct from idle; minimum cranking threshold is a field-pattern value not present in structured model.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-imv-duty-cycle-cranking', 'sd4-67psd-imv',
   'With scan tool live-data active on IMV commanded duty cycle PID, crank the engine while observing the IMV duty cycle. Confirms the PCM is commanding the IMV to allow fuel into the CP4.2 during cranking. Distinct from idle-scenario IMV PID test.',
   'cranking', 'scan_tool_pid',
   NULL, NULL, 'percent duty cycle', NULL,
   'PCM should be commanding the IMV to an intermediate or high-flow duty cycle position during cranking to maximize fuel delivery. Exact expected percentage is NOT YET CAPTURED. A PCM commanding maximum restriction during crank suggests a PCM control fault.',
   1, 8,
   'IMV duty cycle PID via HS-CAN; cranking-scenario command behavior; normally-open solenoid behavior per structured model.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-test-injector-duty-cycle-cranking', 'sd4-67psd-injector-1',
   'With scan tool live-data active on injector commanded duty cycle or pulse width PID, crank the engine for 5-10 seconds while observing the injector command values. Confirms the PCM is sending injection commands during the crank event.',
   'cranking', 'scan_tool_pid',
   NULL, NULL, 'percent duty cycle or milliseconds pulse width', NULL,
   'If PCM is commanding injection during crank, the injector duty cycle or pulse width PIDs should show non-zero values. All-zero readings with RPM showing normal cranking speed and rail pressure building to adequate levels indicates PCM is inhibiting injection.',
   1, 15,
   'Injector commanded duty cycle PID via HS-CAN; cranking scenario; PCM controls all 8 injectors via dedicated driver circuits.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-test-injector-pwm-cranking', 'sd4-67psd-injector-1',
   'Connect a lab scope to one representative injector harness connector (back-probe signal wire) and capture the PWM waveform while cranking. Confirms actual driver pulses are being delivered to injector solenoids by PCM during crank.',
   'cranking', 'waveform_capture',
   NULL, NULL, NULL, NULL,
   'A healthy injector command circuit during cranking shows distinct high-voltage PWM pulses on the scope. Complete absence of waveform while RPM shows normal cranking and rail pressure is building indicates PCM injector driver circuit fault or PCM injection inhibit.',
   3, 18,
   'Injector PWM waveform capture at injector connector; cranking scenario; PCM driver circuit per structured model component_connections.',
   'TRAINING-CONFIRMED', NULL)
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

-- 3. BRANCH_LOGIC (31 rows; collision-renamed branches have -nostart suffix)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning, source_provenance, inference_class
)
SELECT
  v.slug, ta.id, v.condition, v.verdict, v.next_action,
  rta.id, v.reasoning, v.source_provenance, v.inference_class
FROM (VALUES
  ('sd4-67psd-branch-dtc-no-comm', 'sd4-67psd-test-dtc-scan-initial',
   'Scan tool cannot establish communication with PCM (no response on HS-CAN)', 'fail',
   'Diagnose PCM power supply, ground, and HS-CAN circuit integrity before proceeding. Outside current fuel-system diagnostic path.',
   NULL,
   'PCM must communicate to allow any PID-based testing. No communication is a prerequisite fail. Structured model confirms PCM is the sole fuel system controller and all PID access routes through HS-CAN.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-dtc-fuel-system-code', 'sd4-67psd-test-dtc-scan-initial',
   'DTC scan returns one or more fuel system DTCs (P0087, P0088, P0191, P0192, P0193, injector codes)', 'warn',
   'Route to the appropriate DTC-specific diagnostic path. The current no-start path continues but DTC provides additional signal weighting.',
   'sd4-67psd-test-fuel-level-visual',
   'DTCs narrow the candidate list significantly. A P0087 + no-start points strongly at supply side. P0192/P0193 points at FRP sensor circuit. Continue through physical supply-side path.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-dtc-clean', 'sd4-67psd-test-dtc-scan-initial',
   'DTC scan returns no stored or pending codes', 'ok',
   'Proceed to fuel level visual and WIF/lift pump PID checks.',
   'sd4-67psd-test-fuel-level-visual',
   'No DTCs on a no-start complaint is common -- brief crank attempts may not have run long enough to set a code. Continue diagnostic path.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-fuel-level-empty-nostart', 'sd4-67psd-test-fuel-level-visual',
   'Fuel gauge reads at or below E, or tank confirmed empty on visual check', 'fail',
   'Add minimum 5 gallons of quality diesel fuel, allow lift pump to prime, attempt restart. If fuel was indeed empty, this is the root cause.',
   NULL,
   'Empty tank is the highest-prior-probability no-start cause. If confirmed, stop here -- adding fuel is the fix.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-fuel-level-adequate', 'sd4-67psd-test-fuel-level-visual',
   'Fuel gauge shows 1/4 tank or more (adequate fuel level)', 'ok',
   'Proceed to WIF and lift pump status PID checks.',
   'sd4-67psd-test-wif-status-pid',
   'Adequate fuel level eliminates the simplest no-start cause. Continue supply-side checks.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-wif-active-nostart', 'sd4-67psd-test-wif-status-pid',
   'WIF PID shows water detected / WIF warning lamp is illuminated', 'fail',
   'Drain water from filter bowl until clean diesel flows from drain port. Re-check WIF PID. If WIF cannot be cleared by draining, replace filter element.',
   'sd4-67psd-test-filter-element-inspection',
   'WIF active on a no-start vehicle indicates water contamination has reached or is near the CP4 inlet. Water will prevent adequate rail pressure build.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-wif-clear', 'sd4-67psd-test-wif-status-pid',
   'WIF PID shows no water detected', 'ok',
   'Proceed to lift pump status PID and fuel quality smell test.',
   'sd4-67psd-test-lift-pump-status-pid',
   'No water contamination. Continue to verify lift pump operation and fuel quality.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-lift-pump-not-commanded-nostart', 'sd4-67psd-test-lift-pump-status-pid',
   'Lift pump status PID shows not commanded / OFF at key-on when PCM should be running prime cycle', 'fail',
   'Check relay seating visually. If relay seated, check relay coil voltage and lift pump supply voltage.',
   'sd4-67psd-test-relay-seating-visual',
   'If PCM is not commanding the lift pump, no fuel reaches the CP4. No command suggests a PCM fault, wiring fault, or relay circuit open.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-lift-pump-commanded', 'sd4-67psd-test-lift-pump-status-pid',
   'Lift pump status PID shows commanded ON / running during key-on prime cycle', 'ok',
   'Proceed to fuel quality smell test and cranking-scenario scan tool tests.',
   'sd4-67psd-test-fuel-quality-smell',
   'PCM is commanding lift pump. Rules out PCM command fault but does not confirm the pump is actually delivering pressure.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-fuel-misfueled', 'sd4-67psd-test-fuel-quality-smell',
   'Sample smells of gasoline (lighter, more volatile odor than diesel) or is visibly clear/thin compared to normal diesel', 'fail',
   'STOP -- misfueling confirmed. Do not crank further. Drain and flush the entire fuel system. CP4 assessment required -- gasoline-misfueling on a CP4.2-equipped diesel is potentially catastrophic.',
   NULL,
   'Gasoline in the CP4.2 system is catastrophic. The CP4.2 is lubricated solely by diesel fuel. Even a small amount of gasoline degrades lubrication and accelerates internal wear.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-fuel-gelled', 'sd4-67psd-test-fuel-quality-smell',
   'Sample appears waxy, cloudy, or contains visible gel/wax crystals; diesel odor present but consistency abnormal', 'fail',
   'Fuel is gelled (cold-weather wax formation). Warm the vehicle/fuel system, use diesel fuel conditioner/antigel additive, replace filter element, attempt restart.',
   'sd4-67psd-test-filter-element-inspection',
   'Gelled diesel cannot flow through the filter. Warming and anti-gel treatment is the remedy.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-fuel-quality-ok', 'sd4-67psd-test-fuel-quality-smell',
   'Sample smells of normal diesel, appears normal color, no cloudiness or gasoline odor', 'ok',
   'Proceed to cranking-scenario scan tool PID tests.',
   'sd4-67psd-test-rpm-pid-cranking',
   'Fuel quality confirmed. Proceed to dynamic cranking tests.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-rpm-zero-during-crank', 'sd4-67psd-test-rpm-pid-cranking',
   'RPM PID reads zero or shows no change while engine is clearly cranking audibly and physically', 'fail',
   'OBSERVABILITY HALT -- cam/crank sensor circuit is suspect. Crank and cam sensors are NOT in the current structured model (GAP). Escalate to crank/cam sensor circuit diagnosis using vehicle wiring diagram.',
   NULL,
   'Zero RPM during confirmed cranking means the PCM is not receiving position data. PCM will not fire injectors without this signal. This branch exits the current model boundary.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-rpm-present-during-crank', 'sd4-67psd-test-rpm-pid-cranking',
   'RPM PID shows 100-300 RPM consistent with normal cranking speed', 'ok',
   'PCM is receiving position signal. Proceed to FRP PID during cranking.',
   'sd4-67psd-test-frp-pid-cranking',
   'Normal crank RPM confirms PCM has position data and can sequence injection events.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-zero-during-crank', 'sd4-67psd-test-frp-pid-cranking',
   'FRP PID reads zero or near-zero (below ~500 PSI) throughout the cranking event', 'fail',
   'Zero rail pressure during crank with normal RPM and confirmed fuel supply. Two sub-paths: (1) FRP sensor electrical fault; (2) CP4 not building pressure. Sensor electrical check goes first.',
   'sd4-67psd-test-frp-5v-ref-at-connector',
   'Zero FRP during crank with confirmed RPM means either the sensor is not reading correctly or the CP4 is genuinely not pressurizing. Sensor electrical check is faster and cheaper.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-builds-but-no-start', 'sd4-67psd-test-frp-pid-cranking',
   'FRP PID shows pressure climbing to >2,000 PSI during cranking but engine still does not fire', 'warn',
   'Rail pressure is building. Supply side likely OK. Issue is injection command or injector mechanical. Check injector duty cycle PID during cranking.',
   'sd4-67psd-test-injector-duty-cycle-cranking',
   'If fuel is reaching the rail at pressure and RPM is confirmed, the failure is downstream of the rail. Injector duty cycle PID will distinguish PCM-not-commanding vs. commanded-but-not-firing.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-5v-absent', 'sd4-67psd-test-frp-5v-ref-at-connector',
   '5V reference at FRP sensor connector is absent (reads <4.5V or 0V)', 'fail',
   'FRP sensor power circuit open. Diagnose PCM 5V ref circuit -- check for open wire, corroded connector, or PCM 5V supply fault.',
   NULL,
   'No 5V ref means the FRP sensor cannot output a valid signal. PCM will either use a fallback value or detect the fault.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-5v-present', 'sd4-67psd-test-frp-5v-ref-at-connector',
   '5V reference at FRP sensor connector is present and within spec (4.75-5.25V)', 'ok',
   'FRP sensor power circuit good. Check FRP signal voltage at connector to confirm sensor output is valid.',
   'sd4-67psd-test-frp-signal-at-connector',
   '5V ref present confirms PCM is powering the sensor. Now check signal voltage.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-frp-signal-abnormal', 'sd4-67psd-test-frp-signal-at-connector',
   'FRP signal voltage at key-on reads at or near 0V or at or near 5V (stuck high or stuck low)', 'fail',
   'FRP sensor is faulty (stuck signal). Replace FRP sensor, re-check rail pressure PID during crank, attempt restart.',
   NULL,
   'At zero pressure, FRP signal should read approximately 0.5-0.6V. Readings at voltage rail extremes indicate a faulty sensor or wiring fault.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-frp-signal-ok-nostart', 'sd4-67psd-test-frp-signal-at-connector',
   'FRP signal voltage at key-on reads approximately 0.5-0.7V (near-atmospheric reference)', 'ok',
   'FRP sensor electrical circuit confirmed good. Zero rail pressure during crank is a real physical condition. Proceed to lift pump output pressure and CP4 inlet pressure.',
   'sd4-67psd-test-lift-pump-output-pressure',
   'Sensor is electrically healthy but reporting zero pressure during crank -- this is a real supply-side failure. Work backward from CP4 inlet.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-pressure-low-nostart', 'sd4-67psd-test-lift-pump-output-pressure',
   'Lift pump output pressure measures below expected range (below ~4 PSI is generally inadequate for CP4 supply)', 'fail',
   'Lift pump not delivering adequate supply pressure. Route to lift pump supply voltage test and relay check.',
   'sd4-67psd-test-lift-pump-supply-voltage',
   'Low lift pump output is either an electrical fault (no voltage to pump) or a mechanical pump failure.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-pressure-ok-nostart', 'sd4-67psd-test-lift-pump-output-pressure',
   'Lift pump output pressure is within expected range', 'ok',
   'Lift pump is delivering. Proceed to CP4 inlet pressure to check filter restriction.',
   'sd4-67psd-test-cp4-inlet-pressure',
   'Lift pump confirmed delivering. Now check what pressure is arriving at the CP4 inlet.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-lift-pump-voltage-absent', 'sd4-67psd-test-lift-pump-supply-voltage',
   'No battery voltage at lift pump motor terminals during key-on when PCM is commanding pump', 'fail',
   'No power to lift pump despite PCM command. Check relay seating visual and relay contacts.',
   'sd4-67psd-test-relay-seating-visual',
   'PCM is commanding lift pump but voltage is not reaching the motor. Relay contacts are the most likely open point.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-relay-not-seated-nostart', 'sd4-67psd-test-relay-seating-visual',
   'Lift pump relay is not fully seated in its cavity, is absent, or shows visible damage', 'fail',
   'Reseat or replace relay. Confirm lift pump operation audibly and recheck lift pump status PID.',
   NULL,
   'Improperly seated relay will fail to close its contacts. Reseating is a free fix.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-cp4-inlet-pressure-low-nostart', 'sd4-67psd-test-cp4-inlet-pressure',
   'CP4 inlet pressure is significantly lower than lift pump output pressure', 'fail',
   'Filter restriction confirmed. Proceed to filter element inspection and replacement.',
   'sd4-67psd-test-filter-element-inspection',
   'Large pressure drop across the filter indicates restriction (clogged element, gelled diesel, contamination).',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-cp4-inlet-pressure-ok-nostart', 'sd4-67psd-test-cp4-inlet-pressure',
   'CP4 inlet pressure is comparable to lift pump output pressure (minimal filter differential)', 'fail',
   'Adequate supply to CP4 but zero rail pressure during crank -- CP4 mechanical failure suspected. Check for CP4 audible noise, metal debris in fuel, consider CP4 replacement. Also check hp-rail external leak.',
   'sd4-67psd-test-hp-rail-external-leak',
   'If lift pump delivers adequate pressure to the CP4 inlet but rail pressure still reads zero during crank, the CP4 itself is not building pressure.',
   'TRAINING-CONFIRMED', NULL),

  ('sd4-67psd-branch-injector-dc-zero-during-crank', 'sd4-67psd-test-injector-duty-cycle-cranking',
   'Injector duty cycle PID reads zero during cranking despite normal RPM signal and adequate rail pressure', 'fail',
   'PCM is not commanding injectors during crank. Two possible causes: PCM injection inhibit, or PCM internal driver fault. Proceed to injector PWM waveform capture.',
   'sd4-67psd-test-injector-pwm-cranking',
   'Rail pressure building + RPM signal present + injector DC zero = PCM is choosing not to command injection.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-injector-dc-present-during-crank', 'sd4-67psd-test-injector-duty-cycle-cranking',
   'Injector duty cycle PID shows non-zero values during cranking (PCM is commanding injection events)', 'warn',
   'PCM is commanding injection. Rail pressure confirmed building. Engine still not starting. Proceed to injector PWM waveform.',
   'sd4-67psd-test-injector-pwm-cranking',
   'All command inputs present. Engine still not starting suggests injector mechanical failure or compression issue -- outside model. Waveform bridges from PCM command to physical injector terminal.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-injector-pwm-absent', 'sd4-67psd-test-injector-pwm-cranking',
   'No PWM waveform detected at injector connector during cranking (flat line on scope) despite injector duty cycle PID showing non-zero values', 'fail',
   'PCM PID shows command but no physical pulse at injector connector. Wiring fault or PCM injector driver failure. Check injector harness continuity.',
   NULL,
   'Contradiction between PID (showing command) and waveform (showing no pulse) indicates either wiring open or PCM driver circuit fault.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-injector-pwm-present', 'sd4-67psd-test-injector-pwm-cranking',
   'PWM waveform is present at injector connector during cranking (clear driver pulses visible on scope)', 'warn',
   'PCM is commanding and physically driving the injectors. Rail pressure is building. Engine is still not firing. Outside current structured model boundary -- suspect injector mechanical failure, hydraulic issue, or compression/timing issue. Fuel system is exonerated.',
   NULL,
   'All model-grounded fuel system tests passed. Failure to fire is now a combustion-chamber or injector-mechanical issue -- neither in current model. GATE 96% -- fuel system is exonerated.',
   'TRAINING-INFERRED', 'LOGIC'),

  ('sd4-67psd-branch-prv-bleeddown-active', 'sd4-67psd-test-prv-bleeddown-pid',
   'FRP PID shows pressure rapidly dropping or unable to sustain above idle target', 'warn',
   'PRV may be stuck open, preventing adequate rail pressure build. Check PRV external leak visual.',
   'sd4-67psd-test-hp-rail-external-leak',
   'A stuck-open PRV bleeds rail pressure back to return. If rail pressure builds briefly then immediately collapses, PRV is a candidate.',
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

-- 4. SYMPTOM_TEST_IMPLICATIONS (19 rows; 7 new + 12 referencing existing Run 1 test_actions)
INSERT INTO symptom_test_implications (
  symptom_id, test_action_id, priority, source_provenance, inference_class
)
SELECT s.id, ta.id, v.priority, v.source_provenance, v.inference_class
FROM (VALUES
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-dtc-scan-initial',           1, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-fuel-level-visual',          2, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-wif-status-pid',             3, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-lift-pump-status-pid',       4, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-fuel-quality-smell',         5, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-rpm-pid-cranking',           6, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-frp-pid-cranking',           7, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-imv-duty-cycle-cranking',    8, 'TRAINING-INFERRED', 'LOGIC'),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-injector-duty-cycle-cranking', 9, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-relay-seating-visual',      10, 'TRAINING-INFERRED', 'LOGIC'),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-frp-5v-ref-at-connector',    6, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-frp-signal-at-connector',    7, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-lift-pump-supply-voltage',   7, 'TRAINING-INFERRED', 'LOGIC'),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-lift-pump-output-pressure',  8, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-cp4-inlet-pressure',         9, 'TRAINING-INFERRED', 'LOGIC'),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-filter-element-inspection',  8, 'TRAINING-CONFIRMED', NULL),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-hp-rail-external-leak',      9, 'TRAINING-INFERRED', 'LOGIC'),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-prv-bleeddown-pid',         10, 'TRAINING-INFERRED', 'LOGIC'),
  ('no-start-cranks-normally-fuel-system-suspect', 'sd4-67psd-test-injector-pwm-cranking',     10, 'TRAINING-CONFIRMED', NULL)
) AS v(symptom_slug, test_action_slug, priority, source_provenance, inference_class)
JOIN symptoms s ON s.slug = v.symptom_slug
JOIN test_actions ta ON ta.slug = v.test_action_slug AND ta.is_retired = false
ON CONFLICT (symptom_id, test_action_id) WHERE is_retired = false DO UPDATE SET
  priority = EXCLUDED.priority, source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class, updated_at = NOW();

-- VERIFICATION
SELECT 'symptoms (no-start)' AS t, count(*) AS n FROM symptoms WHERE slug = 'no-start-cranks-normally-fuel-system-suspect'
UNION ALL
SELECT 'test_actions new (no-start)', count(*) FROM test_actions
WHERE slug IN ('sd4-67psd-test-dtc-scan-initial','sd4-67psd-test-fuel-quality-smell','sd4-67psd-test-rpm-pid-cranking','sd4-67psd-test-frp-pid-cranking','sd4-67psd-test-imv-duty-cycle-cranking','sd4-67psd-test-injector-duty-cycle-cranking','sd4-67psd-test-injector-pwm-cranking')
AND is_retired = false
UNION ALL
SELECT 'branch_logic no-start', count(*) FROM branch_logic
WHERE (slug LIKE 'sd4-67psd-branch-dtc-%' OR slug LIKE 'sd4-67psd-branch-fuel-level-empty-nostart' OR slug LIKE 'sd4-67psd-branch-fuel-level-adequate' OR slug LIKE 'sd4-67psd-branch-wif-active-nostart' OR slug = 'sd4-67psd-branch-wif-clear' OR slug LIKE 'sd4-67psd-branch-lift-pump-not-commanded-nostart' OR slug = 'sd4-67psd-branch-lift-pump-commanded' OR slug LIKE 'sd4-67psd-branch-fuel-misfueled' OR slug = 'sd4-67psd-branch-fuel-gelled' OR slug = 'sd4-67psd-branch-fuel-quality-ok' OR slug LIKE 'sd4-67psd-branch-rpm-%' OR slug LIKE 'sd4-67psd-branch-frp-zero-during-crank' OR slug LIKE 'sd4-67psd-branch-frp-builds-but-no-start' OR slug LIKE 'sd4-67psd-branch-frp-5v-absent' OR slug = 'sd4-67psd-branch-frp-5v-present' OR slug = 'sd4-67psd-branch-frp-signal-abnormal' OR slug = 'sd4-67psd-branch-frp-signal-ok-nostart' OR slug LIKE 'sd4-67psd-branch-lift-pump-pressure-%-nostart' OR slug = 'sd4-67psd-branch-lift-pump-voltage-absent' OR slug = 'sd4-67psd-branch-relay-not-seated-nostart' OR slug LIKE 'sd4-67psd-branch-cp4-inlet-pressure-%-nostart' OR slug LIKE 'sd4-67psd-branch-injector-%' OR slug = 'sd4-67psd-branch-prv-bleeddown-active')
AND is_retired = false
UNION ALL
SELECT 'symptom_test_implications (no-start)', count(*) FROM symptom_test_implications sti
JOIN symptoms s ON s.id = sti.symptom_id
WHERE s.slug = 'no-start-cranks-normally-fuel-system-suspect' AND sti.is_retired = false
ORDER BY t;

COMMIT;
