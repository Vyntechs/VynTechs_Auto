-- Run 1 / Prompt 1 inserts — 2018 F-250 6.7L PSD fuel system
-- Generated 2026-05-19 from vetted subagent JSON (subagent-output-p1.md)
-- Pending Brandon's approval for live execution

BEGIN;

-- 1 platform row
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family, generation)
VALUES (
  'ford-super-duty-4th-gen-67-psd',
  '2017-2022',
  'Ford',
  'Super Duty',
  '4th gen'
)
ON CONFLICT (slug) DO UPDATE SET
  year_range = EXCLUDED.year_range,
  parent_make = EXCLUDED.parent_make,
  parent_model_family = EXCLUDED.parent_model_family,
  generation = EXCLUDED.generation,
  updated_at = NOW()
RETURNING id;

-- 23 architecture_facts rows linked to that platform
-- Uses a CTE to capture the platform id from the INSERT above.
WITH p AS (
  SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'
)
INSERT INTO architecture_facts (slug, platform_id, description, field_verify_required, source_provenance, inference_class)
SELECT v.slug, p.id, v.description, v.field_verify_required, v.source_provenance::text, v.inference_class::text
FROM p
CROSS JOIN (VALUES
  -- Tank & lift area (3 facts)
  ('sd4-67psd-primary-fuel-tank', 'The 2018 F-250 6.7L Power Stroke uses a mid-ship, under-cab/frame single primary fuel tank as standard configuration, with capacity varying by cab/bed configuration (approximately 26–48 gallons); dual-tank configurations were not offered from the factory on this generation.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-lift-pump-location', 'A frame-mounted, electric in-line low-pressure fuel lift pump is located on the driver-side frame rail, providing low-pressure fuel transfer from the tank to the CP4.2 high-pressure pump.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-in-tank-sender', 'An in-tank fuel level sender with a resistive-type analog signal is present, providing fuel gauge information to the instrument cluster/BCM.', false, 'TRAINING-CONFIRMED', NULL),

  -- Primary filter / WIF (2 facts)
  ('sd4-67psd-fuel-filter-primary', 'A primary fuel filter and water separator assembly is located on the driver-side frame rail, downstream of the lift pump and upstream of the CP4.2, incorporating a WIF sensor and manual drain.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-wif-sensor-signal', 'The water-in-fuel sensor is integrated into the frame-rail primary fuel filter housing and provides a signal to the PCM, but exact wire count, signal type, and connector pinout are not reliably confirmed in training data.', true, 'GAP', NULL),

  -- High-pressure pump (4 facts)
  ('sd4-67psd-cp42-pump-type', 'The 2017–2022 6.7L Power Stroke uses a Bosch CP4.2 high-pressure common rail fuel pump, gear-driven off the engine front geartrain at the front cover.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-cp42-max-rail-pressure', 'The CP4.2 commands fuel rail pressure up to approximately 29,000 PSI under peak demand, but the exact PCM-calibrated maximum for the 2018 tune requires field confirmation via live scan data.', true, 'GAP', NULL),
  ('sd4-67psd-cp42-fuel-lubrication-dependency', 'The CP4.2 pump is lubricated entirely by diesel fuel with no separate oil circuit, making fuel lubricity, contamination, and water content directly and architecturally critical to pump longevity.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-imv-inlet-metering-valve', 'An inlet metering valve (IMV) is integrated into the CP4.2 pump body; it is a normally-open, PWM-controlled solenoid commanded by the PCM to regulate fuel volume entering the high-pressure circuit.', false, 'TRAINING-CONFIRMED', NULL),

  -- Rails & injectors (4 facts)
  ('sd4-67psd-hp-fuel-rails', 'Two steel high-pressure fuel rails (one per cylinder bank) connect the CP4.2 to the eight fuel injectors.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-rail-pressure-sensor', 'At least one three-wire fuel rail pressure sensor (5V reference, analog voltage signal, ground) is present on the high-pressure rail; the PCM uses it for closed-loop fuel pressure control.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-type', 'The 2018 6.7L Power Stroke uses Bosch solenoid-type (not piezoelectric) common rail injectors driven by high-voltage/high-current PWM signals from the PCM''s injector driver circuits.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-injector-count', 'Eight fuel injectors are present, one per cylinder, in a V8 configuration.', false, 'TRAINING-CONFIRMED', NULL),

  -- Return & relief (2 facts)
  ('sd4-67psd-fuel-return-system', 'A passive low-pressure fuel return circuit routes excess fuel from the high-pressure rail overflow/pressure limiting valve back to the tank or filter housing; no active pump is used in the return circuit.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-rail-pressure-relief-valve', 'A mechanical rail pressure limiting valve is present on the high-pressure rail to protect against overpressure events, but its exact factory-set cracking pressure is not confirmed in training data.', true, 'GAP', NULL),

  -- Control & comms (3 facts)
  ('sd4-67psd-pcm-identity-location', 'The Powertrain Control Module (PCM), mounted on the passenger-side firewall in the engine compartment, is the sole primary controller for all fuel system actuators including the IMV, injectors, and lift pump relay.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm-network', 'The PCM communicates on the high-speed CAN bus (HS-CAN, 500 kbps), broadcasting all fuel system PIDs including rail pressure, injector duty cycle, WIF status, and lift pump status.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-pcm-module-fuel-comms', 'The PCM shares fuel-related CAN data with the Instrument Cluster (WIF warning lamp, fuel gauge) and the ABS/Traction Control module (torque management integration); no separate dedicated fuel control module exists.', false, 'TRAINING-CONFIRMED', NULL),

  -- Misc (5 facts)
  ('sd4-67psd-lift-pump-relay-location', 'The lift pump relay is housed in the Battery Junction Box (BJB) or Smart Junction Box (SJB) in the engine compartment, but exact relay cavity designation requires Ford WSM or FDRS confirmation for the 2018 model year.', true, 'GAP', NULL),
  ('sd4-67psd-no-evap-system', 'As a diesel application, the 6.7L Power Stroke has no EVAP canister or purge system; the fuel cap is a standard non-pressurized diesel cap.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-def-system-relationship', 'A separate DEF (urea/AdBlue) tank on the passenger-side frame rail feeds the SCR dosing system; DEF pump, injector, and level/quality sensor are PCM-controlled via CAN and interact with fuel combustion quality for emissions compliance.', false, 'TRAINING-CONFIRMED', NULL),
  ('sd4-67psd-fuel-heater-option', 'An electrically heated fuel filter element or fuel line heater may be present on some 4th-gen Super Duty builds as a factory option for cold-weather operation, but its availability and exact location on the 2018 F-250 require WSM or build-sheet confirmation.', true, 'TRAINING-INFERRED', NULL),
  ('sd4-67psd-fuel-filter-part-number', 'The OEM primary fuel filter part number for the 2018 6.7L Power Stroke is not reliably confirmed in training data and must be verified against the current Ford parts catalog.', true, 'GAP', NULL)
) AS v(slug, description, field_verify_required, source_provenance, inference_class)
ON CONFLICT (slug) WHERE is_retired = false DO UPDATE SET
  description = EXCLUDED.description,
  field_verify_required = EXCLUDED.field_verify_required,
  source_provenance = EXCLUDED.source_provenance,
  inference_class = EXCLUDED.inference_class,
  updated_at = NOW();

-- Verification before COMMIT
SELECT
  (SELECT count(*) FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AS platform_count,
  (SELECT count(*) FROM architecture_facts WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND is_retired = false) AS active_fact_count,
  (SELECT count(*) FROM architecture_facts WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND source_provenance = 'TRAINING-CONFIRMED') AS confirmed_count,
  (SELECT count(*) FROM architecture_facts WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND source_provenance = 'TRAINING-INFERRED') AS inferred_count,
  (SELECT count(*) FROM architecture_facts WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND source_provenance = 'GAP') AS gap_count;
-- Expected: platform_count=1, active_fact_count=23, confirmed_count=17, inferred_count=1, gap_count=5

COMMIT;
