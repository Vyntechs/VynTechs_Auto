-- drizzle/tests/0017_schema_verification.sql
--
-- Schema verification for migration 0017 (diagnostic orchestration).
-- Run via:
--   psql -d <dbname> -v ON_ERROR_STOP=1 -f drizzle/tests/0017_schema_verification.sql
--
-- Exits 0 if every check passes. Non-zero exit (with diagnostic message)
-- on the first failure. All behavioral tests use BEGIN/ROLLBACK envelopes
-- so the DB state is unchanged after a successful run.

\echo '=== Verifying migration 0017 ==='

-- ============================================================
-- STRUCTURE CHECKS
-- ============================================================

-- Test 1: All 12 new tables exist
DO $$
DECLARE
  expected_tables TEXT[] := ARRAY[
    'platforms', 'architecture_facts', 'components', 'observable_properties',
    'symptoms', 'test_actions', 'branch_logic', 'tech_outcomes',
    'diagnostic_sessions', 'component_connections',
    'symptom_test_implications', 'platform_equivalents'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY expected_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = t) THEN
      RAISE EXCEPTION 'TEST 1 FAILED: missing table %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 1 OK: all 12 tables exist';
END $$;

-- Test 2: vehicles.platform_id column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'platform_id'
  ) THEN
    RAISE EXCEPTION 'TEST 2 FAILED: vehicles.platform_id column missing';
  END IF;
  RAISE NOTICE 'TEST 2 OK: vehicles.platform_id exists';
END $$;

-- Test 3: RLS policies on tech_outcomes (expect 4)
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid = 'tech_outcomes'::regclass;
  IF n <> 4 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: tech_outcomes expected 4 RLS policies, found %', n;
  END IF;
  RAISE NOTICE 'TEST 3 OK: tech_outcomes has 4 RLS policies';
END $$;

-- Test 4: RLS policies on diagnostic_sessions (expect 4)
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid = 'diagnostic_sessions'::regclass;
  IF n <> 4 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: diagnostic_sessions expected 4 RLS policies, found %', n;
  END IF;
  RAISE NOTICE 'TEST 4 OK: diagnostic_sessions has 4 RLS policies';
END $$;

-- Test 5: tech_outcomes.session_id FK has RESTRICT cascade
DO $$
DECLARE
  delete_action CHAR;
BEGIN
  SELECT confdeltype INTO delete_action
  FROM pg_constraint
  WHERE conrelid = 'tech_outcomes'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE '%session_id%';
  IF delete_action <> 'r' THEN
    RAISE EXCEPTION 'TEST 5 FAILED: tech_outcomes.session_id should be RESTRICT (r), found %', delete_action;
  END IF;
  RAISE NOTICE 'TEST 5 OK: tech_outcomes.session_id is RESTRICT';
END $$;

-- ============================================================
-- BEHAVIORAL CHECKS — constraints enforce as specified
-- ============================================================

-- Test 6: CASCADE — deleting a platform cascades to its architecture_facts
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('verif-cascade', '2020', 'V', 'F');
INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
  SELECT 'verif-cascade-fact', id, 't', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'verif-cascade';
DELETE FROM platforms WHERE slug = 'verif-cascade';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM architecture_facts WHERE slug = 'verif-cascade-fact') THEN
    RAISE EXCEPTION 'TEST 6 FAILED: CASCADE did not fire on platforms';
  END IF;
  RAISE NOTICE 'TEST 6 OK: CASCADE fires on platforms → architecture_facts';
END $$;
ROLLBACK;

-- Test 7: CHECK invasiveness BETWEEN 1 AND 5 rejects 7
DO $$
BEGIN
  BEGIN
    INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
      VALUES ('verif-inv', '2020', 'V', 'F');
    INSERT INTO components (slug, platform_id, name, kind, source_provenance)
      SELECT 'verif-inv-c', id, 'c', 'sensor', 'TRAINING-CONFIRMED'
      FROM platforms WHERE slug = 'verif-inv';
    INSERT INTO test_actions (slug, component_id, description, scenario_required, observation_method, invasiveness, source_provenance)
      SELECT 'verif-inv-t', id, 't', 'idle', 'scan_tool_pid', 7, 'TRAINING-CONFIRMED'
      FROM components WHERE slug = 'verif-inv-c';
    RAISE EXCEPTION 'TEST 7 FAILED: CHECK did not reject invasiveness=7';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'TEST 7 OK: invasiveness=7 rejected';
  END;
END $$;

-- Test 8: CHECK confidence_boost BETWEEN 0 AND 100 rejects -5
DO $$
BEGIN
  BEGIN
    INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
      VALUES ('verif-cb', '2020', 'V', 'F');
    INSERT INTO components (slug, platform_id, name, kind, source_provenance)
      SELECT 'verif-cb-c', id, 'c', 'sensor', 'TRAINING-CONFIRMED'
      FROM platforms WHERE slug = 'verif-cb';
    INSERT INTO test_actions (slug, component_id, description, scenario_required, observation_method, invasiveness, confidence_boost, source_provenance)
      SELECT 'verif-cb-t', id, 't', 'idle', 'scan_tool_pid', 2, -5, 'TRAINING-CONFIRMED'
      FROM components WHERE slug = 'verif-cb-c';
    RAISE EXCEPTION 'TEST 8 FAILED: CHECK did not reject confidence_boost=-5';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'TEST 8 OK: confidence_boost=-5 rejected';
  END;
END $$;

-- Test 9: CHECK cumulative_confidence BETWEEN 0 AND 100 rejects 150
-- Wrapped in BEGIN/ROLLBACK so throwaway fixtures (shop/profile/customer/
-- vehicle/symptom) don't persist. Self-contained — doesn't depend on
-- pre-existing rows in vehicles/shops/profiles.
BEGIN;
DO $$
DECLARE
  fake_shop_id UUID;
  fake_profile_id UUID;
  fake_customer_id UUID;
  fake_vehicle_id UUID;
  fake_symptom_id UUID;
BEGIN
  INSERT INTO shops (name) VALUES ('verif-cc-shop')
    RETURNING id INTO fake_shop_id;
  INSERT INTO profiles (user_id, shop_id, role)
    VALUES (gen_random_uuid(), fake_shop_id, 'tech')
    RETURNING id INTO fake_profile_id;
  INSERT INTO customers (shop_id, name, phone)
    VALUES (fake_shop_id, 'verif-cc-cust', '555-0000')
    RETURNING id INTO fake_customer_id;
  INSERT INTO vehicles (customer_id, year, make, model)
    VALUES (fake_customer_id, 2020, 'V', 'F')
    RETURNING id INTO fake_vehicle_id;
  INSERT INTO symptoms (slug, description, category)
    VALUES ('verif-cc-s', 't', 'dtc')
    RETURNING id INTO fake_symptom_id;

  BEGIN
    INSERT INTO diagnostic_sessions (vehicle_id, symptom_id, shop_id, tech_id, cumulative_confidence)
      VALUES (fake_vehicle_id, fake_symptom_id, fake_shop_id, fake_profile_id, 150);
    RAISE EXCEPTION 'TEST 9 FAILED: CHECK did not reject cumulative_confidence=150';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'TEST 9 OK: cumulative_confidence=150 rejected';
  END;
END $$;
ROLLBACK;

-- Test 10: CHECK priority BETWEEN 1 AND 10 rejects 100
DO $$
BEGIN
  BEGIN
    INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
      VALUES ('verif-pri', '2020', 'V', 'F');
    INSERT INTO components (slug, platform_id, name, kind, source_provenance)
      SELECT 'verif-pri-c', id, 'c', 'sensor', 'TRAINING-CONFIRMED'
      FROM platforms WHERE slug = 'verif-pri';
    INSERT INTO test_actions (slug, component_id, description, scenario_required, observation_method, invasiveness, source_provenance)
      SELECT 'verif-pri-t', id, 't', 'idle', 'scan_tool_pid', 2, 'TRAINING-CONFIRMED'
      FROM components WHERE slug = 'verif-pri-c';
    INSERT INTO symptoms (slug, description, category) VALUES ('verif-pri-s', 't', 'dtc');
    INSERT INTO symptom_test_implications (symptom_id, test_action_id, priority, source_provenance)
      SELECT s.id, t.id, 100, 'TRAINING-CONFIRMED'
      FROM symptoms s, test_actions t
      WHERE s.slug = 'verif-pri-s' AND t.slug = 'verif-pri-t';
    RAISE EXCEPTION 'TEST 10 FAILED: CHECK did not reject priority=100';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'TEST 10 OK: priority=100 rejected';
  END;
END $$;

-- Test 11: Retirement invariant — active row with replaced_by_id fails
DO $$
DECLARE
  fact_a_id UUID;
  fact_b_id UUID;
BEGIN
  INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
    VALUES ('verif-retire', '2020', 'V', 'F');
  INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
    SELECT 'verif-retire-a', id, 'A', 'TRAINING-CONFIRMED' FROM platforms WHERE slug = 'verif-retire'
    RETURNING id INTO fact_a_id;
  INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
    SELECT 'verif-retire-b', id, 'B', 'FIELD-VERIFIED' FROM platforms WHERE slug = 'verif-retire'
    RETURNING id INTO fact_b_id;

  BEGIN
    UPDATE architecture_facts SET replaced_by_id = fact_b_id WHERE id = fact_a_id;
    RAISE EXCEPTION 'TEST 11 FAILED: retirement invariant did not block active row with replaced_by_id';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'TEST 11 OK: retirement invariant blocks active row with replaced_by_id';
  END;

  -- Clean up
  DELETE FROM platforms WHERE slug = 'verif-retire';
END $$;

-- Test 12: Partial unique on slug blocks two active rows with same slug
DO $$
BEGIN
  BEGIN
    INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
      VALUES ('verif-punq', '2020', 'V', 'F');
    INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
      SELECT 'verif-punq-fact', id, 'first', 'TRAINING-CONFIRMED'
      FROM platforms WHERE slug = 'verif-punq';
    INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
      SELECT 'verif-punq-fact', id, 'second', 'TRAINING-CONFIRMED'
      FROM platforms WHERE slug = 'verif-punq';
    RAISE EXCEPTION 'TEST 12 FAILED: partial unique did not block duplicate active slugs';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'TEST 12 OK: partial unique blocks duplicate active slugs';
  END;

  DELETE FROM platforms WHERE slug = 'verif-punq';
END $$;

-- Test 13: Partial unique allows retirement pattern (one retired + one active same slug)
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('verif-retpat', '2020', 'V', 'F');
INSERT INTO architecture_facts (slug, platform_id, description, source_provenance, is_retired)
  SELECT 'verif-retpat-fact', id, 'old', 'TRAINING-CONFIRMED', true
  FROM platforms WHERE slug = 'verif-retpat';
INSERT INTO architecture_facts (slug, platform_id, description, source_provenance, is_retired)
  SELECT 'verif-retpat-fact', id, 'new', 'FIELD-VERIFIED', false
  FROM platforms WHERE slug = 'verif-retpat';
DO $$
DECLARE
  n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM architecture_facts WHERE slug = 'verif-retpat-fact';
  IF n <> 2 THEN
    RAISE EXCEPTION 'TEST 13 FAILED: expected 2 rows (one retired, one active), found %', n;
  END IF;
  RAISE NOTICE 'TEST 13 OK: retirement pattern allowed (retired + active same slug)';
END $$;
ROLLBACK;

-- Test 14: Canonical ordering CHECK on platform_equivalents
DO $$
DECLARE
  p_a UUID;
  p_b UUID;
  larger UUID;
  smaller UUID;
BEGIN
  INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
    VALUES ('verif-eq-a', '2020', 'V', 'A') RETURNING id INTO p_a;
  INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
    VALUES ('verif-eq-b', '2020', 'V', 'B') RETURNING id INTO p_b;

  -- Determine which UUID is larger
  IF p_a > p_b THEN
    larger := p_a;
    smaller := p_b;
  ELSE
    larger := p_b;
    smaller := p_a;
  END IF;

  -- Try inserting with WRONG ordering (larger as platform_a_id) — should fail
  BEGIN
    INSERT INTO platform_equivalents (platform_a_id, platform_b_id, system, verdict, source_provenance)
      VALUES (larger, smaller, 'fuel', 'FULLY', 'TRAINING-CONFIRMED');
    RAISE EXCEPTION 'TEST 14 FAILED: canonical ordering CHECK did not reject larger-first ordering';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'TEST 14 OK: canonical ordering CHECK blocks larger-first';
  END;

  -- Clean up (cascades to platform_equivalents if any)
  DELETE FROM platforms WHERE slug IN ('verif-eq-a', 'verif-eq-b');
END $$;

\echo '=== All migration 0017 verification tests passed ==='
