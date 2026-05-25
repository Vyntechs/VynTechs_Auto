-- ===========================================================================
-- Batch 5: test_actions — 11 canonical cranks-no-start tests for 6.0L PSD
-- PR: 6.0 PSD cranks-no-start canonical seed
-- Platform: ford-super-duty-3rd-gen-60-psd
-- Source: Section 3 of 2026-05-24-6.0-psd-cranks-no-start-research-input.md
--
-- 11 rows exactly — one per canonical diagnostic test.
-- FK via component_id (test_actions has NO direct platform_id column).
-- Slug format: sd3-60psd-test-<test-name>
-- Column notes (from lib/db/schema.ts + Amendment 3):
--   description          NOT NULL — carries test title + procedure + prerequisites
--   scenario_required    NOT NULL — enum: 'key-off'|'key-on'|'cranking'|'idle'|...
--   observation_method   NOT NULL — underscored enum: scan_tool_pid, etc.
--   expected_observation nullable — free-text expected reading (incl. disputes)
--   invasiveness         integer NOT NULL — schema constraint: BETWEEN 1 AND 5
--                        Mapping from research-input 0-3 scale:
--                          0 (scan tool / no disassembly)  → 1
--                          1 (minor: remove cover/connector) → 2
--                          2 (moderate: remove several parts) → 3
--                          3 (extensive: deep teardown)      → 5
--   confidence_boost     real NOT NULL default 0
--   source_provenance    NOT NULL — 'FIELD-VERIFIED'
--   inference_class      nullable
--   is_retired           boolean NOT NULL default false
--
-- FACT-CHECK CORRECTIONS ENCODED:
--   Test 6 (air/puff): description explicitly says "TURBO REMOVAL IS NOT REQUIRED"
--   Test 7 (ICP sensor unplug): description says "NOT the IPR" and explains that
--     unplugging the IPR forces it to default 15% (open/bleed-off) — different test.
--     Substituted ICP value is marked UNCERTAIN (~750 psi most cited, also 700/870).
--   Test 9 (low-pressure fuel): expected_observation surfaces the UNRESOLVED
--     disagreement between Ford service info (≥45 psi all conditions) and aftermarket
--     sources documenting 10–15 psi cranking as normal.
-- ===========================================================================

-- ─── Test 1 — Full DTC pull (engine + trans modules) ────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-pull-all-dtcs',
  c.id,
  E'Full DTC Pull — PCM, FICM, and GPCM.\n\nPurpose: Capture any stored or pending fault codes across all modules BEFORE disturbing the vehicle. Specifically watch for ICP, IPR, FICM, CKP, CMP, glow plug, and injector circuit codes.\n\nPrerequisites: Functional OBD-II port. Scan tool that supports Ford diesel modules (Ford IDS/FDRS, Snap-on, Autel MaxiSys, or ForScan + ELM327).\n\nProcedure:\n1. Key on, engine off (KOEO).\n2. Pull all stored and pending DTCs from PCM, FICM, and TCM/GPCM.\n3. Record all codes verbatim — do NOT clear them until each code is interpreted.\n\nKey code interpretations:\n- P0611 + P0261/P0264/P0267/P0270/P0273/P0276/P0279/P0282 (all 8 injector circuit lows): classic failed FICM power supply.\n- P2285 (circuit low) / P2287 (intermittent): ICP sensor or wiring fault — not necessarily low actual pressure.\n- P2291 (ICP too low during cranking): actual high-pressure oil system cannot build pressure.\n- P2614 + P2617 simultaneously: typically a long-crank artifact, not sensor failure — clear and retest.\n- P1368: FICM supply voltage low — verify batteries before condemning FICM.',
  'key-on',
  'scan_tool_pid',
  'No codes → proceed to battery + FICM voltage checks. P0611 + injector circuit lows → FICM power supply failed. P2291 → actual ICP cannot build. P2285/P2287 → ICP sensor or wiring fault.',
  1,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- ─── Test 2 — FICM voltage check (12 V supply AND 48 V output) ──────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-ficm-voltage',
  c.id,
  E'FICM Voltage Check — 12 V supply (VPWR/LPWR) and 48 V injector drive output (MPWR).\n\nPurpose: Confirm the FICM receives acceptable battery voltage AND produces the 48 V injector-drive output required to fire the HEUI injectors.\n\nPrerequisites: Batteries fully charged (rest voltage 12.5–12.7 V each). FICM accessible (driver-side valve cover area, beneath degas bottle).\n\nProcedure (scan tool):\n1. KOEO. Pull PIDs FICM_VPWR (vehicle power), FICM_LPWR (logic power), FICM_MPWR (48 V output).\n2. FICM_VPWR and FICM_LPWR should both read >10.5 V. FICM_MPWR should read ≈48 V.\n   NOTE: PID label standardization is uncertain across scan tools — verify against your tool''s FICM PID list.\n\nProcedure (manual DVOM — definitive):\n1. Remove FICM cover (T20 Torx). Use DVOM with negative on battery negative.\n2. Probe the correct FICM power output pin (4-pin FICM: bottom pin closest to driver side; 7-pin FICM: top pin on 4-pin row closest to engine centerline). Key in RUN, engine off.\n3. Reading should be 47–49 V. Repeat during crank — should not drop below 45 V.\n   CAUTION: Do not let the probe slip and short adjacent pins — this will destroy the FICM.\n\nExpected values:\n- 47–49 V at key-on: FICM healthy.\n- 36–45 V: failing power supply, still functional but degrading.\n- < 35 V or 0 V: power supply failed; rebuild or replace.',
  'key-on',
  'scan_tool_pid',
  'FICM_VPWR ≈12 V, FICM_LPWR ≈12 V, FICM_MPWR ≥45 V (47–49 V ideal). Values below 45 V indicate FICM power supply failure.',
  2,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- ─── Test 3 — Battery voltage during crank (load-side) ──────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-battery-crank',
  c.id,
  E'Battery Voltage During Cranking (load-side test).\n\nPurpose: Rule out weak batteries or corroded cables masquerading as a high-pressure oil or FICM failure. Low crank voltage damages the FICM AND causes the starter to spin too slowly for proper compression heating.\n\nPrerequisites: Both batteries installed; clean, corrosion-free terminals.\n\nProcedure:\n1. Engine off, rested 30+ min. Measure each battery individually with cables disconnected — each should read 12.5–12.7 V at rest.\n2. Reconnect. Allow the glow plug pre-heat cycle to complete first (Wait-To-Start lamp extinguishes) so glow plug current draw is not compounded with starter draw during measurement.\n3. Crank for up to 10 s while monitoring voltage at battery terminals with DVOM or scan tool.\n\nNote: Ford spec is no less than 9.3 V for max 10 s during crank. Most technicians use ≥10 V at the battery posts as a working threshold.',
  'cranking',
  'electrical_measurement_at_pin',
  'Crank voltage ≥10 V at battery posts: acceptable for further diagnosis. Sag below 9.3 V: weak battery, bad cable, or starter drawing excessive amps. Cranking RPM < ~180–200: insufficient for compression-heat ignition.',
  1,
  0,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- ─── Test 4 — ICP live read during 10-second crank ──────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-icp-live-read',
  c.id,
  E'ICP Live PID Read During Crank (ICP_VOLTS and ICP actual psi).\n\nPurpose: Capture peak rail oil pressure during cranking and observe whether ICP actual ever reaches the 500 psi minimum required for injectors to fire. This is the single most diagnostic data point in a 6.0 PSD cranks-no-start.\n\nPrerequisites: Engine oil level on full hash of dipstick. Base engine oil pressure ≥12 psi confirmed. Scan tool with high-speed data logging.\n\nProcedure:\n1. Open scan tool. Add PIDs: ICP_VOLTS, ICP (actual psi), ICP_DESIRED, IPR_DUTY.\n2. Set up data logging at maximum sample rate.\n3. Crank engine for up to 10 s. Stop. Review log.\n\nInterpretation:\n- ICP rises smoothly to ≥500 psi within ~3–5 s and engine starts → high-pressure oil system OK.\n- ICP rises but plateaus at 250–450 psi with IPR_DUTY climbing to 85% → cannot build pressure; high-pressure-side leak (STC, standpipes, dummy plugs, injector O-rings) or weak HPOP. Proceed to air test (Test 6).\n- ICP_VOLTS stuck at ≤0.2 V or ≥4.5 V with no movement → ICP sensor electrical fault; proceed to sensor unplug test (Test 7).\n- ICP actual sawtooths erratically while IPR_DUTY is steady → likely HPOP internal damage or air in HPOP suction.',
  'cranking',
  'scan_tool_pid',
  'ICP must reach ≥0.80 V (≥500 psi) within ~3–5 s of cranking for engine to fire. IPR_DUTY ramps toward 85% during crank, then drops back as pressure builds and engine starts. Plateau below 500 psi with IPR at 85% = leak or HPOP issue. ICP_VOLTS stuck = sensor fault.',
  1,
  0,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-icp-sensor';

-- ─── Test 5 — IPR duty cycle interpretation ─────────────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-ipr-duty-cycle',
  c.id,
  E'IPR Commanded Duty Cycle — Cranking and Warm Idle.\n\nPurpose: Read what the PCM is commanding the IPR valve to do while trying to control rail pressure. A high duty-cycle command paired with low actual ICP is the signature of a high-pressure oil leak or inability to build pressure.\n\nPrerequisites: Same as ICP live read (Test 4). Typically run alongside Test 4 in the same data log session.\n\nProcedure: Monitor IPR_DUTY alongside ICP during KOEO, cranking, and (if engine starts) warm idle.\n\nKEY CAVEAT: "85% IPR duty cycle ONLY means actual ICP is less than desired ICP. You have NO WAY of knowing what the valve is or isn''t actually doing." Treat duty cycle as a demand signal, not a valve position signal.\n\nInterpretation:\n- 15% at KOEO → IPR fully open (no flow demand); normal.\n- Ramps to ~85% during crank, drops back as ICP climbs and engine starts → normal control loop.\n- Stuck at 85% through entire crank with ICP never reaching 500 psi → high-pressure leak or HPOP cannot generate pressure.\n- Stuck at 15% with no movement → IPR control fault or disconnected/failed valve.\n- >30% at warm idle → leak in the high-pressure circuit.',
  'cranking',
  'scan_tool_pid',
  'Normal crank: ramps toward 85%, drops back as ICP climbs. Normal warm idle: <30%. Stuck at 85% during crank with ICP never reaching 500 psi = high-pressure leak or HPOP issue. >30% at warm idle = leak. Stuck at 15% = IPR control fault.',
  1,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ipr-valve';

-- ─── Test 6 — Air ("puff") test for high-pressure oil leak isolation ─────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-air-puff',
  c.id,
  E'Air (Puff) Test — High-Pressure Oil Leak Isolation.\n\nPurpose: The universal standard-of-care for 6.0 PSD high-pressure oil diagnosis. Pressurize the high-pressure oil system with shop air so leaks become audible and the leak source can be triangulated.\n\nTURBO REMOVAL IS NOT REQUIRED. Air cleaner, FICM, and degas bottle removal access the engine valley sufficiently to reach the IPR port and listen at key locations. Intake removal is optional on 2005-2007 trucks — a skilled tech can leave it on and save 1.5–2 hr. The HPOP itself sits beneath the turbo, but the IPR port (the air injection point) is accessible without turbo removal.\n\nPrerequisites: Oil level full. Air compressor capable of ≥100 psi delivery. IPR test fitting (Accurate Diesel, Ferrum Tools, Riffraff, or shop-built equivalent). Access to the IPR port.\n\nProcedure:\n1. If engine will start, warm to oil temp ≥176 °F first — thinner oil reveals marginal leaks.\n2. Remove air cleaner, FICM, and coolant degas bottle for access.\n3. Remove the IPR valve (4-wire connector unplug, OTC 6765 socket recommended) and thread the air-test fitting into the IPR port. Hand-tight is sufficient.\n4. Connect shop air. Begin at ~100 psi; some techs push to 150 psi for stubborn leaks.\n5. With engine NOT running, listen systematically at: valve cover area, rear of engine (STC / branch tube area), oil fill cap, and crankcase breather.\n\nSound → Source:\n- Loud air from valve cover area → standpipe O-rings or dummy plug O-rings.\n- Loud air from rear of engine behind turbo → STC fitting leak or branch tube (2004.5–2007 only).\n- Air in crankcase (oil fill / breather) with no upper noise → injector body O-ring(s) leaking into combustion chamber or push-tube area.\n- Back-flow / gurgling at oil filter drain (held open) at 150–200 psi → air flowing backward through HPOP — strong HPOP indictment.',
  'key-off',
  'audible',
  'Audible air leak localizes the source: valve cover = standpipes/dummy plugs; rear of engine = STC fitting (2004.5+ only); crankcase = injector O-rings; back-flow through HPOP = HPOP internal failure.',
  3,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-hpop';

-- ─── Test 7 — ICP SENSOR unplug test (NOT the IPR) ──────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-icp-sensor-unplug',
  c.id,
  E'ICP Sensor Unplug Test — NOT the IPR (these are entirely different tests with opposite meanings).\n\nPurpose: Determine whether a low or erratic ICP reading is caused by the sensor itself or by actual low rail pressure. Unplugging the ICP sensor forces the PCM to substitute a default inferred rail pressure, which may allow the engine to start if the sensor was the faulty component.\n\nCRITICAL DISTINCTION — do NOT confuse these two unplug tests:\n- Unplugging the ICP SENSOR: the PCM substitutes a default pressure value (most commonly cited as ~750 psi, but this is UNCERTAIN — also reported as 700 psi and 870 psi across sources; the exact value matters less than understanding that the PCM removes the sensor from the loop). If the engine starts after unplugging the ICP sensor, the sensor was the failure point.\n- Unplugging the IPR VALVE: this is a completely different test. The IPR is a mechanical actuator — disconnecting it forces the valve to its mechanical default of 15% (fully open / maximum bleed-off), which guarantees rail pressure collapses to near zero. The engine WILL NOT start with the IPR unplugged; this behavior is normal and expected. The IPR unplug test diagnoses the IPR valve''s solenoid, NOT the broader rail pressure system.\n\nPrerequisites: Run Test 4 (ICP live read) first — only proceed to this unplug test if ICP reading was suspicious (stuck low, stuck high, or erratic).\n\nProcedure:\n1. Locate the ICP sensor. Late 2004.5–2007: passenger-side valve cover near GPCM (easy access, ~5 min). Early 2003–early 2004: behind turbo on HPOP cover (difficult access, ~1.5 hr).\n2. Disconnect the ICP sensor harness connector.\n3. Attempt to start the engine.\n4. Observe start behavior and compare ICP PID values vs connected-sensor cranking baseline.\n\nInterpretation:\n- Engine starts and runs with sensor unplugged but would not start plugged in → ICP sensor or pigtail faulty; replace both.\n- No change (engine still will not start) → ICP sensor is not the limiting fault. The PCM''s substituted pressure alone is insufficient — actual rail pressure is still low. Proceed to air test (Test 6) or FICM/fuel diagnosis.',
  'cranking',
  'scan_tool_pid',
  'Engine may start with sensor unplugged (PCM substitutes ~750 psi typical — UNCERTAIN, also reported as 700 and 870 psi). If engine starts after unplug: sensor or pigtail is the fault. If no change: actual rail pressure is low regardless of sensor input — proceed to air test.',
  2,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-icp-sensor';

-- ─── Test 8 — Glow plug system test ─────────────────────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-glow-plug-resistance',
  c.id,
  E'Glow Plug System Test — Resistance and Current Draw.\n\nPurpose: Identify open glow plugs, GPCM faults, or relay faults that prevent cold-temperature ignition.\n\nPrerequisites: Batteries confirmed good (Test 3 complete). Engine cold or at ambient temperature for accurate resistance readings.\n\nProcedure:\n1. KOEO. Pull glow plug DTCs from PCM first.\n2. Run scan-tool active command to cycle the glow plug relay; listen for relay click and verify current draw via clamp meter on the lead wire — should draw approximately 80 A while the cycle is active (initial inrush).\n3. Disconnect the GPCM connectors (one black, one green; connector mapping per forum consensus — black = even cylinders, green = odd cylinders — no verified Ford manual source).\n4. With DVOM set to resistance, measure from each connector pin to battery negative.\n\nExpected values:\n- Pass: 0.5–2.0 Ω per plug; steady state draw 10–12 A per plug.\n- Initial inrush: ~80 A per bank; this is normal and does not indicate a fault.\n- Fail: open circuit (OL / overrange) or very high resistance → replace failed plug(s).\n\nCRITICAL APPLICATION NOTE: 2003 and early-2004 glow plugs CANNOT be used in late-2004+ engines — they physically contact the piston. Engine build date cutoff is 9/29/2003. Always verify the correct glow plug application by engine build date before ordering.',
  'key-off',
  'electrical_measurement_at_pin',
  '0.5–2.0 Ω per plug; ~80 A per bank initial inrush (normal); 10–12 A per plug steady-state. Open circuit or grossly out-of-range = failed plug. White smoke during crank with otherwise healthy ICP + FICM confirms glow plug system as the no-start path.',
  3,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-glow-plugs';

-- ─── Test 9 — Low-pressure fuel test (Schrader port) ────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-low-pressure-fuel',
  c.id,
  E'Low-Pressure Fuel Test — Schrader Port at Fuel Bowl.\n\nPurpose: Confirm the lift pump (HFCM) delivers adequate fuel pressure at the engine-top fuel bowl Schrader test port.\n\nPrerequisites: Schrader adapter that fits the 6 mm Allen fuel bowl test port. Fuel pressure gauge (0–100 psi range). Fuel filter service history — if filters are long overdue, service them first.\n\nProcedure:\n1. Remove the 6 mm Allen plug on the fuel bowl Schrader port (driver-side, fender-facing side of the bowl).\n2. Install Schrader adapter and connect fuel pressure gauge.\n3. Key on, engine off — verify the HFCM primes audibly and pressure builds at the port.\n4. Crank the engine for 5–10 s; observe pressure during cranking.\n5. If engine starts, verify pressure at idle and under load.\n\nSee expected_observation note for the UNRESOLVED source disagreement on cranking pressure spec.',
  'cranking',
  'pressure_test_with_gauge',
  'UNRESOLVED source disagreement on cranking pressure: Ford service info (corroborated by DieselHub and Bullet Proof Diesel) states ≥45 psi all conditions including cranking. Diesel Power Products walkthrough documents 10–15 psi during cranking and 40–45 psi while running as normal. The 10–15 psi figure may represent a momentary sag during crank-start rather than a sustained steady value. Verify against your shop''s Ford service reference before concluding on a cranking pressure reading. Running pressure ≥45 psi is uncontested across sources. 0 psi at key-on: HFCM not running — check 12 V supply, relay, fuse. Active water-in-fuel warning: drain water separator before further diagnosis.',
  2,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-lift-pump';

-- ─── Test 10 — Compression test ─────────────────────────────────────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-compression',
  c.id,
  E'Cylinder Compression Test (last resort — per-cylinder via glow plug bore).\n\nPurpose: Rule out mechanical loss (worn rings, burnt valve, cracked head, hydrolock from EGR cooler failure) after the high-pressure oil, FICM, glow plug, and fuel paths have been cleared.\n\nThis is the last test in the cranks-no-start sequence. Only run if Tests 1–9 are inconclusive and the high-pressure oil, fuel, and electrical systems have been verified.\n\nPrerequisites: All glow plugs accessible. Both batteries fully charged — starter must spin engine at ≥200 RPM for valid compression readings. Diesel compression adapter fitting for glow plug bore. Cylinders dry (not flooded).\n\nProcedure:\n1. Remove all 8 glow plugs.\n2. Install diesel compression adapter into each glow plug hole in turn.\n3. Crank engine for 5–10 s per cylinder; record peak pressure.\n4. For any low cylinder: wet test — add a small amount of motor oil through the glow plug hole, retest. Pressure jumps after wet test → worn rings. Unchanged after wet test → valve issue, head gasket failure, or head crack.\n\nNote: compression test accesses the combustion chamber through the glow plug bore, not the injector bore — this test is invasiveness 3 on the research input scale due to glow plug removal on an engine that may have corroded plugs.',
  'cranking',
  'pressure_test_with_gauge',
  '350–400 psi per cylinder; 375 psi ideal. Cylinder-to-cylinder deviation ≤5% ideal; up to 10% tolerated. Low single cylinder with wet test improvement → worn rings. Low single cylinder unchanged after wet test → valve or head gasket issue. All cylinders low → uniform mechanical wear or starter spinning too slowly (verify RPM ≥200).',
  5,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-injectors';

-- ─── Test 11 — Cam/crank correlation (no-code sync verification) ─────────────
INSERT INTO test_actions (
  slug, component_id, description, scenario_required, observation_method,
  expected_observation, invasiveness, confidence_boost,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-test-cam-crank-correlation',
  c.id,
  E'Cam/Crank Correlation and FICM Sync Verification.\n\nPurpose: Identify cases where the FICM cannot achieve sync because the CKP or CMP signal is degraded but not failed hard enough to set a code. FICM_SYNC = 0 during crank means the PCM/CKP sync signal is not reaching the FICM — the engine will not start regardless of ICP or fuel.\n\nPrerequisites: Scan tool capable of reading FICM_SYNC bit and PCM RPM PID. This test applies when no codes are set (particularly no P2614/P2617) but the engine refuses to start.\n\nProcedure:\n1. Crank engine while monitoring scan tool.\n2. Verify PCM RPM PID reads ≥~100 RPM during crank (confirms CKP is sending a signal to the PCM).\n3. Verify FICM_SYNC reads 1 during crank (confirms the FICM received and acknowledged the sync signal from the PCM).\n4. If FICM_SYNC = 0 with RPM > 0: the PCM sees engine speed but the FICM does not receive sync. Check CKP-to-FICM signal path and CMP signal.\n\nCommon causes of FICM_SYNC = 0:\n- Rust buildup between CKP sensor face and the engine block, increasing air gap and weakening the signal.\n- Oil migration up the CMP harness, contaminating the connector.\n\nSensor locations on 6.0 PSD:\n- CKP: under the A/C compressor on the passenger side.\n- CMP: hidden behind the power steering pump on the driver side.\n\nCKP replacement note: requires inner fender removal, coolant drain, fan shroud, and A/C compressor unbolt — typically 2–3 hr labor.',
  'cranking',
  'scan_tool_pid',
  'FICM_SYNC = 1 and PCM RPM > 100 during crank → cam/crank pathway healthy. FICM_SYNC = 0 → CKP or CMP signal not arriving at FICM. Check for rust at CKP sensor face (increased air gap) or oil contamination at CMP harness connector.',
  3,
  0,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';
