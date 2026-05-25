-- ============================================================
-- Fuel-system seed data: 6.7L Power Stroke interactive electrical topology
-- Platform: ford-super-duty-4th-gen-67-psd  (slug → platforms.id via subquery)
-- ============================================================
--
-- SLUG MAPPING (prototype → live DB)
-- pcm              → sd4-67psd-pcm
-- lift-pump        → sd4-67psd-lift-pump
-- vcv              → sd4-67psd-imv          (Volume Control Valve = Inlet Metering Valve, same physical part)
-- frp-sensor       → sd4-67psd-frp-sensor
-- hp-pump          → sd4-67psd-cp4-pump     (mechanical)
-- passenger-rail   → sd4-67psd-hp-rail-bank-b  (mechanical)
-- frp-reg          → sd4-67psd-frp-reg      ** INSERTED by this seed **
-- shared-5v        → sd4-67psd-shared-5v    ** INSERTED by this seed **
-- shared-lref      → sd4-67psd-shared-lref  ** INSERTED by this seed **
--
-- PIN SLUG CONVENTION: prototype pin slugs used verbatim as component_pins.slug
--   lp-12v, lp-gnd  (lift-pump)
--   vcv-a, vcv-b    (imv — prototype used vcv-* slugs; slug is a label, component_id FK is the link)
--   frp-signal, frp-5v, frp-lref  (frp-sensor)
--   reg-a, reg-b    (frp-reg)
--   splices have no pins
--
-- DO NOT APPLY to any database — that is Task 12/13.
-- ============================================================


-- ============================================================
-- BLOCK 0: INSERT the 3 missing components
-- ============================================================

INSERT INTO components (
  slug, platform_id, name, kind, systems, source_provenance, is_retired
) VALUES
  (
    'sd4-67psd-frp-reg',
    (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
    'FRP Regulator',
    'actuator',
    ARRAY['fuel'],
    'TRAINING-CONFIRMED',
    false
  ),
  (
    'sd4-67psd-shared-5v',
    (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
    'Shared 5V Reference Splice',
    'splice',
    ARRAY['fuel'],
    'TRAINING-CONFIRMED',
    false
  ),
  (
    'sd4-67psd-shared-lref',
    (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
    'Shared Low-Reference Splice',
    'splice',
    ARRAY['fuel'],
    'TRAINING-CONFIRMED',
    false
  );


-- ============================================================
-- BLOCK 0.5: INSERT missing component_connections
--
-- Existing connections already in DB (verified by query):
--   pcm → imv           controlled_by   (498d5c6e-...)
--   frp-sensor → pcm    reports_to      (f7ec0bc2-...)
--   pcm → lift-pump-relay controlled_by (19ce75dc-...)
--   lift-pump-relay → lift-pump electrical-wire (ecac52dd-...)
--
-- NEW connections needed for the 3 new components:
--   pcm → frp-reg        controlled_by   (PCM drives FRP regulator via PWM)
--   shared-5v → frp-sensor  electrical-wire (5V ref line from splice to sensor)
--   frp-sensor → shared-lref electrical-wire (low-ref return from sensor to splice)
--   pcm → shared-5v      electrical-wire  (PCM 5V supply feeds the splice)
--   pcm → shared-lref    electrical-wire  (PCM low-ref sink receives from splice)
--   frp-reg → hp-rail-bank-a mechanical-linkage (regulator is bolted to back of driver-side rail = bank-a)
-- ============================================================

INSERT INTO component_connections (
  from_component_id, to_component_id, connection_kind, direction,
  description, source_provenance, is_retired
)
SELECT
  pcm.id,
  frp_reg.id,
  'controlled_by',
  'unidirectional',
  'PCM commands FRP regulator via high-frequency PWM electrical signal to trim fuel return out of the driver-side rail and set downstream rail pressure',
  'TRAINING-CONFIRMED',
  false
FROM
  components pcm,
  components frp_reg
WHERE
  pcm.slug  = 'sd4-67psd-pcm'
  AND frp_reg.slug = 'sd4-67psd-frp-reg';

INSERT INTO component_connections (
  from_component_id, to_component_id, connection_kind, direction,
  description, source_provenance, is_retired
)
SELECT
  pcm.id,
  sv.id,
  'electrical-wire',
  'unidirectional',
  'PCM 5V reference output feeds the shared 5V sensor splice; splice distributes 5V to FRP sensor and other sensors on the same bus',
  'TRAINING-CONFIRMED',
  false
FROM
  components pcm,
  components sv
WHERE
  pcm.slug = 'sd4-67psd-pcm'
  AND sv.slug  = 'sd4-67psd-shared-5v';

INSERT INTO component_connections (
  from_component_id, to_component_id, connection_kind, direction,
  description, source_provenance, is_retired
)
SELECT
  pcm.id,
  slr.id,
  'electrical-wire',
  'unidirectional',
  'PCM low-reference sink receives sensor return path from the shared low-ref splice; splice collects the low-ref wires from FRP sensor and other sensors on the same bus',
  'TRAINING-CONFIRMED',
  false
FROM
  components pcm,
  components slr
WHERE
  pcm.slug  = 'sd4-67psd-pcm'
  AND slr.slug = 'sd4-67psd-shared-lref';

INSERT INTO component_connections (
  from_component_id, to_component_id, connection_kind, direction,
  description, source_provenance, is_retired
)
SELECT
  sv.id,
  frp.id,
  'electrical-wire',
  'unidirectional',
  'Shared 5V splice distributes PCM 5V reference to the FRP sensor 5V REF pin',
  'TRAINING-CONFIRMED',
  false
FROM
  components sv,
  components frp
WHERE
  sv.slug  = 'sd4-67psd-shared-5v'
  AND frp.slug = 'sd4-67psd-frp-sensor';

INSERT INTO component_connections (
  from_component_id, to_component_id, connection_kind, direction,
  description, source_provenance, is_retired
)
SELECT
  frp.id,
  slr.id,
  'electrical-wire',
  'unidirectional',
  'FRP sensor low-reference return wire runs back to the shared low-ref splice on the way to PCM',
  'TRAINING-CONFIRMED',
  false
FROM
  components frp,
  components slr
WHERE
  frp.slug = 'sd4-67psd-frp-sensor'
  AND slr.slug = 'sd4-67psd-shared-lref';

INSERT INTO component_connections (
  from_component_id, to_component_id, connection_kind, direction,
  description, source_provenance, is_retired
)
SELECT
  frp_reg.id,
  rail_a.id,
  'mechanical-linkage',
  'unidirectional',
  'FRP regulator is bolted to the back of the driver-side rail (bank-a) — physical mechanical mount that gives the regulator a port to vent rail pressure',
  'TRAINING-CONFIRMED',
  false
FROM
  components frp_reg,
  components rail_a
WHERE
  frp_reg.slug = 'sd4-67psd-frp-reg'
  AND rail_a.slug = 'sd4-67psd-hp-rail-bank-a';


-- ============================================================
-- BLOCK 1: Component prose UPDATEs
-- All 9 fuel components.  Prose copied VERBATIM from prototype DATA[].
-- Single quotes escaped as ''  throughout.
-- ============================================================

-- PCM (sd4-67psd-pcm)
UPDATE components SET
  subtitle        = 'Powertrain Control Module',
  role            = 'Controller — every electrical wire in this system terminates here',
  wire_summary    = '9 wires routed into this system (4 of which go to two PWM regulators, 3 go to the FRP sensor, 2 go to the lift pump)',
  body            = 'PCM drives the lift pump command, modulates the two PWM regulators (volume control valve on the HP pump, and the FRP pressure regulator at the back of the rail), supplies 5V reference to the sensors, and reads the FRP sensor signal. PCM modulates duty cycle on regulator drivers — duty cycle commanded determines milliamps through each coil.',
  probing_tactic  = 'Probing tactic: PCM connector itself is rarely the failure. Probe at the COMPONENT end first (sensor or regulator side), and only walk back to PCM if the wire between them tests open.',
  unknown_note    = 'PCM connector IDs and cavity numbers for each wire — not yet captured.'
WHERE slug = 'sd4-67psd-pcm';

-- Lift Pump (sd4-67psd-lift-pump)
UPDATE components SET
  subtitle        = 'Low-Pressure Electric Lift Pump',
  role            = 'Pulls fuel through the tank-mounted 10-micron filter/water separator and pushes it forward to the engine-mounted 4-micron filter, then on to the high-pressure pump. Target supply pressure: roughly 55 psi at idle.',
  wire_summary    = '2 wires — one power, one ground',
  body            = 'Two-wire electric pump in the tank. PCM commands it on. There is typically a fuel pump driver module or a relay sitting upstream between PCM and the pump''s power wire — those are conditional branches that only get tested when probing shows the power wire isn''t getting 12V on command.'
WHERE slug = 'sd4-67psd-lift-pump';

-- IMV / Volume Control Valve (sd4-67psd-imv)
UPDATE components SET
  subtitle        = 'Metering Unit · on the high-pressure pump',
  role            = 'PCM-modulated solenoid that meters fuel into the high-pressure pumping chambers. Sets the upstream side of rail pressure (the FRP regulator sets the downstream side).',
  wire_summary    = '2 wires, both go to PCM, PWM-modulated',
  body            = 'PCM controls the milliamps through this coil by modulating duty cycle. Whether one side is switched 12V and the other is PCM-modulated ground (or both wires connect directly to PCM internal drivers) varies by design — for diagnostic purposes both wires should show PCM activity when commanded.',
  probing_tactic  = 'Back-probe either pin while engine is running. PWM signal should be present and change with load and commanded rail pressure.'
WHERE slug = 'sd4-67psd-imv';

-- FRP Sensor (sd4-67psd-frp-sensor)
UPDATE components SET
  subtitle        = 'Fuel Rail Pressure Sensor',
  role            = 'Reports actual rail pressure to PCM so the PWM control loop can hit its target.',
  wire_summary    = '3 wires — SIGNAL, 5V REF (shared), LOW REF (shared)',
  body            = '3-wire sensor at the front of the driver-side fuel rail. Signal wire goes direct to PCM. The 5V reference and low reference each route through shared splices with other sensors on the way to/from PCM. Which other sensors share those splices is a label that gets filled in over time — but the SHARING is canonical. A failed shared 5V or low-ref splice will pull down every sensor on that bus.'
WHERE slug = 'sd4-67psd-frp-sensor';

-- FRP Regulator (sd4-67psd-frp-reg) — newly inserted
UPDATE components SET
  subtitle        = 'Fuel Rail Pressure Control Valve',
  role            = 'PCM-modulated solenoid that trims return flow out of the rail. Sets the downstream side of rail pressure.',
  wire_summary    = '2 wires, both go to PCM, PWM-modulated',
  body            = 'Works in tandem with the volume control valve on the HP pump. Volume control sets how much fuel enters the high-pressure side; this regulator sets how much returns. Together they hold the rail at the target pressure PCM commands.',
  probing_tactic  = 'Back-probe either pin while engine running. PWM should be present and modulate with commanded pressure.'
WHERE slug = 'sd4-67psd-frp-reg';

-- HP Pump / CP4 (sd4-67psd-cp4-pump) — mechanical, shorter prose
UPDATE components SET
  subtitle        = 'Gear-Driven from the Camshaft',
  role            = 'Generates the rail pressure that feeds the injectors. Driven mechanically — no electrical input of its own.',
  wire_summary    = 'None — the volume control valve mounted on top is the only electrical interface',
  body            = 'The HP pump itself is mechanical: gear-driven off the camshaft, internal cam profile drives two main pistons. The fuel volume control valve sits on top and is what regulates how much fuel actually gets pressurized — that''s the electrical lever PCM has on this pump. Checked with mechanical pressure tests, not by probing wires.'
WHERE slug = 'sd4-67psd-cp4-pump';

-- Passenger Rail / Bank B (sd4-67psd-hp-rail-bank-b) — mechanical, shorter prose
UPDATE components SET
  subtitle        = 'Mechanical fuel routing only',
  role            = 'Distributes fuel to the passenger-side injectors.',
  wire_summary    = 'None — no electrical components on this rail in this system',
  body            = 'The passenger-side rail has no electrical components in this fuel system. All electrical diagnostic on the rails happens on the driver-side rail (FRP sensor at the front, FRP regulator at the back).'
WHERE slug = 'sd4-67psd-hp-rail-bank-b';

-- Shared 5V Splice (sd4-67psd-shared-5v) — newly inserted
UPDATE components SET
  subtitle        = 'Multiple sensors share PCM''s 5V supply through this junction',
  role            = 'Common 5V reference distribution from PCM to multiple sensors',
  wire_summary    = 'PCM''s 5V output enters; multiple sensor 5V REF wires (FRP sensor + others) leave',
  body            = 'When several sensors on the same vehicle all report "5V REF dead" or similar voltage-reference faults at once, suspect this splice or PCM''s 5V supply itself rather than each sensor independently.',
  unknown_note    = 'Which OTHER sensors share this 5V reference on this vehicle — not yet captured (this gets filled in as you build out other sensor topologies in the system).'
WHERE slug = 'sd4-67psd-shared-5v';

-- Shared Low-Reference Splice (sd4-67psd-shared-lref) — newly inserted
UPDATE components SET
  subtitle        = 'Sensor return path back to PCM',
  role            = 'Common return / "sensor ground" path back to PCM',
  wire_summary    = 'Multiple sensor LOW REF wires converge; one return wire to PCM',
  body            = 'Sensor low-reference is a precise return path through PCM''s analog ground — NOT chassis ground. When several sensors read biased high at once, suspect this splice or PCM''s low-reference circuit.',
  unknown_note    = 'Which OTHER sensors share this low-reference splice — not yet captured.'
WHERE slug = 'sd4-67psd-shared-lref';


-- ============================================================
-- BLOCK 2: component_pins INSERTs
-- 9 total pins across 4 electrical components.
-- Splices and mechanical components have no pins.
-- ============================================================

-- Lift Pump: 2 pins  (lp-12v on top, lp-gnd on bottom)
INSERT INTO component_pins (
  slug, component_id, name, role_abbreviation, edge, display_order,
  probe_location, expected_reading, missing_logic, label_gap,
  source_provenance, is_retired
) VALUES
(
  'lp-12v',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-lift-pump'),
  'Lift Pump · 12V Power',
  '12V',
  'top',
  1,
  'Back-probe the power wire at the lift pump connector under the truck near the tank',
  '<b>12V</b> when commanded by PCM (key-on prime, cranking, or running)',
  'Reading <b>0V when commanded</b> → expand the conditional branch and probe upstream: fuel pump relay, fuse, and any fuel pump driver module. Reading <b>12V but pump silent</b> → ground side broken, OR pump motor seized.',
  'Wire color, connector pin number, prime duration, and upstream relay/fuse identifiers — not yet captured.',
  'TRAINING-CONFIRMED',
  false
),
(
  'lp-gnd',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-lift-pump'),
  'Lift Pump · Ground',
  'GND',
  'bottom',
  2,
  'Resistance check from the ground wire at the lift pump connector to chassis ground',
  '<b>< 0.5 Ω</b> continuity to chassis',
  'Open or high resistance → broken ground wire between the pump and the chassis stud, OR corroded ground point.',
  'Wire color and the exact chassis stud location — not yet captured.',
  'TRAINING-CONFIRMED',
  false
);

-- IMV (Volume Control Valve): 2 pins  (vcv-a and vcv-b, both top edge)
INSERT INTO component_pins (
  slug, component_id, name, role_abbreviation, edge, display_order,
  probe_location, expected_reading, missing_logic, label_gap,
  source_provenance, is_retired
) VALUES
(
  'vcv-a',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-imv'),
  'Volume Control Valve · Pin A',
  'PWM',
  'top',
  1,
  'Back-probe pin A at the volume control valve connector on top of the HP pump',
  'PWM activity when engine running. <b>Duty cycle varies with engine load</b> and the rail pressure PCM is commanding.',
  'Flat at 12V or flat at 0V → wire broken between PCM and this pin, OR PCM driver issue (rare). Cross-check the other pin (B) to localize.',
  'Wire color and pin number — not yet captured.',
  'TRAINING-CONFIRMED',
  false
),
(
  'vcv-b',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-imv'),
  'Volume Control Valve · Pin B',
  'PWM',
  'top',
  2,
  'Back-probe pin B at the volume control valve connector',
  'PWM activity when engine running, complementary or inverse of pin A depending on the wiring convention',
  'Same diagnostic logic as pin A. If A shows PWM and B is dead, the wire to B is the failure.',
  'Wire color and pin number — not yet captured.',
  'TRAINING-CONFIRMED',
  false
);

-- FRP Sensor: 3 pins  (frp-signal, frp-5v, frp-lref — all top edge)
INSERT INTO component_pins (
  slug, component_id, name, role_abbreviation, edge, display_order,
  probe_location, expected_reading, missing_logic, label_gap,
  source_provenance, is_retired
) VALUES
(
  'frp-signal',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-sensor'),
  'FRP Sensor · Signal',
  'SIG',
  'top',
  1,
  'Back-probe the signal pin at the FRP sensor connector (front of DS rail)',
  'Analog voltage between <b>0V and 5V</b>, proportional to rail pressure. Low at rest, climbs as the rail pressurizes. Exact voltage curve for this sensor — not yet captured.',
  '<b>Stuck at 0V</b> → signal shorted to ground, OR sensor failed, OR the 5V reference is dead (check the 5V pin next). <b>Stuck at 5V</b> → signal wire open, OR shorted to 5V. <b>Reads correctly but a pressure DTC is set</b> → sensor is reading reality; the issue is the regulator or volume control valve, not the sensor.',
  'Wire color, sensor pin number, and the exact voltage-to-pressure curve for this sensor — not yet captured.',
  'TRAINING-CONFIRMED',
  false
),
(
  'frp-5v',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-sensor'),
  'FRP Sensor · 5V Reference',
  '5V',
  'top',
  2,
  'Back-probe the 5V REF pin at the FRP sensor connector',
  '<b>~5V key-on</b>',
  '0V → PCM''s 5V supply dead, OR the shared 5V splice broken, OR the wire open. If multiple sensors share this 5V (typical), they''ll all fail together — check another 5V-using sensor to localize whether it''s the shared splice or just this wire.',
  'Wire color and sensor pin number — not yet captured.',
  'TRAINING-CONFIRMED',
  false
),
(
  'frp-lref',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-sensor'),
  'FRP Sensor · Low Reference',
  'LREF',
  'top',
  3,
  'Back-probe the LOW REF pin at the FRP sensor connector',
  '<b>~0V</b> — sensor''s analog return through PCM via the shared low-ref splice',
  'Reading above 0V → bad return path through the shared splice, OR shared splice open, OR PCM low-ref ground broken. Other sensors on the same low-ref will read biased high at the same time.',
  'Wire color and sensor pin number — not yet captured.',
  'TRAINING-CONFIRMED',
  false
);

-- FRP Regulator: 2 pins  (reg-a and reg-b, both top edge)
INSERT INTO component_pins (
  slug, component_id, name, role_abbreviation, edge, display_order,
  probe_location, expected_reading, missing_logic, label_gap,
  source_provenance, is_retired
) VALUES
(
  'reg-a',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-reg'),
  'FRP Regulator · Pin A',
  'PWM',
  'top',
  1,
  'Back-probe pin A at the FRP regulator connector (back of DS rail)',
  'PWM activity when engine running. <b>Duty cycle varies with rail-pressure target</b>.',
  'Flat → wire broken between PCM and this pin, OR PCM driver issue. Cross-check pin B.',
  'Wire color and pin number — not yet captured.',
  'TRAINING-CONFIRMED',
  false
),
(
  'reg-b',
  (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-reg'),
  'FRP Regulator · Pin B',
  'PWM',
  'top',
  2,
  'Back-probe pin B at the FRP regulator connector',
  'PWM activity when engine running, complementary to pin A',
  'Same logic as pin A.',
  'Wire color and pin number — not yet captured.',
  'TRAINING-CONFIRMED',
  false
);


-- ============================================================
-- BLOCK 3: Connection electrical role + pin endpoints
-- Match by from_component slug + to_component slug + connection_kind.
-- from_pin_id NULL for connections originating at PCM (no PCM-side pins in seed).
-- from_pin_id NULL for splices (splices have no pins).
-- ============================================================

-- PCM → IMV (controlled_by): to_pin = vcv-a (first/primary PWM pin)
UPDATE component_connections SET
  electrical_role = 'pwm',
  from_pin_id     = NULL,  -- PCM-side pin not seeded
  to_pin_id       = (SELECT id FROM component_pins WHERE slug = 'vcv-a')
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-pcm')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-imv')
  AND connection_kind = 'controlled_by';

-- FRP Sensor → PCM (reports_to): from_pin = frp-signal
UPDATE component_connections SET
  electrical_role = 'signal',
  from_pin_id     = (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  to_pin_id       = NULL  -- PCM-side pin not seeded
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-sensor')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-pcm')
  AND connection_kind = 'reports_to';

-- PCM → FRP Reg (controlled_by): to_pin = reg-a
UPDATE component_connections SET
  electrical_role = 'pwm',
  from_pin_id     = NULL,  -- PCM-side pin not seeded
  to_pin_id       = (SELECT id FROM component_pins WHERE slug = 'reg-a')
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-pcm')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-reg')
  AND connection_kind = 'controlled_by';

-- PCM → Shared 5V (electrical-wire): both NULL (PCM-side pin not seeded; splice has no pins)
UPDATE component_connections SET
  electrical_role = '5v-ref',
  from_pin_id     = NULL,
  to_pin_id       = NULL
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-pcm')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-shared-5v')
  AND connection_kind = 'electrical-wire';

-- PCM → Shared Low-Ref (electrical-wire): both NULL
UPDATE component_connections SET
  electrical_role = 'low-ref',
  from_pin_id     = NULL,
  to_pin_id       = NULL
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-pcm')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-shared-lref')
  AND connection_kind = 'electrical-wire';

-- Shared 5V → FRP Sensor (electrical-wire): from_pin NULL (splice has no pins); to_pin = frp-5v
UPDATE component_connections SET
  electrical_role = '5v-ref',
  from_pin_id     = NULL,
  to_pin_id       = (SELECT id FROM component_pins WHERE slug = 'frp-5v')
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-shared-5v')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-sensor')
  AND connection_kind = 'electrical-wire';

-- FRP Sensor → Shared Low-Ref (electrical-wire): from_pin = frp-lref; to_pin NULL (splice has no pins)
UPDATE component_connections SET
  electrical_role = 'low-ref',
  from_pin_id     = (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  to_pin_id       = NULL
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-frp-sensor')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-shared-lref')
  AND connection_kind = 'electrical-wire';

-- Lift-pump-relay → Lift Pump (electrical-wire): to_pin = lp-12v
UPDATE component_connections SET
  electrical_role = '12v',
  from_pin_id     = NULL,  -- relay-side pin not seeded
  to_pin_id       = (SELECT id FROM component_pins WHERE slug = 'lp-12v')
WHERE
  from_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-lift-pump-relay')
  AND to_component_id = (SELECT id FROM components WHERE slug = 'sd4-67psd-lift-pump')
  AND connection_kind = 'electrical-wire';


-- ============================================================
-- BLOCK 4: system_scenarios INSERTs
-- 8 rows for fuel on 6.7L PSD.
-- Default = idle  (per D17).
-- Fault rows: key_position + engine_state + load_level all NULL per schema design.
-- ============================================================

INSERT INTO system_scenarios (
  slug, platform_id, system, label, sub, kind,
  key_position, engine_state, load_level,
  is_default, display_order, is_retired
) VALUES
(
  'key-off',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Key Off',
  'Vehicle asleep — no power anywhere in this system',
  'operation',
  'off',
  NULL,
  NULL,
  false,
  1,
  false
),
(
  'key-on',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Key On · Engine Off',
  'PCM awake, 5V reference hot, sensors reading rest pressure. Lift pump primes briefly then stops.',
  'operation',
  'on',
  'off',
  NULL,
  false,
  2,
  false
),
(
  'idle',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Engine Idle',
  'Lift pump steady, both PWM regulators at moderate duty, FRP reading idle rail pressure',
  'operation',
  'on',
  'running',
  'idle',
  true,
  3,
  false
),
(
  'light-load',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Light Load',
  'Cruising / light throttle — slight bump in PWM duty above idle',
  'operation',
  'on',
  'running',
  'light',
  false,
  4,
  false
),
(
  'medium-load',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Medium Load',
  'Towing or moderate acceleration — higher PWM duty, rising rail pressure',
  'operation',
  'on',
  'running',
  'medium',
  false,
  5,
  false
),
(
  'heavy-load',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Heavy Load',
  'WOT or heavy tow — peak duty cycles, peak rail pressure',
  'operation',
  'on',
  'running',
  'heavy',
  false,
  6,
  false
),
(
  'fault-high',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Fault Sim: Pegged High Pressure',
  'FRP signal stuck high — PCM cutting volume control AND opening regulator to bleed pressure off the rail',
  'fault',
  NULL,
  NULL,
  NULL,
  false,
  7,
  false
),
(
  'fault-low',
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Fault Sim: No Rail Pressure',
  'FRP signal flat low — PCM commanding max volume in AND closing return to try to build pressure',
  'fault',
  NULL,
  NULL,
  NULL,
  false,
  8,
  false
);


-- ============================================================
-- BLOCK 5: scenario_wire_states INSERTs
-- 8 scenarios × 9 pins = 72 rows.
-- Wire states sourced verbatim from prototype SCENARIOS[slug].pinStates[pin].
-- Prototype uses 'steady-5v' for frp-lref in key-on and running scenarios
-- (the low-ref line is active/sinking at near-0V while the sensor is powered;
--  the prototype represents this with steady-5v class because the line is active,
--  not because the voltage is 5V).
-- ============================================================

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-off'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'off'::wire_state;

-- key-on: lp-12v=pwm-low, lp-gnd=pwm-low, vcv-a=off, vcv-b=off,
--         frp-signal=signal-rest, frp-5v=steady-5v, frp-lref=steady-5v,
--         reg-a=off, reg-b=off
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'pwm-low'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'pwm-low'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-rest'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'off'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'key-on'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'off'::wire_state;

-- idle: lp-12v=steady-12v, lp-gnd=steady-gnd, vcv-a=pwm-med, vcv-b=pwm-med,
--       frp-signal=signal-med, frp-5v=steady-5v, frp-lref=steady-5v,
--       reg-a=pwm-med, reg-b=pwm-med
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'steady-12v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'steady-gnd'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'pwm-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'pwm-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'pwm-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'idle'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'pwm-med'::wire_state;

-- light-load: lp-12v=steady-12v, lp-gnd=steady-gnd, vcv-a=pwm-med, vcv-b=pwm-med,
--             frp-signal=signal-med, frp-5v=steady-5v, frp-lref=steady-5v,
--             reg-a=pwm-med, reg-b=pwm-med
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'steady-12v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'steady-gnd'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'pwm-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'pwm-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'pwm-med'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'light-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'pwm-med'::wire_state;

-- medium-load: lp-12v=steady-12v, lp-gnd=steady-gnd, vcv-a=pwm-high, vcv-b=pwm-high,
--              frp-signal=signal-high, frp-5v=steady-5v, frp-lref=steady-5v,
--              reg-a=pwm-high, reg-b=pwm-high
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'steady-12v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'steady-gnd'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'pwm-high'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'pwm-high'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-high'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'pwm-high'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'medium-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'pwm-high'::wire_state;

-- heavy-load: lp-12v=steady-12v, lp-gnd=steady-gnd, vcv-a=pwm-max, vcv-b=pwm-max,
--             frp-signal=signal-high, frp-5v=steady-5v, frp-lref=steady-5v,
--             reg-a=pwm-max, reg-b=pwm-max
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'steady-12v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'steady-gnd'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'pwm-max'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'pwm-max'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-high'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'pwm-max'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'heavy-load'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'pwm-max'::wire_state;

-- fault-high: lp-12v=steady-12v, lp-gnd=steady-gnd, vcv-a=pwm-low, vcv-b=pwm-low,
--             frp-signal=signal-pegged, frp-5v=steady-5v, frp-lref=steady-5v,
--             reg-a=pwm-max, reg-b=pwm-max
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'steady-12v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'steady-gnd'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'pwm-low'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'pwm-low'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-pegged'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'pwm-max'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-high'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'pwm-max'::wire_state;

-- fault-low: lp-12v=steady-12v, lp-gnd=steady-gnd, vcv-a=pwm-max, vcv-b=pwm-max,
--            frp-signal=signal-low, frp-5v=steady-5v, frp-lref=steady-5v,
--            reg-a=pwm-low, reg-b=pwm-low
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-12v'),
  'steady-12v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'lp-gnd'),
  'steady-gnd'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-a'),
  'pwm-max'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'vcv-b'),
  'pwm-max'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-signal'),
  'signal-low'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-5v'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'frp-lref'),
  'steady-5v'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-a'),
  'pwm-low'::wire_state;

INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state)
SELECT
  (SELECT id FROM system_scenarios WHERE slug = 'fault-low'
     AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
     AND system = 'fuel'),
  (SELECT id FROM component_pins WHERE slug = 'reg-b'),
  'pwm-low'::wire_state;


-- ============================================================
-- BLOCK 6: pin_scenario_readings INSERTs
-- 9 pins × 8 scenarios = 72 rows.
-- Reading text copied VERBATIM from prototype PIN_READINGS[pin][scenario].
-- Single quotes escaped as '' throughout.
-- ============================================================

-- lp-12v readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V — PCM not commanding pump';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V briefly during prime, then 0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V steady (pump runs regardless of pressure fault)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-12v'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '12V steady — if pump is actually silent, suspect ground or pump motor';

-- lp-gnd readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis (resistance check valid any time)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis · sinking pump current';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'lp-gnd'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Continuity to chassis';

-- vcv-a readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V (PCM not yet commanding)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · moderate duty (metering fuel for idle rail pressure)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · moderate duty';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · high duty';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · near max duty';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · LOW duty — PCM cutting volume to try to bring pressure down';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-a'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · MAX duty — PCM trying to build pressure';

-- vcv-b readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM activity, complementary to pin A';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM activity';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM activity';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM near max';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · low duty (matching pin A)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'vcv-b'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · max duty (matching pin A)';

-- frp-signal readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V (sensor not powered)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Low voltage representing rest rail pressure';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Idle-pressure voltage';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Slightly above idle';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Mid-range voltage';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Near-max voltage';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Pegged near 5V — this is what the fault is showing';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-signal'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'Flat low even while cranking — this is what the fault is showing';

-- frp-5v readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V (PCM 5V supply off)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V steady';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V steady (5V supply is not the issue here)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-5v'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~5V — but verify here first: if 0V, the "no pressure" fault is actually a 5V REF failure, not a rail problem';

-- frp-lref readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'No return active';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'frp-lref'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '~0V — verify: if biased high, the FRP signal fault is actually a low-ref splice failure';

-- reg-a readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · moderate duty (trimming return for idle pressure)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · moderate duty';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · high duty';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · near max duty';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · MAX duty — PCM opening return to bleed off rail pressure';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-a'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · low duty — PCM closing return to hold what pressure exists';

-- reg-b readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'key-off' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'key-on' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), '0V';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'idle' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM activity, complementary to pin A';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'light-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM activity';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'medium-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM activity';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'heavy-load' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM near max';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'fault-high' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · max (matching pin A)';
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) SELECT (SELECT id FROM component_pins WHERE slug = 'reg-b'), (SELECT id FROM system_scenarios WHERE slug = 'fault-low' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd') AND system = 'fuel'), 'PWM · low (matching pin A)';


-- ============================================================
-- BLOCK 7: system_data_status INSERT
-- ============================================================

INSERT INTO system_data_status (platform_id, system, captured_header, missing_header, closing_note)
VALUES (
  (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Captured from theory · enough to diagnose',
  'Labels not yet captured · make probing faster, not possible',
  'Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn''t wait for completion to be useful.'
);
