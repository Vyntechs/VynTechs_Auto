-- ===========================================================================
-- Batch 2: architecture_facts — theory of operation, 6.0L Power Stroke HEUI
-- PR: 6.0 PSD cranks-no-start canonical seed
-- Platform: ford-super-duty-3rd-gen-60-psd (2003-2007)
-- Source: Section 1 of 2026-05-24-6.0-psd-cranks-no-start-research-input.md
--
-- ~10 atomic theory-of-operation facts for the high-pressure oil injection
-- system. Includes required fact-check correction: IPR vs ICP sensor are
-- distinct components with distinct test methods and unplug behaviors.
-- Also includes the oil cooler 15°F ΔT threshold per plan amendments.
--
-- Slug format: sd3-60psd-fact-<short-desc>
-- FK pattern:  SELECT-id-by-slug (never hardcode UUIDs)
-- ===========================================================================

-- Fact 1: HEUI operating principle — injectors require high-pressure oil to fire
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-heui-oil-fires-injectors',
  p.id,
  'The 6.0L Power Stroke uses HEUI (Hydraulically actuated Electronically controlled Unit Injector) fuel injection: each injector is fired by high-pressure engine oil acting on a hydraulic plunger. If oil-rail pressure cannot reach ~500 psi, the injectors will not fire and the engine will not start regardless of fuel pressure.',
  false,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 2: HPOP location and drive method
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-hpop-cam-driven',
  p.id,
  'HPOP (High-Pressure Oil Pump) is camshaft-gear-driven and mounted in the engine valley at the rear of the engine, beneath the turbocharger, on 2003-2007 6.0L Power Stroke engines.',
  false,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 3: HPOP pressure range
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-hpop-pressure-range',
  p.id,
  'HPOP discharge pressure must reach a minimum of ~500 psi to fire injectors; maximum demand pressure exceeds 3,000 psi. During cranking, a healthy system produces 500-2,000 psi at the oil rail.',
  false,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 4: STC fitting — late-rail trucks only
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-stc-fitting-late-rail-only',
  p.id,
  'The STC (snap-to-connect) fitting connects the HPOP discharge to the high-pressure branch tube on 2004.5-2007 trucks only (late-rail platform). Early 2003-early 2004 trucks use a different coupling without the STC. The STC seal fatigues under vibration and heat, progressing from hot-restart trouble to complete blow-apart.',
  false,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 5: Standpipes and dummy plug O-rings as known failure points
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-standpipe-dummy-plug-orings',
  p.id,
  'Standpipes (one per cylinder bank, threaded into each cylinder head) and dummy plugs (one per bank, sealing the far end of each oil rail) both use O-rings that are known to flatten and tear, creating high-pressure oil leaks that cause ICP to plateau below 500 psi during cranking.',
  false,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 6: FICM voltage and injector drive
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-ficm-48v-injector-drive',
  p.id,
  'The FICM (Fuel Injection Control Module) sends a 48-volt, 20-amp pulse to each injector solenoid that releases high-pressure oil into the intensifier piston. If FICM output falls below 45 V during cranking, injectors will not fire reliably. FICM power-supply failure is a common no-start cause on 6.0L Power Stroke engines.',
  false,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 7: IPR vs ICP sensor — the critical distinction (required per plan amendments)
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-ipr-vs-icp-sensor-distinct',
  p.id,
  'The IPR valve and ICP sensor are distinct components with distinct test methods and unplug behaviors. The IPR valve (Injection Pressure Regulator) is a mechanical actuator threaded into the HPOP cover plate; unplugging it sends the valve to its mechanical default (fully open), guaranteeing no rail pressure builds. The ICP sensor (Injection Control Pressure) is a three-wire variable-capacitance sensor that reads actual oil-rail pressure; unplugging it forces the PCM to substitute a default of ~750 psi as its inferred input, which may allow the engine to start if the sensor itself is faulty. These two unplug tests have opposite diagnostic meanings and must never be confused.',
  true,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 8: IPR valve duty cycle operation
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-ipr-duty-cycle',
  p.id,
  'The IPR valve regulates oil-rail pressure via duty cycle: ~15% commanded = fully open (bleed off, low pressure), ~85% commanded = fully closed (maximum pressure). During cranking the PCM ramps IPR duty toward 85% to build ICP. IPR duty cycle >30% at warm idle indicates a high-pressure circuit leak. IPR duty cycle stuck at 85% with ICP never reaching 500 psi means the system cannot build pressure.',
  false,
  'FIELD-VERIFIED',
  'LAW',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 9: Oil cooler delta-T threshold (required by plan amendments — fact-check correction)
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-oil-cooler-delta-t',
  p.id,
  'Oil cooler delta-T ≥15°F oil-to-coolant at steady highway driving is the consensus field heuristic for a restricted or failing oil cooler. A plugged oil cooler also restricts coolant flow to the downstream EGR cooler; when the EGR cooler overheats and ruptures, coolant enters the oil galleries, aerates the HPOP feed, and causes ICP collapse. Treat oil cooler failure as the root cause when ICP cannot build and oil is milky or coolant level is dropping.',
  true,
  'FIELD-VERIFIED',
  'PATTERN',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';

-- Fact 10: PCM crank sequence — what the PCM monitors before releasing injectors
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class, is_retired)
SELECT
  'sd3-60psd-fact-pcm-crank-sequence',
  p.id,
  'During cranking, the PCM monitors CKP (crankshaft position) for sync, commands glow plugs through the GPCM, commands the IPR closed (~85% duty) to build rail pressure, watches ICP rise, and only once ICP exceeds 500 psi AND FICM_SYNC = 1, releases the FICM to fire injectors. A failure in any of these parallel conditions (CKP sync, glow plug cycle, HPOP pressure, FICM sync) will prevent the engine from starting.',
  false,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM platforms p WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd';
