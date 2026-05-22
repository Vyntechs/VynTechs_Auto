-- Fuel-system tagging for the interactive topology diagnostic (PR-A, Task 4).
-- Data step, not a schema migration. Applied to live Supabase via the
-- Supabase MCP after the component list was confirmed. Recorded here for
-- auditability and so the diesel-seeding effort can follow the same pattern.
--
-- 22 fuel-system components on the 2018 F-250 6.7L PSD platform + the 3
-- existing fuel symptoms. Shared ground/power nodes (BJB, engine-block and
-- frame ground nodes) are deferred to PR-B's shared-node handling.

UPDATE components SET systems = ARRAY['fuel']
WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
  AND slug IN (
    'sd4-67psd-pcm',
    'sd4-67psd-lift-pump',
    'sd4-67psd-lift-pump-relay',
    'sd4-67psd-fuel-tank',
    'sd4-67psd-fuel-filter-ws',
    'sd4-67psd-fuel-level-sender',
    'sd4-67psd-wif-sensor',
    'sd4-67psd-cp4-pump',
    'sd4-67psd-imv',
    'sd4-67psd-frp-sensor',
    'sd4-67psd-hp-rail-bank-a',
    'sd4-67psd-hp-rail-bank-b',
    'sd4-67psd-injector-1', 'sd4-67psd-injector-2', 'sd4-67psd-injector-3', 'sd4-67psd-injector-4',
    'sd4-67psd-injector-5', 'sd4-67psd-injector-6', 'sd4-67psd-injector-7', 'sd4-67psd-injector-8',
    'sd4-67psd-pressure-relief-valve',
    'sd4-67psd-return-circuit'
  );

UPDATE symptoms SET system = 'fuel'
WHERE slug IN (
  'p0087-fuel-rail-pressure-too-low',
  'p0088-fuel-rail-pressure-too-high',
  'no-start-cranks-normally-fuel-system-suspect'
);
