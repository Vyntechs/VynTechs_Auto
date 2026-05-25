-- ===========================================================================
-- Batch 6: branch_logic — decision tree + failure-pattern entry points
-- PR: 6.0 PSD cranks-no-start canonical seed
-- Platform: ford-super-duty-3rd-gen-60-psd
-- Source: Section 4 (decision tree) + Section 5 (9 failure patterns) of
--         2026-05-24-6.0-psd-cranks-no-start-research-input.md
--
-- Structure (per Amendment 4):
--   Part A — ~25 decision-tree edges from Section 4, anchored to the
--             test_action that produced the observation.
--   Part B — 9 failure-pattern entry points hanging off pull-all-dtcs;
--             pattern narrative stored in reasoning (symptom_test_implications
--             is a pure junction table with no free-text column).
--
-- Column notes (from lib/db/schema.ts + Amendments 3, 4):
--   test_action_id           FK to test_actions (NOT from_test_action_id)
--   condition                NOT NULL — observation that triggers this edge
--   verdict                  enum: 'ok' | 'warn' | 'fail' | 'impossible'
--   next_action              NOT NULL — what to do next (prose or terminal dx)
--   routes_to_test_action_id FK, nullable — next test if not terminal
--   reasoning                nullable text — pattern context + narrative (Amendment 4)
--   source_provenance        'FIELD-VERIFIED'
--   inference_class          'LOGIC' for decision-tree edges, 'PATTERN' for
--                            pattern entry points
--   is_retired               false
--
-- FACT-CHECK CORRECTION (per plan header + Amendment 4):
--   Pattern 1 (hot-restart progressively worse): #1 candidate is injector
--   top O-rings, NOT STC fitting. STC is secondary. The "99% of the time"
--   quote from research input Section 5 belongs to injector O-rings, not STC.
-- ===========================================================================

-- ===========================================================================
-- PART A — Decision-tree edges from Section 4 (~25 rows)
-- ===========================================================================

-- ─── From: pull-all-dtcs ────────────────────────────────────────────────────

-- Edge A1: No codes → proceed to battery + FICM checks
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-dtcs-no-codes',
  ta.id,
  'No DTCs stored or pending across PCM, FICM, or GPCM',
  'ok',
  'No codes — proceed to battery voltage check under crank, then FICM voltage check.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-battery-crank' AND is_retired = false),
  'Clean DTC scan rules out the easy electronic faults. Battery and FICM voltage are the next cheap, non-invasive checks before touching anything mechanical.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Edge A2: P0611 + all eight injector circuit lows → FICM power supply failed
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-dtcs-ficm-injector-lows',
  ta.id,
  'P0611 present plus one or more of P0261/P0264/P0267/P0270/P0273/P0276/P0279/P0282 (injector circuit low codes)',
  'fail',
  'Classic FICM power supply failure signature. The FICM is not producing the 48 V injector-drive output. Proceed to FICM voltage check to confirm.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-ficm-voltage' AND is_retired = false),
  'P0611 plus all eight injector circuit lows is the textbook FICM power-supply board failure pattern. The 48 V boost circuit in the FICM has failed; individual injectors are not commanded because the drive voltage is absent.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Edge A3: P2291 (ICP too low during cranking) → route to ICP live read
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-dtcs-p2291',
  ta.id,
  'P2291 present — ICP too low during cranking',
  'warn',
  'P2291 confirms the PCM saw ICP below its minimum threshold during crank. Proceed to ICP live read to observe peak cranking pressure and IPR duty cycle.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-icp-live-read' AND is_retired = false),
  'P2291 is set when the PCM cannot achieve the minimum ICP for injection during a crank event. This points to the high-pressure oil side — leak, weak HPOP, or air in the system. ICP live read quantifies how far short the system is.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Edge A4: P2285/P2287 (ICP sensor circuit codes) → route to ICP live read
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-dtcs-icp-sensor-circuit',
  ta.id,
  'P2285 (ICP circuit low) or P2287 (ICP intermittent) present',
  'warn',
  'ICP sensor or wiring circuit fault. This does not necessarily mean actual rail pressure is low — the sensor may be lying. Proceed to ICP live read, then consider sensor unplug test if ICP_VOLTS looks stuck.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-icp-live-read' AND is_retired = false),
  'P2285/P2287 indicates the PCM detected an out-of-range or intermittent ICP signal. Oil contamination of the ICP pigtail connector is a very common cause on aging 6.0 PSDs. The sensor may read falsely low while actual rail pressure is fine — or both sensor and pressure may be low.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Edge A5: P1368 (FICM supply voltage low) → route to FICM voltage check
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-dtcs-p1368-ficm-low-supply',
  ta.id,
  'P1368 present — FICM supply voltage low',
  'warn',
  'FICM is reporting its supply voltage is below threshold. Check battery condition first before condemning the FICM — weak batteries cause this code and the FICM itself may be fine.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-battery-crank' AND is_retired = false),
  'P1368 is set by the FICM when its 12 V supply drops below the acceptable threshold. This can be caused by weak batteries pulling the bus voltage down during cranking — rule out batteries first. Only if batteries are confirmed good should the FICM itself be suspected.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Edge A6: P0671-P0678 (glow plug DTCs) → route to glow plug resistance test
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-dtcs-glow-plug-family',
  ta.id,
  'P0671, P0672, P0673, P0674, P0675, P0676, P0677, or P0678 present (glow plug circuit fault on any cylinder)',
  'warn',
  'Glow plug circuit fault on indicated cylinder(s). Start with glow plug resistance test. Note: this may or may not be the no-start root cause — rule it out alongside ICP and fuel path checks.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-glow-plug-resistance' AND is_retired = false),
  'P067x codes indicate the GPCM detected an open or out-of-range glow plug circuit. Cold-start no-fire with white smoke and otherwise healthy ICP and FICM voltage strongly implicates the glow plug system. However, on a warm engine the glow plugs are less critical — do not over-chase this code if ICP is also low.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- ─── From: battery-crank ────────────────────────────────────────────────────

-- Edge A7: Crank voltage ≥10 V → batteries OK, proceed to FICM voltage
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-battery-crank-ok',
  ta.id,
  'Crank voltage holds >=10 V at battery posts; starter spins engine at >=180 RPM',
  'ok',
  'Battery and starter system healthy — not the no-start cause. Proceed to FICM voltage check.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-ficm-voltage' AND is_retired = false),
  'Confirmed adequate electrical supply. The FICM is the next cheap, non-invasive test before moving to the high-pressure oil system.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-battery-crank' AND ta.is_retired = false;

-- Edge A8: Crank voltage sags below 9.3 V → batteries or cables
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-battery-crank-fail-low-voltage',
  ta.id,
  'Crank voltage sags below 9.3 V at battery posts during cranking',
  'fail',
  'Batteries or cables are the root cause. Load test each battery individually; inspect cable ends and grounds for resistance. Weak batteries will also damage the FICM — do not overlook this step.',
  NULL,
  'Ford spec is no less than 9.3 V for 10 s during crank. Sag below this damages the FICM boost circuit over time and prevents proper compression heating from starter speed.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-battery-crank' AND ta.is_retired = false;

-- Edge A9: Extremely slow crank / no crank → batteries or mechanical lock
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-battery-crank-fail-no-crank',
  ta.id,
  'Engine cranks extremely slowly (<<180 RPM) or will not crank at all; voltage collapses below 9 V',
  'fail',
  'One or both batteries failed, corroded battery cables, or starter drawing excessive amps. Rare: engine mechanically locked — consider EGR cooler hydrolock (compression test if batteries confirmed good and starter is not the cause).',
  NULL,
  'Pattern 5 from Section 5: extremely slow crank with voltage sag. #1 cause is battery failure; #2 corroded cables; #3 excessive starter amp draw; #4 rare hydrolock from EGR cooler rupture.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-battery-crank' AND ta.is_retired = false;

-- ─── From: ficm-voltage ──────────────────────────────────────────────────────

-- Edge A10: FICM_MPWR >=45 V → FICM healthy, proceed to ICP live read
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ficm-voltage-ok',
  ta.id,
  'FICM_MPWR reads 45-49 V (>=45 V at key-on and during crank); FICM_VPWR and FICM_LPWR both >10.5 V',
  'ok',
  'FICM voltage is healthy — not the no-start cause. Proceed to ICP live read during cranking.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-icp-live-read' AND is_retired = false),
  'FICM confirmed producing adequate injector-drive voltage. The no-start must be on the high-pressure oil side, fuel side, or glow plug system.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ficm-voltage' AND ta.is_retired = false;

-- Edge A11: FICM_MPWR < 45 V (failing/failed power supply)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ficm-voltage-fail-low',
  ta.id,
  'FICM_MPWR reads < 45 V during key-on or crank; or manual DVOM probe on FICM output reads < 45 V',
  'fail',
  'FICM power supply failed or failing — the boost circuit is not producing adequate 48 V injector-drive output. Rebuild or replace the FICM. Verify batteries are not the underlying cause first (P1368 + low battery voltage at crank = batteries, not FICM).',
  NULL,
  'Values 36-44 V indicate a degrading FICM power supply that is still marginally functional. Values <35 V or 0 V indicate complete power-supply board failure. The most common cause is repeated low-battery events cycling the FICM through wide voltage swings.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ficm-voltage' AND ta.is_retired = false;

-- Edge A12: FICM_VPWR or FICM_LPWR < 10.5 V → battery/harness feed issue
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ficm-voltage-fail-vpwr-low',
  ta.id,
  'FICM_VPWR or FICM_LPWR reads < 10.5 V (12 V supply side low)',
  'fail',
  'FICM is not receiving adequate 12 V supply. Check the FICM battery feed fuse, the 12 V harness connector to the FICM, and battery cables. The FICM itself may be fine — rule out the supply first.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-battery-crank' AND is_retired = false),
  'A low VPWR or LPWR reading on the FICM 12 V supply side indicates a supply-side problem rather than an internal FICM failure. The FICM boost circuit cannot operate without a clean 12 V input.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ficm-voltage' AND ta.is_retired = false;

-- ─── From: icp-live-read ─────────────────────────────────────────────────────

-- Edge A13: ICP rises to >=500 psi and engine starts → high-pressure oil OK
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-icp-live-read-ok',
  ta.id,
  'ICP rises smoothly to >=500 psi within ~3-5 s of cranking; engine starts or fires',
  'ok',
  'High-pressure oil system is healthy — ICP met the minimum threshold for injector firing. If engine still does not start despite ICP being adequate, proceed to IPR duty cycle check to verify the control loop, then glow plug and cam/crank sync.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-ipr-duty-cycle' AND is_retired = false),
  'ICP >=500 psi and engine firing confirms the HPOP is producing adequate pressure and there are no major high-pressure-side leaks. The no-start must be on the glow plug, fuel, or sync path.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-icp-live-read' AND ta.is_retired = false;

-- Edge A14: ICP plateaus 250-450 psi with IPR at 85% → leak or HPOP weak
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-icp-live-read-fail-plateau',
  ta.id,
  'ICP rises but plateaus at 250-450 psi during 10 s crank; IPR_DUTY climbs to 85%; engine does not start',
  'fail',
  'High-pressure oil system cannot build sufficient pressure. The PCM is demanding full pressure (IPR at 85%) but the system cannot deliver it. Proceed to air/puff test to locate the leak source.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'IPR at 85% means the PCM is commanding maximum rail pressure but not achieving it. Typical causes: STC fitting leak (2004.5-2007 trucks), standpipe O-rings, injector top O-rings, dummy plug O-rings, or weak HPOP (especially aluminum swash-plate on 2003-2004 trucks). Air test localizes the leak.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-icp-live-read' AND ta.is_retired = false;

-- Edge A15: ICP_VOLTS stuck <=0.2 V or >=4.5 V → sensor electrical fault
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-icp-live-read-warn-sensor-stuck',
  ta.id,
  'ICP_VOLTS stuck at <=0.2 V (shorted low) or >=4.5 V (shorted high) with no movement during crank',
  'warn',
  'ICP sensor electrical fault — not necessarily low actual rail pressure. The sensor may be reading falsely. Proceed to ICP sensor unplug test to determine if the sensor is the failure point.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-icp-sensor-unplug' AND is_retired = false),
  'A stuck ICP_VOLTS signal with no movement during crank indicates a sensor or wiring fault rather than a pressure fault. Oil contamination of the pigtail connector is a very common cause on aging 6.0 PSDs. The sensor unplug test bypasses the sensor and determines if the actual system can build pressure.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-icp-live-read' AND ta.is_retired = false;

-- Edge A16: ICP sawtooths erratically while IPR steady → HPOP internal damage or air in feed
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-icp-live-read-warn-erratic',
  ta.id,
  'ICP actual sawtooths or spikes erratically while IPR_DUTY is relatively steady during crank',
  'warn',
  'Likely HPOP internal damage or air in the HPOP suction feed. Air in the HPOP suction causes it to cavitate — output is erratic rather than smoothly rising. Check for aerated oil (milky oil, coolant loss, oil cooler rupture) before condemning the HPOP itself.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'Erratic ICP with steady IPR duty-cycle demand rules out the control loop as the cause. The erratic output points to the pump itself cavitating or an air pocket in the high-pressure circuit. Oil cooler rupture can introduce coolant into the oil, aerating the HPOP feed — check for milky oil.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-icp-live-read' AND ta.is_retired = false;

-- ─── From: ipr-duty-cycle ────────────────────────────────────────────────────

-- Edge A17: IPR normal crank ramp + ICP reaches 500 psi → control loop healthy
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ipr-duty-ok',
  ta.id,
  'IPR_DUTY ramps to ~85% during crank then drops back as ICP climbs; ICP reaches >=500 psi; engine starts',
  'ok',
  'IPR control loop healthy and ICP confirmed adequate. If engine still fails to fire despite this, move to glow plug system and cam/crank correlation checks.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-glow-plug-resistance' AND is_retired = false),
  'The normal crank pattern is IPR duty ramping up then relaxing as rail pressure builds. This edge confirms both the sensor and actuator sides of the high-pressure oil loop are working.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ipr-duty-cycle' AND ta.is_retired = false;

-- Edge A18: IPR stuck at 85% through full crank with ICP never reaching 500 psi → leak or HPOP
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ipr-duty-fail-stuck-high',
  ta.id,
  'IPR_DUTY stuck at or near 85% through entire crank event; ICP never reaches 500 psi',
  'fail',
  'PCM is commanding maximum pressure but the system cannot build it. High-pressure oil leak or HPOP cannot generate adequate flow. Proceed to air/puff test to isolate the leak source.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'Caveat: "85% IPR duty cycle ONLY means actual ICP is less than desired ICP. You have NO WAY of knowing what the valve is or is not actually doing." Treat the 85% as a demand signal — the system is not delivering what the PCM is asking for. Air test localizes whether the fault is a leak or HPOP output.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ipr-duty-cycle' AND ta.is_retired = false;

-- Edge A19: IPR stuck at 15% (no movement) → IPR control fault
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ipr-duty-warn-stuck-low',
  ta.id,
  'IPR_DUTY reads 15% at KOEO and does not increase during crank (no movement)',
  'warn',
  'IPR valve not being commanded closed — the PCM is not ramping duty cycle to build pressure. Check IPR valve connector and harness; the valve may be disconnected, failed, or the PCM output circuit may be open.',
  NULL,
  'A stuck-at-15% IPR duty cycle means the PCM is not commanding the valve to close and build pressure. The IPR at 15% is fully open (maximum bleed-off) — no pressure can build. This is different from a mechanical leak; the control signal is absent.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ipr-duty-cycle' AND ta.is_retired = false;

-- Edge A20: IPR >30% at warm idle → leak in the high-pressure circuit
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-ipr-duty-warn-high-idle',
  ta.id,
  'IPR_DUTY reads >30% at warm idle (engine running)',
  'warn',
  'High IPR duty at idle indicates a leak in the high-pressure circuit — the PCM must continuously command more pressure to compensate for what is leaking away. Proceed to air/puff test while warm to locate the leak.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'Normal warm idle should be <30% IPR duty. Elevated duty cycle at idle means the system is losing pressure faster than normal. This often presents as an intermittent hard-start that worsens as the engine accumulates heat cycles.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-ipr-duty-cycle' AND ta.is_retired = false;

-- ─── From: air-puff ──────────────────────────────────────────────────────────

-- Edge A21: Audible leak from valve cover area → standpipes or dummy plugs
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-air-puff-fail-valve-cover',
  ta.id,
  'Audible air leak from valve cover area (oil fill cap, valve cover gasket line, or around standpipe locations)',
  'fail',
  'Standpipe O-ring(s) or dummy plug O-ring(s) leaking. Replace standpipes and dummy plugs with updated O-rings. Torque: 33 ft-lb on 2003-early 2004 log-rail trucks; 60 ft-lb on late 2004-2007 wavy-rail trucks (year-split — verify before torquing).',
  NULL,
  'Air exiting through the valve cover area with shop air injected at the IPR port localizes the leak to the standpipes or dummy plugs — both of which feed the oil rail under the valve cover. The O-rings on these components are a known wear item.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-air-puff' AND ta.is_retired = false;

-- Edge A22: Audible leak at rear of engine (behind turbo) → STC fitting (2004.5+ only)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-air-puff-fail-stc',
  ta.id,
  'Audible air leak at rear of engine, behind turbo area, near HPOP cover — 2004.5-2007 trucks only',
  'fail',
  'STC fitting leak (2004.5-2007 trucks only — the STC quick-connect fitting between HPOP discharge and branch tube). Replace STC fitting with updated design. Note: this fitting does not exist on 2003-early 2004 log-rail trucks.',
  NULL,
  'The STC (snap-to-connect) fitting is present only on 2004.5-2007 wavy-rail trucks. Its internal seal fatigues under vibration and high pressure, eventually leaking or blowing apart. On 2003-early 2004 trucks, a leak at the rear of the engine points to the HPOP outlet fitting or branch tube instead.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-air-puff' AND ta.is_retired = false;

-- Edge A23: Air in crankcase with no upper noise → injector top O-rings
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-air-puff-fail-injector-orings',
  ta.id,
  'Air heard in crankcase via oil fill cap or breather; no audible upper leak at valve cover or rear of engine',
  'fail',
  'Injector top O-ring(s) leaking into the combustion chamber or push-tube area — oil-side high-pressure air is bypassing the injector top seals and escaping to crankcase. Replace injectors or rebuild with updated O-ring kits. Often multiple injectors affected on high-mileage engines.',
  NULL,
  'When air exits at the crankcase (oil fill or breather) without audible upper leaks, the path goes through the injector top O-rings into the combustion chambers and down past the rings into the crankcase. This is the most common high-mileage 6.0 PSD leak source.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-air-puff' AND ta.is_retired = false;

-- Edge A24: Back-flow / gurgling through HPOP at high pressure → HPOP internal failure
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-air-puff-fail-hpop-backflow',
  ta.id,
  'Audible back-flow or gurgling at oil filter housing drain valve (held open) when shop air injected at IPR port at 150-200 psi',
  'fail',
  'Air flowing backward through the HPOP — this is not possible with a healthy HPOP. Strong indication of HPOP internal failure (failed check valve or internal bypass). Replace HPOP.',
  NULL,
  'A healthy HPOP has internal check valves that prevent reverse flow. If air injected at the IPR port exits through the HPOP suction side at the oil filter drain, those internal check valves have failed. On 2003-2004 trucks this is typically aluminum swash-plate failure; on 2005-2007 trucks HPOP internal failure is rare — confirm STC and standpipes are eliminated first.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-air-puff' AND ta.is_retired = false;

-- ─── From: icp-sensor-unplug ─────────────────────────────────────────────────

-- Edge A25: Engine starts with sensor unplugged → sensor/pigtail is the fault
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-icp-unplug-starts',
  ta.id,
  'Engine starts and runs after ICP sensor is unplugged; would not start with sensor connected',
  'fail',
  'ICP sensor or pigtail connector is the fault. Replace the ICP sensor and the pigtail connector together — oil contamination of the pigtail is the most common cause and the pigtail is inexpensive insurance.',
  NULL,
  'When unplugging the ICP sensor allows the engine to start, the PCM''s substituted default pressure value is sufficient to fire the injectors but the sensor''s reported value was not. The sensor is sending a false-low signal. The pigtail connector is a frequent failure point on aging 6.0 PSDs due to oil contamination.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-icp-sensor-unplug' AND ta.is_retired = false;

-- Edge A26: No change with sensor unplugged → sensor not the limiting fault
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-icp-unplug-no-change',
  ta.id,
  'Engine still does not start after ICP sensor is unplugged',
  'ok',
  'ICP sensor is not the limiting fault. The PCM''s substituted pressure alone is not sufficient — actual rail pressure is still too low. Proceed to air/puff test to locate the high-pressure oil leak.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'Unplugging the ICP sensor changes the PCM''s inferred pressure value but cannot create actual rail pressure that physically is not there. No improvement confirms the pressure side is the problem, not the sensor.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-icp-sensor-unplug' AND ta.is_retired = false;

-- ─── From: glow-plug-resistance ──────────────────────────────────────────────

-- Edge A27: All plugs 0.5-2.0 Ω + current draws normal → glow plug system healthy
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-glow-plug-ok',
  ta.id,
  'All 8 glow plugs read 0.5-2.0 Ω per plug; GPCM cycles correctly; current draw ~80 A per bank initial inrush',
  'ok',
  'Glow plug system confirmed healthy — not the no-start cause. Proceed to cam/crank correlation check.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-cam-crank-correlation' AND is_retired = false),
  'All glow plugs confirmed in spec and GPCM functioning. On a cold no-start with healthy ICP and FICM voltage, cam/crank sync is the remaining uninvestigated path.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-glow-plug-resistance' AND ta.is_retired = false;

-- Edge A28: Open plug(s) found → replace failed plug(s)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-glow-plug-fail-open',
  ta.id,
  'One or more glow plugs reads open circuit (OL / overrange) on resistance measurement',
  'fail',
  'Open glow plug(s) — replace failed plug(s). CRITICAL: verify correct application by engine build date. 2003/early-2004 glow plugs CANNOT be used in late-2004+ engines — they physically contact the piston. Build date cutoff: 9/29/2003.',
  NULL,
  'An open glow plug cannot heat the combustion chamber for cold-start ignition. Multiple open plugs will prevent cold starting even with healthy ICP and FICM. The build date cutoff for glow plug application is critical to prevent catastrophic piston damage.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-glow-plug-resistance' AND ta.is_retired = false;

-- ─── From: low-pressure-fuel ─────────────────────────────────────────────────

-- Edge A29: Fuel pressure 0 psi at key-on → HFCM not running
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-fuel-pressure-fail-zero',
  ta.id,
  'Fuel pressure reads 0 psi at key-on prime (no HFCM priming audible)',
  'fail',
  'Lift pump (HFCM) not running — fuel side cannot deliver to injectors. Check 12 V supply to HFCM, HFCM relay, and fuse. Lift pump motor failure if supply and relay are confirmed good.',
  NULL,
  'Zero fuel pressure at key-on means the HFCM did not prime. No fuel pressure means no fuel delivery regardless of ICP. Check the electrical supply before condemning the pump itself.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-low-pressure-fuel' AND ta.is_retired = false;

-- Edge A30: Fuel pressure >=45 psi all conditions → fuel side healthy
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-fuel-pressure-ok',
  ta.id,
  'Fuel pressure >=45 psi at key-on prime, during cranking, and at idle — all conditions',
  'ok',
  'Fuel side confirmed healthy. Proceed to ICP live read to investigate high-pressure oil system.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-icp-live-read' AND is_retired = false),
  'Running pressure >=45 psi is uncontested across all sources as the target spec. If this is confirmed, the fuel delivery system is not the no-start cause.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-low-pressure-fuel' AND ta.is_retired = false;

-- Edge A31: Fuel pressure <45 psi (contested cranking reading)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-fuel-pressure-warn-low-crank',
  ta.id,
  'Fuel pressure reads 10-44 psi during cranking (below Ford spec but within range cited as normal by some aftermarket sources)',
  'warn',
  'UNRESOLVED: Ford service info states >=45 psi all conditions including cranking. Multiple aftermarket sources document 10-15 psi during cranking as normal. Verify against your shop''s Ford service reference. If running pressure is >=45 psi and cranking pressure is 10-30 psi, the momentary sag may be acceptable. If running pressure is also low, lift pump is suspect.',
  NULL,
  'Source disagreement on cranking pressure spec is documented in the research input Section 6 item 3. The 10-15 psi figure likely represents a momentary sag during crank-start rather than a sustained steady value. Do not condemn the HFCM on a 10-15 psi cranking reading alone if running pressure is >=45 psi.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-low-pressure-fuel' AND ta.is_retired = false;

-- ─── From: compression ───────────────────────────────────────────────────────

-- Edge A32: All cylinders >=350 psi → compression healthy
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-compression-ok',
  ta.id,
  'All 8 cylinders read >=350 psi; cylinder-to-cylinder variation <=10%',
  'ok',
  'Compression confirmed healthy across all cylinders. Mechanical loss is not the no-start cause. If all prior tests (ICP, FICM, glow plugs, fuel, cam/crank) have been cleared, revisit ICP/IPR data and consider a fresh baseline with the FICM connectors cleaned.',
  NULL,
  'Compression >=350 psi confirms the engine is mechanically sound. By this point in the diagnostic sequence, all major systems have been evaluated. A return to first principles (clean connectors, fresh data log) is warranted before any further invasive work.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-compression' AND ta.is_retired = false;

-- Edge A33: One or more cylinders <300 psi → mechanical fault
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-compression-fail-low',
  ta.id,
  'One or more cylinders reads <300 psi; or cylinder-to-cylinder variation >10%',
  'fail',
  'Cylinder compression low — mechanical fault. Run wet test (add small amount of oil through glow plug hole): pressure increase after wet test = worn rings; pressure unchanged = valve issue, head gasket failure, or head crack. Consider EGR cooler hydrolock if coolant loss was observed.',
  NULL,
  'Low compression on a 6.0 PSD is less common than high-pressure oil or FICM failure but occurs on high-mileage engines or after EGR cooler coolant ingestion (hydrolock). The wet test differentiates ring wear from valve/head failure.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-compression' AND ta.is_retired = false;

-- ─── From: cam-crank-correlation ─────────────────────────────────────────────

-- Edge A34: FICM_SYNC=1 + RPM >100 → cam/crank path healthy
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-cam-crank-ok',
  ta.id,
  'FICM_SYNC reads 1 during crank; PCM RPM PID reads >=100 RPM',
  'ok',
  'Cam/crank correlation path confirmed healthy. The FICM is receiving and acknowledging the sync signal. If all other tests have been cleared and engine still does not start, proceed to compression test as the final mechanical check.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-compression' AND is_retired = false),
  'FICM_SYNC=1 confirms the PCM''s CKP signal is reaching the FICM and the FICM acknowledges it. This rules out sync issues as the no-start cause.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-cam-crank-correlation' AND ta.is_retired = false;

-- Edge A35: FICM_SYNC=0 → CKP/CMP signal not arriving at FICM
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-cam-crank-fail-no-sync',
  ta.id,
  'FICM_SYNC reads 0 during crank (even if PCM RPM PID shows engine spinning)',
  'fail',
  'CKP or CMP signal is not reaching the FICM. Common causes: (1) rust buildup between CKP sensor face and block, increasing air gap and weakening signal — CKP is under A/C compressor on passenger side; (2) oil migration up CMP harness, contaminating connector — CMP is behind power steering pump on driver side. Note: CKP replacement requires inner fender removal, coolant drain, fan shroud, A/C compressor unbolt — typically 2-3 hr labor.',
  NULL,
  'FICM_SYNC=0 with engine cranking (RPM >0) means the PCM is receiving a CKP signal but it is not being passed to the FICM, or the CMP signal is absent. The engine will not start regardless of ICP or FICM voltage if sync is not established.',
  'FIELD-VERIFIED', 'LOGIC', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-cam-crank-correlation' AND ta.is_retired = false;

-- ===========================================================================
-- PART B — 9 failure-pattern entry points (per Amendment 4)
-- All anchored to pull-all-dtcs as the entry-point test.
-- Pattern narrative goes in reasoning field.
-- Fact-check correction: Pattern 1 leads with injector top O-rings as #1.
-- ===========================================================================

-- Pattern 1 — Hot-restart progressively worse (FACT-CHECK CORRECTED)
-- Research input Section 5 row 1 listed STC as #1; fact-check correction per
-- plan header + Amendment 4: injector top O-rings are #1 on aging 6.0 PSDs.
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-hot-restart-progressively-worse',
  ta.id,
  'No DTCs or P2291 only; cold-start fine; hot restart progressively worse — takes longer cranking after each restart through the day; typically >100k mi; ICP cranks to ~300 psi with IPR at 85%',
  'warn',
  'Suspect injector top O-rings (#1 candidate — most common cause on aging 6.0 PSDs with this pattern). Secondary: STC fitting (mid/late-rail 2004.5-2007 trucks only). Tertiary: valve cover gasket internal leak. Proceed to air/puff test while hot to confirm leak location.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'Pattern 1 (research input Section 5): hot-restart progressively worse as engine heat-cycles through the day. FACT-CHECK CORRECTION: injector top O-rings are the #1 candidate on aging 6.0 PSDs — NOT the STC fitting. The injector upper square O-rings degrade with heat cycles; hot O-rings allow oil to bypass at the injector top during the hot-soak period, dropping ICP. Cold start works because the O-rings are dimensionally tighter when cold. The STC fitting is a valid secondary candidate on 2004.5-2007 trucks but is the #2 cause, not #1. Forum source "99% of the time when getting a 6.0 with a hard hot restart or no fire, it is the top injector o-rings" supports this ranking. Air/puff test while hot will confirm the leak source.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 2 — Cold no-start after sitting; ICP plateaus during crank (2003-04 truck)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-no-start-cold-after-sitting',
  ta.id,
  'Truck sits overnight cold; ICP plateaus at 250-450 psi during 10 s crank; IPR at 85%; oil clean; no DTCs; 2003-2004 truck',
  'warn',
  'Suspect (2003-2004 trucks): HPOP internal failure — aluminum swash-plate pumps fail at a high rate on early trucks. Also check standpipe O-rings. Proceed to air/puff test to confirm whether leak is present before condemning HPOP.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-air-puff' AND is_retired = false),
  'Pattern 2 (research input Section 5 row 2): early-truck (2003-2004) cold no-start with ICP plateauing below 500 psi. The aluminum swash-plate HPOP on early trucks fails internally at a high rate and cannot generate adequate pressure. If the air/puff test shows no external leak, the HPOP pump itself is the suspect. Standpipe O-rings are also a common cause and should be ruled out via air test first since they are a less expensive repair.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 3 — ICP desired high, ICP actual low → IPR or HPOP no-flow
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-icp-desired-high-actual-low',
  ta.id,
  'ICP_DESIRED commanded >1000 psi during crank; ICP actual stays <600 psi; IPR ramps to 85%',
  'warn',
  'PCM is demanding high pressure but the system cannot deliver. Suspect IPR stuck closed (valve not opening to allow pressure regulation) OR HPOP not generating adequate flow. Proceed to IPR duty cycle verification and air/puff test.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-ipr-duty-cycle' AND is_retired = false),
  'Pattern 3 (research input Section 5 row derived from Section 4 diagnostic tree): large gap between ICP desired and ICP actual with IPR at maximum duty cycle. The PCM is doing its job — the mechanical system is not responding. IPR duty cycle check distinguishes between an IPR valve that is physically not responding versus a system leak that the IPR cannot overcome.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 4 — ICP fine, FICM voltage low → FICM power supply issue
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-icp-fine-ficm-voltage-low',
  ta.id,
  'ICP reads >=500 psi during crank; FICM_MPWR reads <45 V (or FICM_VPWR <10.5 V); engine still does not fire',
  'fail',
  'FICM power supply issue — the high-pressure oil system is healthy but the FICM cannot drive the injectors. Check FICM battery feed, harness, and FICM itself. Verify batteries before condemning the FICM.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-ficm-voltage' AND is_retired = false),
  'Pattern 4 (research input Section 5 row derived from Section 4 FICM branch): adequate ICP confirms the oil side is not the problem. The engine has pressure but the injectors are not being fired — the FICM is not producing the 48 V pulse needed to release oil into the injector intensifier piston.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 5 — Everything checks out but engine still won't fire
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-everything-good-no-fire',
  ta.id,
  'Compression healthy; ICP >800 psi during crank; IPR cycling correctly; FICM voltage >=45 V; still no fire',
  'warn',
  'All major systems confirmed healthy yet engine will not fire. Likely: (1) FICM internal logic-side fault (vs power-supply-side), (2) GPCM / cam-crank sync issue with FICM_SYNC=0, or (3) fuel pressure starvation. Verify cam/crank correlation and fuel pressure if not yet done.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-cam-crank-correlation' AND is_retired = false),
  'Pattern 5 (research input Section 5 row 7 / derived): when ICP, FICM voltage, and compression all check out, the remaining uninvestigated paths are cam/crank sync (FICM_SYNC=0 means injectors will not fire regardless of ICP), FICM logic-side failure, and fuel starvation. FICM_SYNC=0 is a particularly common miss because it requires a specific scan tool PID that not all tools expose.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 6 — Fuel pressure low at Schrader port during cranking
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-fuel-pressure-low-crank',
  ta.id,
  'Fuel pressure at Schrader port reads 0 psi or <10 psi at key-on prime or during cranking; HFCM not audible',
  'fail',
  'Lift pump (HFCM) failure — fuel side cannot deliver to injectors. Check 12 V supply to HFCM, HFCM relay, HFCM fuse, and frame-mounted pump unit. Lift pump motor failure if supply is confirmed good.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-low-pressure-fuel' AND is_retired = false),
  'Pattern 6 (research input Section 5 row derived from Section 4 fuel path): zero or near-zero fuel pressure at the Schrader port with no audible HFCM priming confirms the electric lift pump is not running or not delivering. The HFCM is frame-mounted and includes the fuel filter — check the relay (located in the under-hood fuse box) and the 12 V supply harness before replacing the pump.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 7 — Glow plug DTC family (P0671-P0678)
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-glow-plug-dtcs',
  ta.id,
  'P0671, P0672, P0673, P0674, P0675, P0676, P0677, or P0678 present (any cylinder); ambient temperature <50 °F; white smoke during crank; ICP >=500 psi; FICM voltage >=45 V',
  'warn',
  'Glow plug system fault on indicated cylinder(s). Proceed to glow plug resistance test. This is likely the no-start root cause when cold-start symptoms and ICP/FICM are otherwise healthy.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-glow-plug-resistance' AND is_retired = false),
  'Pattern 7 (research input Section 5 row 4 / glow plug path): glow plug DTCs combined with cold ambient temperature, white smoke during crank, and healthy ICP and FICM voltage is the classic glow plug no-start pattern. Cold diesel combustion requires glow plug pre-heat — one or more open plugs can prevent ignition at low ambient temperatures even with adequate oil pressure.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 8 — No DTCs, FICM_SYNC=0, RPM PID reads 0
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-no-sync-rpm-zero',
  ta.id,
  'No DTCs stored; PCM RPM PID reads 0 during crank; FICM_SYNC = 0; starter is engaging and engine is mechanically cranking',
  'fail',
  'CKP signal lost — PCM does not see engine rotation. The engine is cranking but the PCM cannot confirm it. Most common: rust buildup at CKP sensor face (passenger side, under A/C compressor) increasing air gap. Secondary: oil-soaked CMP pigtail (driver side, behind power steering pump). Clean or replace sensor and pigtail.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-cam-crank-correlation' AND is_retired = false),
  'Pattern 8 (research input Section 5 row 8): RPM PID at 0 with mechanical cranking indicates CKP signal is absent entirely — not just weak. P2614/P2617 may not be stored if the signal is completely absent during a fresh crank event. The CKP on the 6.0 PSD sits under the A/C compressor on the passenger side — rust buildup at the sensor face is very common in northern climates and causes the air gap to widen past spec.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;

-- Pattern 9 — Milky oil / coolant in degas / ICP cannot build → oil cooler failure
INSERT INTO branch_logic (
  slug, test_action_id, condition, verdict, next_action,
  routes_to_test_action_id, reasoning,
  source_provenance, inference_class, is_retired
)
SELECT
  'sd3-60psd-branch-pattern-milky-oil-icp-collapse',
  ta.id,
  'Milky oil on dipstick OR rising coolant level in degas bottle with no external leak; ICP cannot build (plateaus <400 psi); IPR at 85%',
  'fail',
  'Oil cooler ruptured — coolant is entering the oil galleries, aerating the HPOP feed, causing ICP collapse. Root cause is the oil cooler (treat first); EGR cooler rupture is a downstream consequence (look for white smoke and coolant loss). The HPOP is likely healthy but starved — do not replace it until the oil cooler is replaced and oil system is flushed.',
  (SELECT id FROM test_actions WHERE slug = 'sd3-60psd-test-icp-live-read' AND is_retired = false),
  'Pattern 9 (research input Section 5 row 9): oil cooler rupture is the most catastrophic 6.0 PSD failure mode. The oil cooler sits between coolant and engine oil in the engine valley; when it plugs and ruptures, coolant enters the oil. Aerated (coolant-mixed) oil cannot be pressurized by the HPOP — the pump cavitates and ICP collapses. EGR cooler is downstream of the oil cooler in the coolant circuit; when oil cooler plugs, EGR cooler overheats and can rupture separately. A full oil cooler and EGR cooler replacement (plus flush of the entire cooling and oil circuit) is the correct repair — not just treating the symptoms.',
  'FIELD-VERIFIED', 'PATTERN', false
FROM test_actions ta WHERE ta.slug = 'sd3-60psd-test-pull-all-dtcs' AND ta.is_retired = false;
