-- ===========================================================================
-- Batch 4: observable_properties — 6.0L Power Stroke PIDs + probe points
-- PR: 6.0 PSD cranks-no-start canonical seed
-- Platform: ford-super-duty-3rd-gen-60-psd
-- Source: Section 2 + Section 3 of research-input doc
--
-- ~22 properties across ICP sensor, IPR valve, FICM, lift pump, glow plugs,
-- injectors, oil cooler. Battery voltage and cranking RPM are attached to
-- sd3-60psd-ficm (closest proxy — FICM VPWR is the voltage path; PCM RPM
-- arrives at FICM as SYNC signal). Compression and cam/crank attached to
-- sd3-60psd-injectors and sd3-60psd-ficm respectively.
--
-- Column notes (from lib/db/schema.ts):
--   description          NOT NULL — bake in label + expected value + failure interp
--   observation_method   NOT NULL — underscore enum (scan_tool_pid, etc.)
--   housing_opacity_status  nullable
--   source_provenance    NOT NULL — 'FIELD-VERIFIED'
--   inference_class      nullable — NULL or 'LAW'
--   is_retired           boolean NOT NULL default false
--
-- NO expected_reading column on this table (lives on component_pins).
-- FK pattern: SELECT-id-by-slug joins — never hardcode UUIDs.
-- ===========================================================================

-- ─── ICP Sensor (sd3-60psd-icp-sensor) — 3 properties ────────────────────

-- 1. ICP sensor signal voltage
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-icp-volts',
  c.id,
  'ICP sensor signal voltage (0.2–5 V analog output). During cranking, ≥0.80 V is required before the PCM releases the FICM to fire injectors. A reading stuck near 0.2 V during cranking indicates the sensor sees near-zero oil pressure — causes include HPOP failure, STC fitting leak (2004.5+ trucks), standpipe O-ring failure, or oil starvation upstream. A reading pinned near 4.9 V with no engine movement indicates the sensor element has failed electrically high — proceed to ICP sensor unplug test.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-icp-sensor';

-- 2. ICP actual pressure (PCM-computed from sensor voltage)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-icp-psi-actual',
  c.id,
  'ICP actual rail pressure in psi — the PCM converts the raw ICP sensor voltage to a pressure value and exposes it as a scan-tool PID. Cranking minimum: ≥500 psi required for the PCM to enable injector firing. A healthy system reaches 500 psi within 3–5 s of cranking. Plateaus at 250–450 psi with IPR duty climbing to 85% = high-pressure oil leak (STC fitting, standpipes, dummy plugs, injector top O-rings) or HPOP too weak to build pressure. ICP sawtoothing erratically with steady IPR duty = likely HPOP internal damage or aerated oil (oil cooler failure).',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-icp-sensor';

-- 3. ICP desired (PCM commanded target pressure)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-icp-desired',
  c.id,
  'ICP desired (PCM commanded target rail pressure in psi). During cranking the PCM commands a target of approximately 700–800 psi. Comparing ICP desired against ICP actual reveals whether the shortfall is a control problem (desired not commanding high enough — uncommon) or a mechanical problem (system cannot build to desired — common). In a healthy system ICP actual catches up to and tracks ICP desired within a few seconds of cranking.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-icp-sensor';

-- ─── IPR Valve (sd3-60psd-ipr-valve) — 1 property ────────────────────────

-- 4. IPR commanded duty cycle
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ipr-duty',
  c.id,
  'IPR commanded duty cycle (% — 15% = valve fully open / low pressure; 85% = valve fully closed / maximum pressure). At KOEO: ~15% normal (no demand). During cranking: ramps toward 85% as PCM tries to build rail pressure, drops back as ICP climbs and engine starts. Stuck at 85% through entire 10-s crank with ICP never reaching 500 psi = high-pressure leak or HPOP cannot produce pressure (not IPR failure per se). Stuck at 15% (no movement during crank) = IPR control circuit fault or disconnected/failed valve. >30% at warm idle = active leak in high-pressure circuit. CRITICAL: duty cycle is a demand signal from the PCM, NOT a valve-position readback — 85% means the PCM is commanding maximum pressure, not that the valve is mechanically closed.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ipr-valve';

-- ─── FICM (sd3-60psd-ficm) — 6 properties ────────────────────────────────

-- 5. FICM VPWR — vehicle battery feed voltage to FICM
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ficm-vpwr',
  c.id,
  'FICM VPWR — vehicle battery feed voltage supplying the FICM (12 V nominal). Available as a scan-tool PID on Ford IDS/FDRS and some aftermarket tools (Autel, Snap-on) as FICM_VPWR; PID label is not Ford-canonical but widely recognized across scan tools. Should read ≥12.5 V at key-on rest, ≥10.5 V during cranking. FICM_VPWR dropping below 10.5 V at crank indicates battery or cable failure — diagnose with Test 3 (battery voltage during crank) before condemning the FICM. DTC P1368 = FICM supply voltage low.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- 6. FICM LPWR — logic power (separate fuse/circuit)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ficm-lpwr',
  c.id,
  'FICM LPWR — logic-side power supply voltage to the FICM (12 V nominal, sourced from a separate fuse from VPWR). Available as scan-tool PID FICM_LPWR on Ford IDS/FDRS and some aftermarket tools. Should read ≥12.5 V at key-on. A healthy VPWR but absent or low LPWR indicates a blown logic-circuit fuse, not battery weakness. Both VPWR and LPWR must be present for the FICM to function.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- 7. FICM MPWR — injector drive (48 V boosted output)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ficm-mpwr',
  c.id,
  'FICM MPWR — injector drive voltage (48 V boosted output from FICM power-supply board). Normal: 47–49 V at key-on with engine off; must hold ≥45 V during cranking to fire injectors reliably. Available as scan-tool PID FICM_MPWR on Ford IDS/FDRS and some aftermarket tools. Can also be measured directly: remove FICM cover (T20 Torx), probe output pin with DVOM negative on battery negative at key-in-RUN engine-off. Interpretation: 47–49 V = healthy power supply; 36–45 V = degrading power supply (may still start but unreliable); <35 V or 0 V = power supply failed, rebuild or replace FICM. CAUTION: do not let probe slip and short adjacent FICM pins — destroys the FICM.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- 8. FICM MPWR — same signal, measured directly at pin (second observation method)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ficm-mpwr-pin',
  c.id,
  'FICM injector drive voltage measured directly at the FICM output pin with a DVOM (backup method when scan tool does not expose FICM_MPWR PID). Remove FICM cover (T20 Torx), identify the output pin (4-pin FICM: bottom pin closest to driver side; 7-pin FICM: top pin on 4-pin row closest to engine centerline). With DVOM negative on battery negative, probe with key in RUN, engine off. Expected: 47–49 V healthy; same interpretation as sd3-60psd-ficm-mpwr. CAUTION: do not short adjacent pins.',
  'electrical_measurement_at_pin',
  'removable',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- 9. FICM SYNC bit — cam/crank sync signal arriving at FICM
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ficm-sync',
  c.id,
  'FICM_SYNC bit — indicates whether the FICM is receiving a valid cam/crank synchronization signal from the PCM (1 = sync present; 0 = sync absent). During cranking, FICM_SYNC must read 1 for the FICM to enable injector firing. FICM_SYNC = 0 during crank means the engine cannot fire regardless of ICP or FICM voltage. Common causes: rust buildup between CKP sensor face and block increasing air gap, oil migration into CMP harness connector, or CKP/CMP sensor failure. FICM_SYNC = 0 with no DTC is a silent no-start path — often missed without specifically monitoring this PID.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- 10. Battery voltage during crank (FICM VPWR proxy / direct measurement)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-battery-voltage-crank',
  c.id,
  'Battery voltage at battery terminals during cranking (both batteries on this platform). Minimum acceptable: ≥10.5 V (Ford spec: no less than 9.3 V for max 10 s during crank). Voltage sagging below 9.3 V during crank indicates one or both batteries weak, corroded cables, or starter drawing excessive amps. Low crank voltage damages the FICM power-supply board over time and also prevents adequate starter RPM for compression heating. Cranking RPM must reach ≥150–200 RPM for combustion ignition. Measure at battery terminals, not from scan tool, to get unfiltered load-side reading.',
  'electrical_measurement_at_pin',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- 11. Engine cranking RPM (PCM PID via scan tool)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-cranking-rpm',
  c.id,
  'Engine cranking RPM as reported by the PCM from the CKP sensor. Minimum for injector enable: ≥150 RPM (some sources cite 180–200 RPM as the practical threshold for sufficient compression heating on a diesel). Cranking RPM = 0 with known starter operation indicates CKP signal lost at PCM — check FICM_SYNC alongside. Low cranking RPM (<100 RPM) with audible slow crank = battery/cable weakness or starter issue — verify battery voltage during crank before chasing sensors.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- ─── Lift Pump / HFCM (sd3-60psd-lift-pump) — 1 property ─────────────────

-- 12. Fuel pressure at Schrader test port (fuel bowl)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-fuel-pressure-schrader',
  c.id,
  'Fuel pressure at the fuel bowl Schrader test port (driver-side fender-facing side of the engine-top fuel bowl). Ford service info spec and multiple corroborating sources (DieselHub, Bullet Proof Diesel): ≥45 psi all conditions including cranking. UNRESOLVED DISAGREEMENT: Diesel Power Products documents cranking pressure as "about 10–15 psi during cranking and 40–45 psi while running" as normal behavior; both ≥45 psi all-conditions and the 10–15 psi cranking figure are documented across authoritative aftermarket sources — verify against your shop reference before concluding low pressure at crank. <45 psi at key-on prime = lift pump weak, fuel filter restricted, or fuel pickup issue. 0 psi = HFCM not running; check 12 V supply, relay, fuse.',
  'pressure_test_with_gauge',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-lift-pump';

-- ─── Glow Plugs (sd3-60psd-glow-plugs) — 2 properties ────────────────────

-- 13. Glow plug resistance per plug
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-glow-plug-resistance-per-plug',
  c.id,
  'Single glow plug resistance measured at the GPCM harness connector or at the plug terminal with plug disconnected from harness. Normal: 0.5–2.0 Ω cold. Open circuit (infinite resistance or no continuity) = plug failed open — replace that plug. Near-zero resistance (shorted to ground) = plug element internally shorted. A single open plug causes marginal cold starts with white smoke; multiple open plugs cause no-start in cold ambient conditions. Application-critical: 2003/early 2004 glow plugs (pre-9/29/2003 build date) must NOT be installed in late (post-9/29/2003) engines — they contact the piston crown.',
  'electrical_measurement_at_pin',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-glow-plugs';

-- 14. Glow plug current per bank (GPCM relay closure)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-glow-plug-current-per-bank',
  c.id,
  'Total current draw per cylinder bank at GPCM relay closure during glow plug pre-heat cycle. Two distinct readings: initial inrush current ~80 A per bank (measured in the first seconds after relay closure while plugs are cold); steady-state current 10–12 A per individual plug (80–96 A per bank total at steady state — do not conflate these figures). Measure with clamp meter on the GPCM lead wire. All 8 plugs at normal resistance + relay clicks + ~80 A initial draw = glow system healthy. Low draw (e.g., 60 A on a bank that should pull 80 A) = one or more open plugs on that bank — cross-reference with resistance test to isolate which plug.',
  'electrical_measurement_at_pin',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-glow-plugs';

-- ─── HEUI Injectors (sd3-60psd-injectors) — 3 properties ─────────────────

-- 15. Injector balance rates / cylinder contribution
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-injector-balance-rates',
  c.id,
  'Injector balance rates (cylinder contribution) — PCM PID set showing relative fuel delivery per cylinder at KOEO or light-load idle. Available on Ford IDS/FDRS and advanced aftermarket scan tools. Significant imbalance (one or more cylinders reading far from the group average) indicates injector wear, stuck solenoid, or injector cup/O-ring leak affecting that cylinder. On a cranks-no-start case, balance rates are more useful post-start (if engine can be made to start) to identify a misfiring cylinder. All-cylinders-low pattern points to system-wide issue (low ICP, FICM voltage) rather than individual injector fault.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-injectors';

-- 16. Injector audible buzz — bidirectional active test
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-injector-buzz-test',
  c.id,
  'Injector solenoid buzz — audible observation during KOEO bidirectional active test via scan tool. Each injector should produce a distinct buzz/click when commanded on. A cylinder that does not buzz indicates: failed injector solenoid, broken wire in the under-valve-cover injector harness, or FICM logic-side fault (FICM power-supply OK but logic board failed). If FICM voltage is healthy (≥45 V) and multiple injectors fail to buzz, suspect the FICM logic board or the PCM-to-FICM communication path (U-codes).',
  'audible',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-injectors';

-- 17. Cylinder compression per cylinder (via glow plug bore)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-cylinder-compression',
  c.id,
  'Per-cylinder peak compression pressure (psi) measured with diesel compression adapter installed in each glow plug bore. All glow plugs must be removed and batteries fully charged for consistent comparison. Normal: 350–400 psi per cylinder; 375 psi is ideal. Maximum cylinder-to-cylinder deviation: ≤5% ideal, up to 10% tolerable. Single low cylinder: perform wet test (add small amount of motor oil) — pressure jump = worn rings; no change = valve/head gasket/crack. All cylinders low: verify cranking RPM is ≥200 before condemning; may indicate worn engine or starter dragging. Compression test is the last test in the cranks-no-start sequence — run only after high-pressure oil, FICM, glow, and fuel paths are cleared.',
  'pressure_test_with_gauge',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-injectors';

-- ─── Oil Cooler (sd3-60psd-oil-cooler) — 1 property ──────────────────────

-- 18. Oil-to-coolant temperature differential (delta-T)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-oil-cooler-delta-t',
  c.id,
  'Oil-to-coolant temperature differential (°F) — derived by comparing PCM EOT (engine oil temp) and ECT (engine coolant temp) PIDs at steady highway driving conditions (≥20 min highway). Normal: EOT and ECT converge within a few degrees after warmup. Restricted oil cooler: ≥15°F oil-to-coolant delta at steady highway driving indicates the oil cooler is not transferring heat effectively — the cooler core is partially blocked with casting sand or debris. A severely restricted or ruptured oil cooler will cause coolant to contaminate the engine oil (milky appearance on dipstick), aerate the HPOP feed, and cause ICP to collapse. This ΔT reading alone does not confirm rupture — combine with coolant level check and oil milkiness observation.',
  'scan_tool_pid',
  'opaque',
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-oil-cooler';

-- ─── FICM (sd3-60psd-ficm) — cam/crank correlation via scope ──────────────

-- 19. Cam/crank phase correlation (waveform capture)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-cam-crank-correlation',
  c.id,
  'Cam and crank signal phase relationship — captured by lab scope at CKP and CMP sensor outputs during cranking. Normal: consistent phase offset between CMP and CKP waveforms with clean signal edges. CKP signal degraded or absent = air gap too large due to rust on sensor face (CKP is under A/C compressor, passenger side — Ford 3C3Z-6C315-AA); CMP signal absent or contaminated = oil-soaked pigtail connector (CMP is behind power steering pump, driver side). Waveform capture distinguishes marginal signal degradation (not yet failed enough to set a code) from clean signal. FICM_SYNC = 0 on scan tool with clean-looking waveforms points to a communication issue between PCM and FICM rather than a sensor fault.',
  'waveform_capture',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ficm';

-- ─── IPR Valve (sd3-60psd-ipr-valve) — air-test audible leak ──────────────

-- 20. HP oil system audible leak during air test (via IPR port)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-hpo-air-leak-audible',
  c.id,
  'Audible air leak from the high-pressure oil system during an air (puff) test: IPR valve is removed, an air-test fitting is installed in the IPR port, and shop air at 100–150 psi is applied with engine off. Listen at multiple points. Loud air from valve cover area = standpipe O-rings or dummy plug O-rings. Loud air from rear of engine (behind turbo) = STC fitting leak or branch tube (2004.5+ trucks). Air escaping into crankcase (audible at oil fill cap or PCV breather with no upper noise) = injector body O-ring(s) leaking into combustion or push-tube area. Air back-flowing through HPOP (audible at oil filter housing drain valve when held open at 150–200 psi) = HPOP internal damage. This test requires removing the IPR valve — do not confuse with the ICP sensor location.',
  'audible',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-ipr-valve';

-- ─── HPOP (sd3-60psd-hpop) — HPOP back-flow observation ──────────────────

-- 21. HPOP back-flow check (direct visual/audible during air test)
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-hpop-backflow',
  c.id,
  'HPOP back-flow — audible/visual observation during high-pressure air test at 150–200 psi. With shop air applied at IPR port and the oil filter housing drain valve held open, air back-flowing through the pump into the oil sump is audible as gurgling or bubbling at the drain valve. Per diagnostic procedure: "This is not possible with a healthy HPOP" — air cannot flow backward through the pump in normal operation. Positive finding (air flowing backward) is a strong HPOP condemnation indicator. Conduct this check AFTER ruling out STC fitting, standpipe, and injector O-ring leaks via the air test, since those external leaks must be absent for this back-flow test to be interpretable.',
  'audible',
  'opaque',
  'FIELD-VERIFIED',
  'LAW',
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-hpop';

-- 22. HFCM audible prime — lift pump activation at key-on
INSERT INTO observable_properties (
  slug, component_id, description, observation_method,
  housing_opacity_status, source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-lift-pump-audible',
  c.id,
  'Lift pump (HFCM) audible prime cycle — at key-on (engine off), the HFCM electric pump should run for approximately 2–3 seconds, audible from outside the vehicle or under the driver-side frame rail. Absence of this sound indicates pump motor failure, blown fuse, failed relay, or broken wiring before the pump — any of which will result in 0 psi at the fuel bowl Schrader port. Audible prime does not guarantee adequate pressure; always confirm with a gauge test (see sd3-60psd-fuel-pressure-schrader) if a fuel-side fault is suspected.',
  'audible',
  'opaque',
  'FIELD-VERIFIED',
  NULL,
  false
FROM components c
JOIN platforms p ON p.id = c.platform_id
WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.slug = 'sd3-60psd-lift-pump';
