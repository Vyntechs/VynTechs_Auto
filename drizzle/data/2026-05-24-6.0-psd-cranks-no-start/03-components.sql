-- ===========================================================================
-- Batch 3: components — 6.0L Power Stroke HEUI system (2003-2007)
-- PR: 6.0 PSD cranks-no-start canonical seed
-- Platform: ford-super-duty-3rd-gen-60-psd
-- Source: Section 2 of 2026-05-24-6.0-psd-cranks-no-start-research-input.md
--
-- 14 components exactly (matches the 14 rows in Section 2 of research input).
-- Standpipes are seeded as one component row (sd3-60psd-standpipes) because
-- Section 2 lists "Standpipes (front + rear, one per bank)" as a single entry.
--
-- Slug format:  sd3-60psd-<component>
-- FK pattern:   SELECT-id-by-slug (never hardcode UUIDs)
-- Column names: name, kind, systems (text[]), function, body, source_provenance
--               Per Amendment 3: no display_name, no system (singular),
--               no primary_function, no common_failure_mode (→ body instead)
-- ===========================================================================

-- 1. HPOP (High-Pressure Oil Pump)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-hpop',
  p.id,
  'High-Pressure Oil Pump (HPOP)',
  'pump',
  ARRAY['high-pressure-oil-injection'],
  'Engine valley, rear of engine, beneath turbocharger; camshaft-gear-driven',
  'Pressurizes engine oil to drive HEUI injectors; rail pressure 500–3,000 psi range',
  '2003–early 2004: aluminum swash-plate pump with known internal failure mode (common condemn). 2004.5–2007: cast-iron gear pump internally more durable — rarely fails on its own; frequently blamed when the STC fitting is the actual leak source. Diagnostic implication: condemning the HPOP on 2005+ trucks without first ruling out STC fitting, standpipes, and dummy plugs is a known expensive mistake. Turbo removal is required to access the HPOP on all year variants.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 2. STC Fitting (Snap-To-Connect) — 2004.5–2007 late-rail trucks only
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-stc-fitting',
  p.id,
  'STC Fitting (Snap-To-Connect)',
  'mechanical',
  ARRAY['high-pressure-oil-injection'],
  'HPOP discharge to branch tube, rear of engine under HPOP cover; 2004.5–2007 late-rail trucks only',
  'Couples HPOP high-pressure outlet to the branch tube that distributes oil to both cylinder bank standpipes',
  '2004.5–2007 late-rail trucks only — not present on early 2003–early 2004 log-rail trucks. The two-piece snap coupler flexes under vibration and heat; its internal seal degrades progressively. Failure mode is progressive: starts as hot-restart trouble (ICP builds but slowly), degrades to intermittent no-start, eventually blows apart completely. A leaking STC fitting on a 2005–07 truck is the most common reason the cast-iron gear HPOP is incorrectly condemned. No direct PID reading — diagnosed by air test and hot-restart pattern matching.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 3. Standpipes (front + rear, one per bank)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-standpipes',
  p.id,
  'Standpipes (front + rear, one per cylinder bank)',
  'mechanical',
  ARRAY['high-pressure-oil-injection'],
  'Threaded into each cylinder head, under each valve cover; one passenger-bank (front) standpipe and one driver-bank (rear) standpipe',
  'Pipe high-pressure oil from the branch tube into the oil rail that runs the length of each cylinder head',
  'Each standpipe uses an O-ring seal where it threads into the cylinder head. The O-rings are known to flatten and tear with age and heat cycling, creating audible high-pressure oil leaks under valve covers during an air (puff) test. Standpipe failure causes ICP to plateau below 500 psi during cranking with IPR duty climbing to 85%. Replacement requires valve cover removal and typically bundles with dummy plug O-ring service.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 4. Dummy Plugs (one per bank)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-dummy-plugs',
  p.id,
  'Dummy Plugs (high-pressure oil rail end caps)',
  'mechanical',
  ARRAY['high-pressure-oil-injection'],
  'Far end of each oil rail (passenger bank + driver bank), under valve covers',
  'Seal the downstream end of each high-pressure oil rail to maintain rail pressure',
  'Dummy plugs use the same O-ring family as standpipes. O-ring failure creates high-pressure oil leaks at the far end of each oil rail under the valve covers. Typically serviced at the same time as standpipes during valve cover work. No direct PID reading — diagnosed by audible leak during air (puff) test in the valve cover area.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 5. ICP Sensor (Injection Control Pressure sensor)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-icp-sensor',
  p.id,
  'ICP Sensor (Injection Control Pressure)',
  'sensor',
  ARRAY['high-pressure-oil-injection'],
  '2003–early 2004: rear of engine behind turbo, on HPOP cover (difficult access). 2004.5–2007: passenger-side valve cover near GPCM (easy access)',
  'Reports actual high-pressure oil rail pressure to the PCM as a 0.2–5 V analog signal; three-wire variable-capacitance sensor',
  'Cranking signal voltage must reach ≥0.80 V (≥500 psi) for the PCM to release the FICM to fire injectors. Common DTCs: P2285 (circuit low), P2287 (intermittent), P2291 (ICP too low during cranking — actual system cannot build pressure). CRITICAL DISTINCTION: unplugging the ICP sensor forces the PCM to substitute ~750 psi as its inferred rail pressure, which may allow the engine to start if the sensor itself is faulty. This is NOT the same as unplugging the IPR valve — see sd3-60psd-ipr-valve. Oil contamination of the pigtail connector is a common ICP sensor wiring failure.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 6. IPR Valve (Injection Pressure Regulator)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ipr-valve',
  p.id,
  'IPR Valve (Injection Pressure Regulator)',
  'valve',
  ARRAY['high-pressure-oil-injection'],
  'Threaded into HPOP cover plate, rear of engine beneath turbo up-pipe collector; connector points upward toward hood',
  'Regulates high-pressure oil rail pressure by bleeding excess HPOP discharge back to drain; PCM modulates duty cycle (15% = fully open/low pressure, 85% = fully closed/maximum pressure)',
  'CRITICAL DISTINCTION: unplugging the IPR valve sends it to its mechanical default (fully open), which guarantees no rail pressure builds — the engine will not start. This is NOT the same as unplugging the ICP sensor. The internal screen in the IPR inlet can clog with debris; heat-damaged connector is also a failure mode. IPR duty cycle > 30% at warm idle indicates a high-pressure circuit leak. IPR duty stuck at 85% with ICP never reaching 500 psi = system cannot build pressure (leak or HPOP failure, not IPR failure per se).',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 7. FICM (Fuel Injection Control Module)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-ficm',
  p.id,
  'FICM (Fuel Injection Control Module)',
  'module',
  ARRAY['high-pressure-oil-injection', 'fuel-injection-control'],
  'Driver-side valve cover area, beneath the coolant degas bottle',
  'Generates 48 V, 20 A pulse to fire each injector solenoid, releasing high-pressure oil into the intensifier piston; also receives engine sync signal from PCM',
  'FICM output must remain ≥45 V during cranking; 47–49 V is normal at key-on. < 45 V causes injectors to misfire; < 35 V or 0 V = power supply failed. Power-supply board failure is the most common FICM failure mode, triggered by prolonged low-battery voltage events (e.g., weak batteries, jump-start abuse). Classic DTC signature: P0611 + all eight injector circuit lows (P0261/P0264/P0267/P0270/P0273/P0276/P0279/P0282). FICM_SYNC = 0 during crank means the PCM/CKP sync signal is not reaching the FICM — separate from power supply failure.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 8. GPCM (Glow Plug Control Module)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-gpcm',
  p.id,
  'GPCM (Glow Plug Control Module)',
  'module',
  ARRAY['glow-plug'],
  'Passenger-side valve cover (late 2004+); aluminum housing with two large connectors (one black = even cylinders, one green = odd cylinders)',
  'Cycles 12 V to each individual glow plug under PCM command; pre-heat cycle duration 0–120 s depending on ambient temperature',
  'GPCM connector mapping per forum consensus (no verified Ford manual source): black connector = even-numbered cylinders, green connector = odd-numbered cylinders. Module-internal fault and harness chafing are known failure modes. GPCM failure can cause cold hard-start or no-start with white smoke during crank. Compatible glow plug application is year-critical: 2003/early 2004 glow plugs CANNOT be used in late 2004+ engines (hits piston); engine build date cutoff is 9/29/2003.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 9. Glow Plugs (8x, ceramic-tip)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-glow-plugs',
  p.id,
  'Glow Plugs (8x)',
  'actuator',
  ARRAY['glow-plug'],
  'Threaded into each cylinder head (one per combustion chamber, 8 total)',
  'Resistive heaters that warm each combustion chamber for cold-start ignition; activated by GPCM under PCM command',
  'Normal resistance: 0.5–2.0 Ω per plug. Normal current draw: 10–12 A per plug steady-state; ~80 A per bank initial inrush. Open-circuit failure (one or more plugs) is the most common fault. A single open plug causes marginal cold starts; multiple open plugs cause white smoke during crank and no-start in cold ambient conditions. Application critical: early (pre-9/29/2003 build date) glow plugs must NOT be installed in late (post-9/29/2003) engines.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 10. Lift Pump / HFCM (Horizontal Fuel Conditioning Module)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-lift-pump',
  p.id,
  'Lift Pump / HFCM (Horizontal Fuel Conditioning Module)',
  'pump',
  ARRAY['fuel'],
  'Frame-mounted, electric; integrates primary fuel filter, water separator, and lift pump into one assembly',
  'Delivers low-pressure fuel from tank to the engine-top fuel bowl; primes at key-on and maintains ≥45 psi supply to the fuel bowl under all conditions',
  'HFCM should be audible for 2–3 s at key-on (prime cycle). Loss of prime noise indicates pump motor failure, relay failure, fuse failure, or wiring issue. The HFCM also contains the primary fuel filter and water separator — a water-in-fuel (WIF) warning requires draining the water separator before further diagnosis. Pump failure causes 0 psi at the fuel bowl Schrader port.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 11. Fuel Filters (primary + secondary)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-fuel-filters',
  p.id,
  'Fuel Filters (primary in HFCM + secondary in engine-top fuel bowl)',
  'mechanical',
  ARRAY['fuel'],
  'Primary filter: inside HFCM frame-mounted assembly. Secondary filter: engine-top fuel bowl, driver-side fender area',
  'Filter diesel fuel before delivery to the HEUI injectors; primary filter is the coarser upstream stage, secondary filter is the finer downstream stage',
  'Restricted or water-saturated filters reduce lift pump delivery pressure below 45 psi, causing lean or no-start conditions. The secondary filter in the fuel bowl also houses the Schrader test port used for low-pressure fuel testing. Service interval is typically 10,000–15,000 miles; more frequent in areas with low-quality fuel. Water saturation is diagnosed by the WIF (water-in-fuel) warning lamp; drain the water separator before condemning the pump.',
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 12. HEUI Injectors (8x) — oil side
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-injectors',
  p.id,
  'HEUI Injectors (8x)',
  'actuator',
  ARRAY['high-pressure-oil-injection', 'fuel-injection-control'],
  'One per cylinder, under each valve cover; top of injector interfaces with oil rail, lower end interfaces with fuel rail',
  'Convert high-pressure oil (≥500 psi) acting on the intensifier piston into a fuel injection pulse; oil-to-fuel pressure amplification ratio is approximately 7:1',
  'Upper square O-ring seals the high-pressure oil inlet at the top of the injector; when this O-ring leaks, high-pressure oil escapes into the valve cover area instead of driving the intensifier piston, causing low ICP that worsens as the engine warms (oil becomes thinner). This is a primary #1 cause of hot-restart no-start on aging 6.0 PSDs. Lower O-rings seal the fuel side (fuel leaks down rather than up). Bidirectional injector buzz test via scan tool verifies injector solenoid function. Injector body O-ring leaks are diagnosed by air escaping into the crankcase (oil fill / PCV breather) during the air (puff) test.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 13. Oil Cooler (engine oil cooler)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-oil-cooler',
  p.id,
  'Oil Cooler (engine oil cooler)',
  'mechanical',
  ARRAY['cooling', 'high-pressure-oil-injection'],
  'Engine valley, between coolant galleries and engine oil galleries; coolant flow through the oil cooler feeds the downstream EGR cooler',
  'Transfers heat from engine oil into the coolant circuit to maintain oil temperature; sits upstream of EGR cooler coolant flow',
  'The oil cooler is a common 6.0 PSD failure point. Casting sand accumulates in the cooler core over time, restricting coolant flow. The oil cooler ΔT heuristic: ≥15°F oil-to-coolant temperature difference at steady highway driving indicates a restricted or failing cooler. When the oil cooler plugs completely and ruptures, coolant enters the engine oil galleries, aerates the HPOP feed oil, and causes ICP to collapse — the HPOP cannot pump aerated oil effectively. The EGR cooler receives its coolant supply downstream of the oil cooler; when oil cooler flow is restricted the EGR cooler overheats and ruptures. Treat oil cooler failure as the root cause when ICP cannot build AND oil is milky or coolant level is dropping.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- 14. EGR Cooler (exhaust gas recirculation cooler)
INSERT INTO components (
  slug, platform_id, name, kind, systems, location, function, body,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-egr-cooler',
  p.id,
  'EGR Cooler (exhaust gas recirculation cooler)',
  'mechanical',
  ARRAY['exhaust-gas-recirculation', 'cooling'],
  'Top of engine, integrated with intake manifold area; coolant supply from oil cooler downstream',
  'Cools exhaust gas with coolant before recirculation into the intake manifold; reduces NOx emissions',
  'EGR cooler failure is almost always a downstream consequence of oil cooler failure on the 6.0 PSD. When oil cooler restricts coolant flow to the EGR cooler, the EGR cooler overheats and cracks internally, dumping coolant into the intake manifold and combustion chambers. Symptoms: white smoke from exhaust, rapid coolant loss, coolant in intake manifold, hydrolock risk. No direct PID for EGR cooler integrity — diagnose by bubble/pressure test of the cooling system or by physical inspection after intake manifold removal. Treat EGR cooler failure as a consequence; always address the oil cooler root cause simultaneously.',
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';
