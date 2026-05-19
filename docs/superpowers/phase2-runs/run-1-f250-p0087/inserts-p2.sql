-- Run 1 / Prompt 2 inserts — 2018 F-250 6.7L PSD fuel system: components, observable_properties, component_connections
-- Generated 2026-05-19 from vetted P2 subagent JSON (subagent-output-p2.md)
-- Pending Brandon's approval for live execution

BEGIN;

-- COMPONENTS (28 rows; FK to platforms via slug 'ford-super-duty-4th-gen-67-psd')
WITH p AS (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
INSERT INTO components (slug, platform_id, name, kind, electrical_contract, location, function, source_provenance, inference_class)
SELECT v.slug, p.id, v.name, v.kind, v.electrical_contract, v.location, v.function, v.source_provenance, v.inference_class
FROM p CROSS JOIN (VALUES
  ('sd4-67psd-fuel-tank', 'Fuel Tank', 'mechanical', NULL, 'under the cab/frame', 'Stores diesel fuel; single tank, 26–48 gallons depending on cab/bed configuration; no factory dual-tank option on this generation', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-level-sender', 'Fuel Level Sender', 'sensor', 'resistive analog (variable resistance); wire count and resistance range not yet captured', 'inside the fuel tank', 'Reads fuel level via float-and-resistor mechanism; outputs varying resistance signal for fuel gauge', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump', 'Electric Lift Pump', 'pump', 'electric motor; voltage, current draw, and connector type not yet captured', 'driver-side frame rail', 'Moves fuel from tank at low pressure forward to the filter/water separator and CP4.2 inlet', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-filter-ws', 'Primary Fuel Filter and Water Separator Assembly', 'mechanical', NULL, 'driver-side frame rail, downstream of lift pump', 'Removes particulate contamination and separates free water from diesel fuel before the high-pressure pump; houses the WIF sensor', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-wif-sensor', 'Water-in-Fuel (WIF) Sensor', 'sensor', 'wire count and signal type (analog, discrete, or frequency) not yet captured', 'integrated into the primary fuel filter housing on the driver-side frame rail', 'Detects free water accumulation at the filter/separator and signals the PCM to trigger the WIF warning lamp', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-cp4-pump', 'Bosch CP4.2 High-Pressure Fuel Pump', 'pump', NULL, 'front of engine, gear-driven off front cover area', 'Raises fuel pressure from low-pressure supply to common rail operating pressure (up to ~29,000 PSI peak); internally lubricated entirely by diesel fuel with no separate oil circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-engine-gear-train', 'Engine Front Gear Train (CP4.2 Drive Interface)', 'mechanical', NULL, 'front of engine, front cover area', 'Transmits engine crankshaft rotation to the CP4.2 high-pressure pump via gear drive', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-imv', 'Inlet Metering Valve (IMV)', 'valve', 'PWM solenoid; normally open; wire count, PWM frequency, duty-cycle range, and coil resistance not yet captured', 'inside the CP4.2 pump body', 'Normally-open PWM-controlled solenoid that meters fuel quantity entering the CP4.2 high-pressure circuit under PCM closed-loop control', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-a', 'High-Pressure Fuel Rail (Bank A)', 'mechanical', NULL, 'one cylinder bank; per-bank side (driver/passenger) not yet captured', 'Stores and distributes high-pressure fuel to four injectors on Bank A; acts as hydraulic accumulator to damp pressure fluctuations', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-b', 'High-Pressure Fuel Rail (Bank B)', 'mechanical', NULL, 'opposite cylinder bank from Rail A; per-bank side not yet captured', 'Stores and distributes high-pressure fuel to four injectors on Bank B; acts as hydraulic accumulator to damp pressure fluctuations', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-frp-sensor', 'Fuel Rail Pressure (FRP) Sensor', 'sensor', '3-wire analog: 5V reference, analog voltage signal, ground', 'on the high-pressure fuel rail(s); exact number (one total or one per rail) not yet captured', 'Measures common rail fuel pressure and provides analog voltage feedback to the PCM for closed-loop IMV control', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-1', 'Fuel Injector (Cylinder 1)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; voltage, current, and connector details not yet captured', 'cylinder 1; exact cylinder-to-bank mapping not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-2', 'Fuel Injector (Cylinder 2)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 2; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-3', 'Fuel Injector (Cylinder 3)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 3; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-4', 'Fuel Injector (Cylinder 4)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 4; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-5', 'Fuel Injector (Cylinder 5)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 5; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-6', 'Fuel Injector (Cylinder 6)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 6; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-7', 'Fuel Injector (Cylinder 7)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 7; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-8', 'Fuel Injector (Cylinder 8)', 'actuator', 'high-voltage/high-current PWM via dedicated PCM driver circuit; details not yet captured', 'cylinder 8; exact position not yet captured', 'Solenoid-operated common rail injector; injects metered high-pressure fuel into combustion chamber on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pressure-relief-valve', 'Fuel Rail Mechanical Pressure Relief Valve', 'valve', NULL, 'on the high-pressure fuel rail(s); whether one per rail or one total not yet captured', 'Passive mechanical overpressure protection; opens at factory-set cracking pressure to return fuel and prevent rail overpressure damage', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'Powertrain Control Module (PCM)', 'module', 'connector designations and pin counts not yet captured', 'passenger-side firewall, engine compartment', 'Sole fuel system controller; commands IMV, injectors, and lift pump relay; performs closed-loop rail pressure control via FRP feedback; broadcasts fuel system PIDs on HS-CAN at 500 kbps', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-relay', 'Lift Pump Relay', 'actuator', 'standard automotive relay (coil + contacts); cavity designation, coil resistance, and contact rating not yet captured', 'Battery Junction Box (BJB) or Smart Junction Box (SJB) in engine compartment; exact box and cavity not yet captured', 'Switches battery power to the electric lift pump on PCM command', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-instrument-cluster', 'Instrument Cluster (IPC)', 'module', NULL, 'instrument panel', 'Displays fuel level gauge and illuminates WIF warning lamp based on data received over HS-CAN from the PCM', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-hs-can-bus', 'HS-CAN Bus', 'connector', 'CAN bus, 500 kbps; differential pair; accessible at OBD-II port pins 6 and 14 (PATTERN — confirm)', 'vehicle-wide network; OBD-II port location not explicitly stated in narration', 'High-speed network backbone carrying fuel system PIDs, WIF status, fuel level data, injector duty cycle, and torque management data between PCM, instrument cluster, and ABS/TC module', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-return-circuit', 'Passive Low-Pressure Fuel Return Circuit', 'mechanical', NULL, 'routes from injectors and/or pressure relief valve back to fuel tank or filter housing; exact routing not yet captured', 'Passive (no return pump) return of excess high-pressure fuel from injectors and pressure relief valve to the fuel circuit; termination point (tank vs. filter housing) not yet captured', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-abs-tc-module', 'ABS / Traction Control Module', 'module', NULL, 'not yet captured', 'Exchanges torque management data with PCM over HS-CAN; torque output depends on rail pressure and injection quantity', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-def-tank', 'DEF Tank', 'mechanical', NULL, 'passenger-side frame rail', 'Stores urea (DEF/AdBlue) solution for SCR dosing; separate from the diesel fuel circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-def-dosing-system', 'DEF Dosing System (DEF Pump, DEF Injector, DEF Level/Quality Sensor)', 'actuator', 'PCM-controlled via CAN; individual electrical contracts for pump, injector, and sensor not yet captured', 'not yet captured beyond association with passenger-side DEF tank', 'Meters and injects DEF into the exhaust stream upstream of the SCR catalyst for NOx reduction; interacts with fuel combustion quality for emissions compliance', 'TRAINING-CONFIRMED', NULL)
) AS v(slug, name, kind, electrical_contract, location, function, source_provenance, inference_class)
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  name = EXCLUDED.name, kind = EXCLUDED.kind, electrical_contract = EXCLUDED.electrical_contract,
  location = EXCLUDED.location, function = EXCLUDED.function,
  source_provenance = EXCLUDED.source_provenance, inference_class = EXCLUDED.inference_class,
  updated_at = NOW();

-- OBSERVABLE_PROPERTIES (49 rows; FK to components via component slug)
INSERT INTO observable_properties (slug, component_id, description, observation_method, housing_opacity_status, source_provenance, inference_class)
SELECT v.slug, c.id, v.description, v.observation_method, v.housing_opacity_status, v.source_provenance, v.inference_class
FROM (VALUES
  ('sd4-67psd-fuel-level-sender-signal-resistance', 'sd4-67psd-fuel-level-sender', 'Variable resistance output of the fuel level sender at the harness connector, corresponding to fuel level', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-op-status-pid', 'sd4-67psd-lift-pump', 'Lift pump operational status (running/commanded on) as broadcast on HS-CAN and readable via scan tool PID', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-audible', 'sd4-67psd-lift-pump', 'Audible pump motor noise detectable at the driver-side frame rail when the lift pump is commanded on', 'audible', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-output-pressure', 'sd4-67psd-lift-pump', 'Low-pressure fuel output pressure at the lift pump outlet or filter inlet fitting', 'pressure_test_with_gauge', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-supply-voltage', 'sd4-67psd-lift-pump', 'Battery supply voltage delivered to the lift pump motor terminals via the relay', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-fuel-filter-water-via-pid', 'sd4-67psd-fuel-filter-ws', 'Water-in-fuel status at the filter/separator housing as reported by the WIF sensor through the PCM WIF status PID', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-filter-element-condition', 'sd4-67psd-fuel-filter-ws', 'Physical condition and contamination state of the fuel filter element when the housing is opened and the element is removed', 'direct_visual_internal', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-filter-restriction', 'sd4-67psd-fuel-filter-ws', 'Filter restriction indicated by differential pressure between lift pump outlet and CP4.2 inlet', 'pressure_test_with_gauge', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-fuel-filter-water-drained', 'sd4-67psd-fuel-filter-ws', 'Presence of water in the filter/separator bowl when the drain port is opened and contents are collected for visual inspection', 'direct_visual_internal', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-filter-fuel-smell', 'sd4-67psd-fuel-filter-ws', 'Odor of drained fuel sample from the filter bowl indicating fuel quality or contamination', 'smell', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-wif-status-pid', 'sd4-67psd-wif-sensor', 'WIF sensor status (water detected / not detected) as broadcast by the PCM on HS-CAN and readable via scan tool', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-wif-signal-at-pcm-pin', 'sd4-67psd-wif-sensor', 'WIF sensor signal voltage or state at the PCM connector pin', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-wif-signal-at-sensor-connector', 'sd4-67psd-wif-sensor', 'WIF sensor signal voltage or state at the sensor harness connector', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-cp4-rail-pressure-pid', 'sd4-67psd-cp4-pump', 'Fuel rail pressure delivered by the CP4.2 as reported by the FRP sensor PID on HS-CAN', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-cp4-audible-noise', 'sd4-67psd-cp4-pump', 'Abnormal knock or cavitation noise detectable at the CP4.2 pump body location at the front of the engine', 'audible', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-cp4-inlet-pressure', 'sd4-67psd-cp4-pump', 'Low-pressure supply fuel pressure at the CP4.2 inlet fitting', 'pressure_test_with_gauge', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-imv-duty-cycle-pid', 'sd4-67psd-imv', 'IMV commanded duty cycle as broadcast by the PCM on HS-CAN and readable via scan tool', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-imv-pwm-waveform', 'sd4-67psd-imv', 'PWM signal waveform at the IMV solenoid connector as commanded by the PCM', 'waveform_capture', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-imv-solenoid-resistance', 'sd4-67psd-imv', 'IMV solenoid coil resistance measured at the connector (component electrical integrity check)', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-hp-rail-a-pressure-pid', 'sd4-67psd-hp-rail-bank-a', 'High-pressure fuel rail pressure in Bank A as reported via FRP sensor PID on HS-CAN', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-a-external-leak', 'sd4-67psd-hp-rail-bank-a', 'External fuel leak at rail body, end caps, or fitting connections, visible from outside the rail', 'direct_visual_external', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-hp-rail-b-pressure-pid', 'sd4-67psd-hp-rail-bank-b', 'High-pressure fuel rail pressure in Bank B as reported via FRP sensor PID on HS-CAN', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-b-external-leak', 'sd4-67psd-hp-rail-bank-b', 'External fuel leak at Bank B rail body, end caps, or fitting connections', 'direct_visual_external', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-frp-rail-pressure-pid', 'sd4-67psd-frp-sensor', 'Common rail fuel pressure value as reported by the FRP sensor and broadcast on HS-CAN', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-frp-5v-ref-at-connector', 'sd4-67psd-frp-sensor', '5V reference voltage supplied by the PCM at the FRP sensor harness connector reference pin', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-frp-signal-voltage-at-connector', 'sd4-67psd-frp-sensor', 'Analog signal voltage output from the FRP sensor at the signal pin of the harness connector', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-frp-ground-continuity', 'sd4-67psd-frp-sensor', 'Ground circuit continuity at the FRP sensor harness connector ground pin', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-frp-signal-waveform', 'sd4-67psd-frp-sensor', 'FRP sensor signal voltage waveform under dynamic engine load conditions (e.g., cranking, idle, WOT ramp)', 'waveform_capture', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-injector-pwm-waveform', 'sd4-67psd-injector-1', 'High-voltage/high-current PWM waveform at the injector solenoid connector during engine operation (representative for all 8 injectors; capture per cylinder for individual diagnosis)', 'waveform_capture', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-duty-cycle-pid', 'sd4-67psd-injector-1', 'Injector commanded duty cycle or pulse width for each cylinder as reported via scan tool PID on HS-CAN', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-solenoid-resistance', 'sd4-67psd-injector-1', 'Injector solenoid coil resistance at the injector harness connector (per cylinder)', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-injector-audible-tick', 'sd4-67psd-injector-1', 'Audible injector tick at the cylinder head; character change (rattle, knock, absence) indicates injector fault', 'audible', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-injector-external-leak', 'sd4-67psd-injector-1', 'External fuel leak at the injector body, O-rings, or return fittings, visible from outside', 'direct_visual_external', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-prv-rail-pressure-drop-pid', 'sd4-67psd-pressure-relief-valve', 'Abnormal rail pressure bleed-down indicating relief valve opening, visible as a rapid pressure drop in the FRP PID trace', 'scan_tool_pid', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-prv-external-leak', 'sd4-67psd-pressure-relief-valve', 'External fuel leak at the pressure relief valve seat or body', 'direct_visual_external', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-prv-internal-condition', 'sd4-67psd-pressure-relief-valve', 'Mechanical condition of the pressure relief valve seat and spring when removed from the rail', 'direct_visual_internal', 'removable', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-pcm-fuel-pids', 'sd4-67psd-pcm', 'PCM-broadcast fuel system PIDs (rail pressure, lift pump status, injector duty cycle, WIF status, ICP) readable via scan tool over HS-CAN', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm-connector-voltages', 'sd4-67psd-pcm', 'Power supply, ground, and signal pin voltages at the PCM harness connector(s)', 'electrical_measurement_at_pin', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-pcm-can-waveform', 'sd4-67psd-pcm', 'HS-CAN differential bus signal quality at the PCM connector CAN-H and CAN-L pins', 'waveform_capture', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-relay-seating-visual', 'sd4-67psd-lift-pump-relay', 'Physical presence and seating of the lift pump relay in its junction box cavity, visible with the junction box cover removed', 'direct_visual_external', 'removable', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-relay-coil-voltage', 'sd4-67psd-lift-pump-relay', 'Voltage at the relay coil control circuit terminal (PCM command side) and battery supply terminal', 'electrical_measurement_at_pin', 'removable', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-relay-click-audible', 'sd4-67psd-lift-pump-relay', 'Audible click of the relay actuating when the PCM commands it on (detectable at the BJB or SJB with hood open)', 'audible', 'removable', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-cluster-fuel-gauge-visual', 'sd4-67psd-instrument-cluster', 'Fuel level gauge needle position as displayed on the instrument cluster face', 'direct_visual_external', 'transparent', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-cluster-wif-lamp-visual', 'sd4-67psd-instrument-cluster', 'WIF warning lamp illumination state on the instrument cluster face', 'direct_visual_external', 'transparent', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-can-fuel-pids-obd', 'sd4-67psd-hs-can-bus', 'All fuel system PIDs (rail pressure, injector duty, WIF status, lift pump status) readable via scan tool connected to the HS-CAN at the OBD-II port', 'scan_tool_pid', NULL, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-can-signal-waveform', 'sd4-67psd-hs-can-bus', 'HS-CAN differential signal quality (CAN-H / CAN-L waveform) at OBD-II pins 6 and 14 or at module connectors', 'waveform_capture', NULL, 'TRAINING-INFERRED', 'PATTERN'),
  ('sd4-67psd-return-circuit-external-leak', 'sd4-67psd-return-circuit', 'External fuel leak along the return line routing, visible from outside the line', 'direct_visual_external', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-return-circuit-backpressure', 'sd4-67psd-return-circuit', 'Return line back-pressure at the injector return fitting, measurable with a gauge to detect downstream restriction', 'pressure_test_with_gauge', 'unknown', 'TRAINING-INFERRED', 'LOGIC'),
  ('sd4-67psd-def-level-quality-pid', 'sd4-67psd-def-tank', 'DEF fluid level and quality as broadcast by the PCM on HS-CAN and readable via scan tool PID', 'scan_tool_pid', 'unknown', 'TRAINING-CONFIRMED', NULL)
) AS v(slug, component_slug, description, observation_method, housing_opacity_status, source_provenance, inference_class)
JOIN components c ON c.slug = v.component_slug AND c.is_retired = false
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  description = EXCLUDED.description, observation_method = EXCLUDED.observation_method,
  housing_opacity_status = EXCLUDED.housing_opacity_status,
  source_provenance = EXCLUDED.source_provenance, inference_class = EXCLUDED.inference_class,
  updated_at = NOW();

-- COMPONENT_CONNECTIONS (43 rows; double FK to components via from + to slugs)
INSERT INTO component_connections (from_component_id, to_component_id, connection_kind, direction, description, source_provenance, inference_class)
SELECT cfrom.id, cto.id, v.connection_kind, v.direction, v.description, v.source_provenance, v.inference_class
FROM (VALUES
  ('sd4-67psd-fuel-tank', 'sd4-67psd-lift-pump', 'fluid-line', 'unidirectional', 'Low-pressure fuel supply from tank to lift pump inlet', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump', 'sd4-67psd-fuel-filter-ws', 'fluid-line', 'unidirectional', 'Low-pressure pressurized fuel from lift pump to filter/water separator inlet', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-filter-ws', 'sd4-67psd-cp4-pump', 'fluid-line', 'unidirectional', 'Filtered low-pressure fuel from filter housing to CP4.2 inlet', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-cp4-pump', 'sd4-67psd-hp-rail-bank-a', 'fluid-line', 'unidirectional', 'High-pressure fuel from CP4.2 outlet to Bank A fuel rail', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-cp4-pump', 'sd4-67psd-hp-rail-bank-b', 'fluid-line', 'unidirectional', 'High-pressure fuel from CP4.2 outlet to Bank B fuel rail', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-a', 'sd4-67psd-injector-1', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank A rail to injector 1', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-a', 'sd4-67psd-injector-2', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank A rail to injector 2', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-a', 'sd4-67psd-injector-3', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank A rail to injector 3', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-a', 'sd4-67psd-injector-4', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank A rail to injector 4', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-b', 'sd4-67psd-injector-5', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank B rail to injector 5', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-b', 'sd4-67psd-injector-6', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank B rail to injector 6', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-b', 'sd4-67psd-injector-7', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank B rail to injector 7', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-hp-rail-bank-b', 'sd4-67psd-injector-8', 'fluid-line', 'unidirectional', 'High-pressure fuel from Bank B rail to injector 8', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-1', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 1 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-2', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 2 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-3', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 3 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-4', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 4 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-5', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 5 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-6', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 6 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-7', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 7 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-8', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Excess high-pressure fuel return from injector 8 to passive return circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pressure-relief-valve', 'sd4-67psd-return-circuit', 'fluid-line', 'unidirectional', 'Fuel diverted from rail by pressure relief valve into the passive return circuit when cracking pressure is exceeded', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-return-circuit', 'sd4-67psd-fuel-tank', 'fluid-line', 'unidirectional', 'Return fuel routed back to the fuel tank OR filter housing (exact termination point not yet captured — GAP); shown here as tank per narration listing tank first', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-imv', 'controlled_by', 'unidirectional', 'PCM commands IMV via high-frequency PWM electrical signal to meter fuel entering CP4.2 high-pressure circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-1', 'controlled_by', 'unidirectional', 'PCM drives injector 1 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-2', 'controlled_by', 'unidirectional', 'PCM drives injector 2 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-3', 'controlled_by', 'unidirectional', 'PCM drives injector 3 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-4', 'controlled_by', 'unidirectional', 'PCM drives injector 4 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-5', 'controlled_by', 'unidirectional', 'PCM drives injector 5 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-6', 'controlled_by', 'unidirectional', 'PCM drives injector 6 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-7', 'controlled_by', 'unidirectional', 'PCM drives injector 7 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-injector-8', 'controlled_by', 'unidirectional', 'PCM drives injector 8 via dedicated high-voltage/high-current PWM injector driver circuit', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-lift-pump-relay', 'controlled_by', 'unidirectional', 'PCM commands the lift pump relay coil to switch battery power to the lift pump', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-relay', 'sd4-67psd-lift-pump', 'electrical-wire', 'unidirectional', 'Relay contact supplies switched battery voltage to the electric lift pump motor', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-frp-sensor', 'sd4-67psd-pcm', 'reports_to', 'unidirectional', 'FRP sensor outputs 3-wire analog signal (5V ref from PCM, analog signal return, ground) to PCM for closed-loop rail pressure control', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-wif-sensor', 'sd4-67psd-pcm', 'reports_to', 'unidirectional', 'WIF sensor signals water presence in the filter housing to the PCM via an electrical signal (signal type not yet captured)', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-level-sender', 'sd4-67psd-pcm', 'reports_to', 'unidirectional', 'Fuel level sender resistive analog signal routes to PCM (or possibly directly to cluster — routing is a captured GAP; shown here per PATTERN inference I8)', 'TRAINING-INFERRED', 'PATTERN'),
  ('sd4-67psd-pcm', 'sd4-67psd-hs-can-bus', 'can-bus', 'bidirectional', 'PCM communicates on HS-CAN at 500 kbps; broadcasts fuel system PIDs and receives torque management data', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-instrument-cluster', 'sd4-67psd-hs-can-bus', 'can-bus', 'bidirectional', 'Instrument cluster receives fuel level and WIF status data from PCM over HS-CAN to drive fuel gauge and WIF warning lamp', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-abs-tc-module', 'sd4-67psd-hs-can-bus', 'can-bus', 'bidirectional', 'ABS/TC module exchanges torque management data with PCM over HS-CAN; torque output depends on rail pressure and injection quantity', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-engine-gear-train', 'sd4-67psd-cp4-pump', 'mechanical-linkage', 'unidirectional', 'Engine front gear train drives the CP4.2 high-pressure pump via gear mesh at the front cover', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm', 'sd4-67psd-def-dosing-system', 'can-bus', 'bidirectional', 'PCM controls DEF dosing system and receives DEF level/quality sensor data via CAN', 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-def-tank', 'sd4-67psd-def-dosing-system', 'fluid-line', 'unidirectional', 'DEF fluid supplied from DEF tank to DEF pump/dosing module', 'TRAINING-CONFIRMED', NULL)
) AS v(from_slug, to_slug, connection_kind, direction, description, source_provenance, inference_class)
JOIN components cfrom ON cfrom.slug = v.from_slug AND cfrom.is_retired = false
JOIN components cto ON cto.slug = v.to_slug AND cto.is_retired = false
ON CONFLICT (from_component_id, to_component_id, connection_kind) WHERE is_retired = false DO UPDATE SET
  direction = EXCLUDED.direction, description = EXCLUDED.description,
  source_provenance = EXCLUDED.source_provenance, inference_class = EXCLUDED.inference_class,
  updated_at = NOW();

-- Verification before COMMIT
SELECT
  (SELECT count(*) FROM components WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND is_retired = false) AS component_count,
  (SELECT count(*) FROM observable_properties op JOIN components c ON c.id = op.component_id WHERE c.platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND op.is_retired = false) AS observable_count,
  (SELECT count(*) FROM component_connections cc JOIN components c ON c.id = cc.from_component_id WHERE c.platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND cc.is_retired = false) AS connection_count;
-- Expected: component_count=28, observable_count=49, connection_count=43

COMMIT;