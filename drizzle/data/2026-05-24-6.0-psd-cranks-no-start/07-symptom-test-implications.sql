-- Batch 7: symptom_test_implications — priority-ranked tests for cranks-no-start
--
-- Pure junction table: (symptom × test_action × priority). No free-text columns.
-- The 9 failure patterns from Section 5 of the research input are encoded in
-- branch_logic (batch 6) per Amendment 4. This batch only records the default
-- priority order for walking all 11 tests when no specific pattern has been
-- identified yet.
--
-- Priority rationale (cheapest first, most invasive last):
--   1  pull-all-dtcs            — 30 sec, no tools, rules out DTC-driven causes immediately
--   2  battery-crank            — 60 sec, cheap; batteries are #1 overlooked cause
--   3  ficm-voltage             — 30 sec, scan tool only; eliminates cheapest no-start cause
--   4  icp-live-read            — the diagnostic-defining PID; cheap, high-yield
--   5  ipr-duty-cycle           — paired with ICP read; same scan-tool session
--   6  low-pressure-fuel        — Schrader gauge, minimal disassembly
--   7  glow-plug-resistance     — requires GPCM harness access; moderately invasive
--   8  icp-sensor-unplug        — (NOT the IPR) unplug-and-crank; moderate invasiveness
--   9  air-puff-test            — requires intake/FICM/degas removal; invasive
--  10  compression              — pull injectors; high invasiveness
--  11  cam-crank-correlation    — scope waveform; most invasive / last-resort

-- Priority 1: Pull all DTCs
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  1,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-pull-all-dtcs'
  AND ta.is_retired = false;

-- Priority 2: Battery voltage under crank
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  2,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-battery-crank'
  AND ta.is_retired = false;

-- Priority 3: FICM voltage check
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  3,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-ficm-voltage'
  AND ta.is_retired = false;

-- Priority 4: ICP live read (the diagnostic-defining PID)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  4,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-icp-live-read'
  AND ta.is_retired = false;

-- Priority 5: IPR duty cycle (paired with ICP read)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  5,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-ipr-duty-cycle'
  AND ta.is_retired = false;

-- Priority 6: Low-pressure fuel check (Schrader gauge)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  6,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-low-pressure-fuel'
  AND ta.is_retired = false;

-- Priority 7: Glow plug resistance (requires GPCM harness access)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  7,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-glow-plug-resistance'
  AND ta.is_retired = false;

-- Priority 8: ICP sensor unplug (NOT the IPR — see test_action description)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  8,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-icp-sensor-unplug'
  AND ta.is_retired = false;

-- Priority 9: Air/puff test (requires intake/FICM/degas removal; turbo NOT required)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  9,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-air-puff'
  AND ta.is_retired = false;

-- Priority 10: Compression test (pull injectors; high invasiveness)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  10,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-compression'
  AND ta.is_retired = false;

-- Priority 11: Cam/crank correlation (scope waveform; most invasive / last-resort)
INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance, inference_class, is_retired)
SELECT
  s.id,
  ta.id,
  11,
  'FIELD-VERIFIED',
  'LOGIC',
  false
FROM symptoms s, test_actions ta
WHERE s.slug = 'cranks-no-start'
  AND ta.slug = 'sd3-60psd-test-cam-crank-correlation'
  AND ta.is_retired = false;
