# Diagnostic Orchestration — Phase 1 Schema Design

**Date:** 2026-05-19
**Branch (work):** cut new feature branch off `staging-interactive-diagnostics`
**Branch (integration target):** `staging-interactive-diagnostics` (Brandon merges PRs into this; this branch is NOT merged to `main` until the whole orchestration build lands)
**Final destination:** `main` (after Phases 1, 2, and 3 of the build are complete)

**Kickoff:** `docs/superpowers/handoffs/2026-05-19-orchestration-build-kickoff.md`
**Validation report:** `docs/interactive-diagnostics/validation-2026-05-19-orchestration.md`
**Graph schema (Cypher source):** `docs/interactive-diagnostics/graph-schema.md`
**Architecture (4-prompt orchestration):** `docs/interactive-diagnostics/architecture.md`

---

## 1. Goal

Translate the 4-prompt diagnostic orchestration's graph-native data model (currently expressed in Cypher in `graph-schema.md`) into a set of relational Postgres tables, deployed to the existing Supabase database. After this work, Phase 2 (smallest-viable end-to-end test against the live database) is unblocked, and the orchestration's structured outputs from each prompt have a place to land.

This is Phase 1 only: schema and migration. No application code, no orchestration wrapper, no UI surface.

---

## 2. Decisions locked during brainstorm

1. **Smallest-viable-test scope:** 2018 F-250 6.7L Power Stroke · fuel system · P0087 + P0088 + no-start cranks normally (the design-package canonical case).
2. **Storage primitive:** Option D — relational tables in the existing Supabase Postgres. NOT Apache AGE, NOT Neo4j.
3. **Graph scope:** Shared across all shops. Field outcomes from any shop's tech accumulate on the same test-action node; the compounding-database effect is preserved by global node identity.
4. **Schema shape:** Path A — one table per kind of thing, plus a small join table for each complex relationship. Simple parent-child relationships become foreign-key columns on the child, not separate join tables.
5. **Source tagging:** Two-dimensional. Every fact-bearing row carries a `source_provenance` column (`TRAINING-CONFIRMED` / `TRAINING-INFERRED` / `FIELD-VERIFIED` / `GAP`) and an `inference_class` column (`LAW` / `LOGIC` / `PATTERN`, nullable for direct-stated facts).
6. **Equivalence directionality:** Stored once per pair with canonical ordering (`platform_a_id < platform_b_id`). Queries check both directions via `OR`.
7. **Retirement pattern for fact-bearing rows:** When a `GAP` flips to `FIELD-VERIFIED` (or any correction), write a new row and mark the old `is_retired = true` with `replaced_by_id` pointing to the new row. Matches the existing `corpus_entries` retirement convention.

---

## 3. Out of scope (explicitly deferred)

- **Orchestration application code.** No prompt-calling wrapper, no graph-mutation API, no cached-diagnostic query function. Phase 2 hand-runs the chain via SQL + raw prompt calls; Phase 3 builds the Claude Code skill.
- **Diagnostic-rendering UI surface.** The interactive layout components (METER, SCOPE, GAUGE, SCAN TOOL, ACTIVE TEST) are independent design work.
- **Sample data seeding into live DB.** All inserts during Phase 2 will be per-op approved by Brandon (per `feedback_no_dangerous_prod_ops`).
- **Remaining 4 layout specs.** Independent design documents (see validation report's "Next concrete decisions" #3).
- **Apache AGE / Neo4j installation.** Option D locked.
- **Denormalized field-outcome stats on `test_actions`.** `avg(measured_value)` and `stdev` computed on demand for now. Defer denormalization until query performance demands it.
- **`provenance_history` audit table.** Retirement pattern preserves history via retired rows. Defer dedicated history table until audit queries become common.
- **General `vehicles → platforms` lookup/inference layer.** Phase 2 hand-sets `vehicles.platform_id` during the smallest-viable-test runs.

---

## 4. Tables — node entities (9)

All tables follow existing codebase conventions: UUID primary keys (`uuid('id').primaryKey().defaultRandom()`), `created_at` / `updated_at` with timezone, text columns with `enum: [...]` constraint for enums (matching the `entry_source` pattern on `corpus_entries`), and `references(() => parentTable.id, { onDelete: 'cascade' })` for foreign keys.

Every node table (§4.1–§4.9) carries a `slug` text column — the semantic identifier produced by the prompts (e.g., `"67psd-frp-sensor"`); used as the natural merge key for `INSERT ... ON CONFLICT (slug) DO UPDATE`. Junction tables (§5.1–§5.3) don't carry slugs — their natural identity is the (from_id, to_id, qualifier) tuple, enforced by the partial UNIQUE constraint in each table's section.

**Uniqueness on `slug` for fact-bearing tables is partial**, scoped to active rows: `CREATE UNIQUE INDEX <table>_slug_active_unique ON <table>(slug) WHERE is_retired = false`. Drizzle-kit doesn't emit partial uniques natively — these are hand-written in step 4 of §8. Non-fact-bearing tables (`platforms`, `symptoms`) get a full unique constraint on `slug` (no retirement mechanism).

Fact-bearing tables additionally carry:
- `source_provenance` text NOT NULL — see §6.
- `inference_class` text NULL — see §6. (Omitted on `platform_equivalents`; that table uses only `source_provenance`.)
- `is_retired` boolean NOT NULL DEFAULT false — retirement flag.
- `replaced_by_id` UUID NULL self-FK with `ON DELETE SET NULL` — points at the row that replaced this one. SET NULL means: if the replacement row is itself deleted, the predecessor's pointer becomes null (still retired, no successor).

Fact-bearing tables: `architecture_facts`, `components`, `observable_properties`, `test_actions`, `branch_logic`, `component_connections`, `symptom_test_implications`, `platform_equivalents`.
Non-fact-bearing: `platforms`, `symptoms`, `tech_outcomes`, `diagnostic_sessions`.

**Retirement invariant.** Every fact-bearing table carries a CHECK constraint enforcing that active rows cannot point at a successor:

```sql
CHECK (replaced_by_id IS NULL OR is_retired = true)
```

This catches the bug-class where an application layer sets `replaced_by_id` on a row but forgets to flip `is_retired`. The constraint is hand-written per table in step 4 of §8 (drizzle-kit doesn't emit table-level CHECKs from the TypeScript schema).

**Slug case sensitivity.** Postgres text comparisons are case-sensitive. `"67psd-frp-sensor"` and `"67PSD-FRP-Sensor"` are distinct slugs. The orchestration application layer is responsible for normalizing prompt-emitted slugs (lowercase, replace whitespace with hyphens, strip non-`[a-z0-9-]` characters) before INSERT. This normalization is application-side; the schema does not enforce it.

**Self-referential foreign keys in Drizzle TypeScript.** Two tables in this design have self-FKs (`platforms.parent_platform_id`, plus the `replaced_by_id` column on every fact-bearing table). Drizzle requires an explicit `AnyPgColumn` type cast in the reference closure because the table identifier isn't yet defined when the column is declared:

```typescript
import { type AnyPgColumn, pgTable, uuid } from 'drizzle-orm/pg-core'

export const platforms = pgTable('platforms', {
  // ...
  parentPlatformId: uuid('parent_platform_id')
    .references((): AnyPgColumn => platforms.id, { onDelete: 'set null' }),
})
```

Same idiom applies to every `replaced_by_id` column.

### 4.1 `platforms`

A specific vehicle architecture. One row per architecture (year range + engine + generation), not per VIN.

Columns:
- `id` UUID PK
- `slug` text unique — e.g., `"ford-superduty-4thgen-67psd"`
- `year_range` text NOT NULL — human-readable (e.g., `"2017-2022"`)
- `parent_make` text NOT NULL
- `parent_model_family` text NOT NULL
- `generation` text NULL
- `parent_platform_id` UUID NULL → `platforms.id` ON DELETE SET NULL (self-FK for the HAS_ANCESTOR lineage edge; if a parent platform is deleted, the child's pointer becomes null, child platform survives)
- `created_at`, `updated_at` standard

Indexes:
- unique on `slug`
- `platforms_parent_platform_id_idx` on `parent_platform_id`

RLS: none (globally readable, writable by orchestration).

### 4.2 `architecture_facts`

Atomic facts about a platform from Prompt 1.

Columns:
- `id` UUID PK
- `slug` text NOT NULL
- `platform_id` UUID NOT NULL → `platforms.id` ON DELETE CASCADE
- `description` text NOT NULL
- `field_verify_required` boolean NOT NULL DEFAULT false
- standard fact-bearing fields (§4 intro): `source_provenance`, `inference_class`, `is_retired`, `replaced_by_id`, `created_at`, `updated_at`

Indexes:
- partial unique on `slug WHERE is_retired = false` (per §4 intro)
- `architecture_facts_platform_id_idx` on `platform_id`
- `architecture_facts_active_idx` on `platform_id WHERE is_retired = false` (partial)

RLS: none.

### 4.3 `components`

Physical components on a platform.

Columns:
- `id` UUID PK
- `slug` text NOT NULL
- `platform_id` UUID NOT NULL → `platforms.id` ON DELETE CASCADE
- `name` text NOT NULL
- `kind` text NOT NULL — enum: `'sensor' | 'actuator' | 'pump' | 'valve' | 'module' | 'mechanical' | 'splice' | 'connector'`
- `electrical_contract` text NULL — e.g., `"3-wire analog (5V ref, low ref, signal)"`
- `location` text NULL
- `function` text NULL
- standard fact-bearing fields

Indexes:
- partial unique on `slug WHERE is_retired = false` (per §4 intro)
- `components_platform_id_idx` on `platform_id`
- `components_active_idx` on `platform_id WHERE is_retired = false` (partial)

RLS: none.

### 4.4 `observable_properties`

What can be observed about each component, and how.

Columns:
- `id` UUID PK
- `slug` text NOT NULL
- `component_id` UUID NOT NULL → `components.id` ON DELETE CASCADE
- `description` text NOT NULL — e.g., `"FRP signal voltage at sensor connector"`
- `observation_method` text NOT NULL — enum: `'scan_tool_pid' | 'pressure_test_with_gauge' | 'electrical_measurement_at_pin' | 'waveform_capture' | 'direct_visual_internal' | 'direct_visual_external' | 'audible' | 'touch' | 'smell'`
- `housing_opacity_status` text NULL — enum: `'opaque' | 'transparent' | 'removable' | 'unknown'`; only meaningful when `observation_method = 'direct_visual_internal'`
- standard fact-bearing fields

Indexes:
- partial unique on `slug WHERE is_retired = false` (per §4 intro)
- `observable_properties_component_id_idx` on `component_id`
- `observable_properties_active_idx` on `component_id WHERE is_retired = false` (partial)

RLS: none.

**OBSERVABILITY HALT query shape** (executed by Prompt 3 / the orchestration layer when generating a diagnostic):

```sql
SELECT * FROM observable_properties
WHERE component_id = $component
  AND observation_method = 'direct_visual_internal'
  AND (housing_opacity_status IS NULL OR housing_opacity_status = 'unknown')
  AND is_retired = false;
```

Any row returned triggers the HALT for a test that depends on this property. The "opacity required" semantic is derived from `observation_method`, not stored as a separate flag.

### 4.5 `symptoms`

DTCs and customer concerns.

Columns:
- `id` UUID PK
- `slug` text unique — e.g., `"p0087-fuel-rail-pressure-too-low"`, `"no-start-cranks-normally"`
- `description` text NOT NULL
- `category` text NOT NULL — enum: `'dtc' | 'performance' | 'no-start' | 'drivability' | 'noise-vibration' | 'electrical' | 'other'`
- `created_at`, `updated_at` standard

Indexes:
- unique on `slug`
- `symptoms_category_idx` on `category`

RLS: none.

Note: symptoms are not "fact-bearing" in the same sense — they're identifiers for triggers, not asserted facts. No `source_provenance` / `inference_class` / `is_retired` columns.

### 4.6 `test_actions`

Atomic tests against a component. The fundamental unit of a diagnostic.

Columns:
- `id` UUID PK
- `slug` text NOT NULL
- `component_id` UUID NOT NULL → `components.id` ON DELETE CASCADE
- `description` text NOT NULL — e.g., `"Back-probe FRP signal pin at idle"`
- `scenario_required` text NOT NULL — enum: `'key-off' | 'key-on' | 'cranking' | 'idle' | 'medium-load' | 'heavy-load' | 'hot-soak' | 'none'`
- `observation_method` text NOT NULL — same enum as `observable_properties.observation_method`; routes the test to its layout family (METER, SCOPE, GAUGE, SCAN TOOL)
- `meter_mode` text NULL — e.g., `"DC V"`, `"Hz"`, `"duty cycle"`
- `expected_value` real NULL
- `expected_unit` text NULL
- `expected_tolerance` real NULL
- `expected_observation` text NULL — for non-numeric tests
- `invasiveness` integer NOT NULL — CHECK (invasiveness BETWEEN 1 AND 5)
- `confidence_boost` real NOT NULL DEFAULT 0 — cumulative-confidence increment when the test returns `ok`. CHECK (`confidence_boost BETWEEN 0 AND 100`).
- `source_citation` text NULL — free-text reference to the architecture_fact or observable_property the expected value derives from (mirrors graph-schema.md's `source_citation` field)
- standard fact-bearing fields

Indexes:
- partial unique on `slug WHERE is_retired = false` (per §4 intro)
- `test_actions_component_id_idx` on `component_id`
- `test_actions_active_idx` on `component_id WHERE is_retired = false` (partial)

RLS: none.

### 4.7 `branch_logic`

Decision rules that fire on a test result.

Columns:
- `id` UUID PK
- `slug` text NOT NULL
- `test_action_id` UUID NOT NULL → `test_actions.id` ON DELETE CASCADE
- `condition` text NOT NULL — e.g., `"reading > 5.25V"`
- `verdict` text NOT NULL — enum: `'ok' | 'warn' | 'fail' | 'impossible'`
- `next_action` text NOT NULL — free-text instruction for the tech
- `routes_to_test_action_id` UUID NULL → `test_actions.id` ON DELETE SET NULL — null for terminal halts; if the routed-to test is later deleted, this becomes null (branch becomes terminal)
- `reasoning` text NULL — the `LAW` / `LOGIC` reflected by the condition
- standard fact-bearing fields

Indexes:
- partial unique on `slug WHERE is_retired = false` (per §4 intro)
- `branch_logic_test_action_id_idx` on `test_action_id`
- `branch_logic_routes_to_idx` on `routes_to_test_action_id`
- `branch_logic_active_idx` on `test_action_id WHERE is_retired = false` (partial)

RLS: none.

### 4.8 `tech_outcomes`

What a tech measured when running a test. The unit of field-data accumulation.

Columns:
- `id` UUID PK
- `test_action_id` UUID NOT NULL → `test_actions.id` ON DELETE RESTRICT (outcomes are valuable field data; never lose them to a test row delete — tests are retired, not deleted)
- `session_id` UUID NOT NULL → `diagnostic_sessions.id` ON DELETE RESTRICT (outcomes survive even if a session is later deleted — the field-data accumulation is shop-shared and outlives individual sessions; sessions in Phase 1 aren't deleted in normal flow)
- `shop_id` UUID NOT NULL → `shops.id` ON DELETE RESTRICT (attribution; if a shop is hard-deleted, blocks the delete rather than losing outcomes — recovery path: detach outcomes manually first)
- `tech_id` UUID NOT NULL → `profiles.id` ON DELETE RESTRICT (attribution; same logic as shop_id; required, not nullable as in graph-schema.md)
- `measured_value` real NULL
- `measured_unit` text NULL
- `measured_observation` text NULL
- `verdict` text NOT NULL — enum: `'ok' | 'warn' | 'fail' | 'impossible'`
- `recorded_at` timestamp NOT NULL DEFAULT NOW()

Constraints:
- CHECK (`measured_value` IS NOT NULL OR `measured_observation` IS NOT NULL) — at least one shape recorded.

Indexes:
- `tech_outcomes_test_action_id_idx` on `test_action_id`
- `tech_outcomes_session_id_idx` on `session_id`
- `tech_outcomes_shop_id_idx` on `shop_id`
- `tech_outcomes_recorded_at_idx` on `recorded_at`

RLS (hand-written in the migration, per §8 step 4):

```sql
ALTER TABLE tech_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tech_outcomes_insert_own_shop
  ON tech_outcomes FOR INSERT
  TO authenticated
  WITH CHECK (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY tech_outcomes_update_own_shop
  ON tech_outcomes FOR UPDATE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY tech_outcomes_delete_own_shop
  ON tech_outcomes FOR DELETE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY tech_outcomes_select_all
  ON tech_outcomes FOR SELECT
  TO authenticated
  USING (true);
```

The SELECT-all policy lets aggregate queries (`avg(measured_value)`, counts) compute across all shops; the API/UI layer is responsible for not surfacing individual rows with `shop_id`/`tech_id` to other shops.

### 4.9 `diagnostic_sessions`

A complete diagnostic run by one tech.

Columns:
- `id` UUID PK
- `vehicle_id` UUID NOT NULL → `vehicles.id` ON DELETE RESTRICT (sessions are work records; don't disappear if a vehicle row is deleted)
- `symptom_id` UUID NOT NULL → `symptoms.id` ON DELETE RESTRICT (sessions reference the symptom they targeted; symptom rows are stable identifiers, deletion is unusual)
- `shop_id` UUID NOT NULL → `shops.id` ON DELETE CASCADE (a shop's sessions are shop-private content; cleanup follows shop deletion, matching the `customers` → `shops` pattern in `lib/db/schema.ts`)
- `tech_id` UUID NOT NULL → `profiles.id` ON DELETE RESTRICT (matches the existing `sessions.tech_id` convention)
- `started_at` timestamp NOT NULL DEFAULT NOW()
- `completed_at` timestamp NULL
- `final_verdict` text NULL — enum: `'commit-allowed' | 'commit-refused' | 'incomplete'`
- `resolved_component_id` UUID NULL → `components.id` ON DELETE SET NULL — what was actually replaced/repaired when `final_verdict = 'commit-allowed'`; if the component is later deleted, this becomes null (session record survives without its resolution pointer)
- `cumulative_confidence` real NOT NULL DEFAULT 0 — CHECK (`cumulative_confidence BETWEEN 0 AND 100`). Application layer is responsible for clamping at 100 when accumulating `confidence_boost` values.

Indexes:
- `diagnostic_sessions_vehicle_id_idx` on `vehicle_id`
- `diagnostic_sessions_symptom_id_idx` on `symptom_id`
- `diagnostic_sessions_shop_id_idx` on `shop_id`
- `diagnostic_sessions_started_at_idx` on `started_at`

RLS: identical posture to `tech_outcomes` — four hand-written policies (insert/update/delete own-shop, select all authenticated). SQL is the same shape; substitute the table name and re-create the four policies on `diagnostic_sessions`.

---

## 5. Tables — junction relationships (3)

### 5.1 `component_connections`

CONNECTS_TO + REPORTS_TO + CONTROLLED_BY consolidated via `connection_kind`.

Columns:
- `id` UUID PK
- `from_component_id` UUID NOT NULL → `components.id` ON DELETE CASCADE
- `to_component_id` UUID NOT NULL → `components.id` ON DELETE CASCADE
- `connection_kind` text NOT NULL — enum: `'electrical-wire' | 'fluid-line' | 'mechanical-linkage' | 'can-bus' | 'lin-bus' | 'reports_to' | 'controlled_by'`
- `direction` text NOT NULL DEFAULT `'unidirectional'` — enum: `'unidirectional' | 'bidirectional'`
- `description` text NULL
- standard fact-bearing fields

Constraints:
- UNIQUE (`from_component_id`, `to_component_id`, `connection_kind`) WHERE `is_retired = false` (partial unique index)
- CHECK (`from_component_id <> to_component_id`)

Indexes:
- `component_connections_from_idx` on `from_component_id`
- `component_connections_to_idx` on `to_component_id`
- `component_connections_kind_idx` on `connection_kind`

RLS: none.

### 5.2 `symptom_test_implications`

Which tests get triggered by which symptoms, plus diagnostic priority.

Columns:
- `id` UUID PK
- `symptom_id` UUID NOT NULL → `symptoms.id` ON DELETE CASCADE
- `test_action_id` UUID NOT NULL → `test_actions.id` ON DELETE CASCADE
- `priority` integer NOT NULL — suggested range 1–10, higher = earlier in the diagnostic sequence. CHECK (`priority BETWEEN 1 AND 10`).
- standard fact-bearing fields

Constraints:
- UNIQUE (`symptom_id`, `test_action_id`) WHERE `is_retired = false` (partial unique index)

Indexes:
- `symptom_test_implications_symptom_priority_idx` on `(symptom_id, priority DESC)`
- `symptom_test_implications_test_action_id_idx` on `test_action_id`

RLS: none.

### 5.3 `platform_equivalents`

"Platform A is equivalent to Platform B for system X."

Columns:
- `id` UUID PK
- `platform_a_id` UUID NOT NULL → `platforms.id` ON DELETE CASCADE
- `platform_b_id` UUID NOT NULL → `platforms.id` ON DELETE CASCADE
- `system` text NOT NULL — enum: `'fuel' | 'fuel-injection' | 'air-induction' | 'aftertreatment' | 'turbo' | 'egr' | 'cooling' | 'electrical' | 'transmission' | 'driveline' | 'hvac' | 'brakes' | 'steering' | 'engine-mechanical'`
- `verdict` text NOT NULL — enum: `'FULLY' | 'PARTIALLY' | 'NOT' | 'INSUFFICIENT'`
- `verdict_reasoning` text NULL — free-text explanation from Prompt 4A
- `source_provenance` text NOT NULL
- `is_retired` boolean NOT NULL DEFAULT false
- `replaced_by_id` UUID NULL → `platform_equivalents.id` ON DELETE SET NULL
- `created_at`, `updated_at` standard

Constraints:
- CHECK (`platform_a_id < platform_b_id`) — canonical ordering for bidirectional storage (Postgres compares UUIDs lexicographically by their text representation)
- UNIQUE (`platform_a_id`, `platform_b_id`, `system`) WHERE `is_retired = false` (partial unique index, hand-written per §8 step 4)

**Operational requirement:** before INSERT, application code must reorder the two platform IDs so the smaller is `platform_a_id`. Otherwise the CHECK fails. Helper shape: `function canonicalPair(a, b) { return a < b ? [a, b] : [b, a] }`. Queries that look up "is X equivalent to Y for system Z" must check both orderings:
```sql
WHERE system = Z
  AND ((platform_a_id = X AND platform_b_id = Y)
       OR (platform_a_id = Y AND platform_b_id = X))
  AND is_retired = false
```

Indexes:
- `platform_equivalents_a_system_idx` on `(platform_a_id, system)`
- `platform_equivalents_b_system_idx` on `(platform_b_id, system)`

RLS: none.

---

## 6. Source-tagging system

Which tables carry which columns (✓ = present, — = not applicable):

| Table | `source_provenance` | `inference_class` | `is_retired` | `replaced_by_id` |
|---|---|---|---|---|
| `platforms` | — | — | — | — |
| `architecture_facts` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `components` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `observable_properties` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `symptoms` | — | — | — | — |
| `test_actions` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `branch_logic` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `tech_outcomes` | — | — | — | — |
| `diagnostic_sessions` | — | — | — | — |
| `component_connections` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `symptom_test_implications` | ✓ | ✓ (nullable) | ✓ | ✓ |
| `platform_equivalents` | ✓ | — | ✓ | ✓ |

`source_provenance` text NOT NULL, with CHECK constraint:
- `'TRAINING-CONFIRMED'` — AI confident from training data
- `'TRAINING-INFERRED'` — AI inferred from patterns
- `'FIELD-VERIFIED'` — confirmed by a tech in the shop (highest authority)
- `'GAP'` — explicit acknowledgment of missing data (load-bearing for OBSERVABILITY HALT)

`inference_class` text NULL, with CHECK constraint:
- `'LAW'` — physics-grounded
- `'LOGIC'` — architecture-derived
- `'PATTERN'` — typical observation; must be confirmed for the specific case
- NULL — direct-stated fact (no inference involved)

**Why GAPs are stored as rows, not absences:** the `OBSERVABILITY HALT` in Prompt 3 fires when an `observable_properties` row has `housing_opacity_status = NULL` (or `'unknown'`) but a test depends on `opacity_required = true`. If GAPs weren't stored as rows, the halt couldn't fire — see Fix #2 in the validation report.

**Retirement pattern:** when a fact is corrected (e.g., a `GAP` flips to `FIELD-VERIFIED`):
1. Insert a new row with the corrected value and `source_provenance = 'FIELD-VERIFIED'`.
2. Update the old row: set `is_retired = true`, `replaced_by_id` = new row's id.
3. The history is preserved in the table itself via retired rows. No separate audit table.

This matches the existing `corpus_entries` retirement convention (`is_retired` flag + `entry_source` updates).

---

## 7. Column additions to existing tables

### 7.1 `vehicles`

Add `platform_id UUID NULL` → `platforms.id` ON DELETE SET NULL.

Existing rows backfill to NULL. New rows populate during intake when the platform is identified — via lookup by year+make+model+engine (existing rows known to map to seeded platforms) or via Prompt 1 resolution (new platforms).

Index: `vehicles_platform_id_idx` on `platform_id`.

---

## 8. Migration plan

1. Edit `lib/db/schema.ts` to add the 12 new table definitions and the `vehicles.platform_id` column. Also add `relations()` exports for the new tables, matching the existing convention (see `sessionsRelations`, `corpusEntriesRelations` in `lib/db/schema.ts` for the pattern). Default to inline addition; if `schema.ts` exceeds ~1000 lines after the addition, split into `lib/db/schema/diagnostic-graph.ts` and re-export from `schema.ts` so `drizzle.config.ts`'s `schema: './lib/db/schema.ts'` entry stays valid.
2. Run `pnpm drizzle-kit generate` to produce the migration SQL at `drizzle/migrations/0017_<auto_name>.sql`.
3. Inspect generated SQL: verify constraints, partial indexes, and FK cascades match the spec. Drizzle-kit produces most of the DDL correctly; manual review catches anywhere the TypeScript schema didn't translate.
4. Append hand-written DDL for items Drizzle doesn't manage:
   - **RLS policies:** `ALTER TABLE tech_outcomes ENABLE ROW LEVEL SECURITY;` + four `CREATE POLICY` statements (per §4.8). Same for `diagnostic_sessions` (per §4.9).
   - **Partial unique indexes** (`CREATE UNIQUE INDEX ... WHERE is_retired = false`):
     - One per fact-bearing node table on `slug`: `architecture_facts`, `components`, `observable_properties`, `test_actions`, `branch_logic` (5 indexes).
     - One per junction table on its natural identity tuple: `component_connections (from_component_id, to_component_id, connection_kind)`, `symptom_test_implications (symptom_id, test_action_id)`, `platform_equivalents (platform_a_id, platform_b_id, system)` (3 indexes).
   - **Partial indexes on `is_retired = false` for active-row lookups:** per-table `<table>_active_idx` (already noted in each table's Indexes list).
   - **CHECK constraints:**
     - Retirement invariant: `CHECK (replaced_by_id IS NULL OR is_retired = true)` on every fact-bearing table (8 tables).
     - Range constraints: `test_actions.invasiveness BETWEEN 1 AND 5`, `test_actions.confidence_boost BETWEEN 0 AND 100`, `diagnostic_sessions.cumulative_confidence BETWEEN 0 AND 100`, `symptom_test_implications.priority BETWEEN 1 AND 10`.
     - Value-shape constraints: `tech_outcomes` requires either `measured_value` or `measured_observation` to be non-null; `component_connections.from_component_id <> to_component_id`; `platform_equivalents.platform_a_id < platform_b_id`.
5. Rehearse on `vyntechs_rehearsal` local DB:
   - Apply via `psql -d vyntechs_rehearsal -f drizzle/migrations/0017_*.sql`
   - Verify `\dt` shows new tables, `\d+ <table>` shows expected shape, RLS policies present (`\d+ tech_outcomes` should list the four policies)
   - **FK cascade tests:** insert sample rows; verify cascade behaviors match the spec (e.g., deleting a `platforms` row cascades to its `architecture_facts`; deleting a `diagnostic_sessions` row is RESTRICTED if `tech_outcomes` reference it)
   - **CHECK constraint tests:** verify rejected inputs fail (`priority = 100` on `symptom_test_implications` → fails; `confidence_boost = -5` on `test_actions` → fails; `invasiveness = 7` on `test_actions` → fails; `cumulative_confidence = 150` on `diagnostic_sessions` → fails)
   - **Retirement invariant test:** INSERT an active row (`is_retired = false`) with a non-null `replaced_by_id` → fails
   - **Partial-unique-index test:** insert two `is_retired = false` rows with same slug → fails; retire the first then re-insert → succeeds; insert one with `is_retired = true` + one with `is_retired = false` and same slug → succeeds
   - **RLS testing is NOT performed locally.** Local Postgres has no `auth.uid()` context. Verify SQL parses without errors (policies attach to the tables) locally; functional RLS verification happens post-apply against live in step 8.
6. Surface migration SQL + rehearsal log to Brandon for **per-op approval** (per `feedback_no_dangerous_prod_ops`).
7. After approval, apply to live Supabase via Supabase MCP `apply_migration`.
8. Post-apply verification:
   - Run MCP `get_advisors`. Fix any new lints (unindexed FKs, missing RLS) before declaring Phase 1 done.
   - **Functional RLS check** (live DB, since branching is parked per `project_db_branching_parked`): as Brandon's authenticated session, INSERT a `tech_outcomes` row with the correct `shop_id` → succeeds. INSERT with a fake `shop_id` not matching the caller's profile → fails. SELECT from another shop's perspective — verify aggregate queries (counts, averages) still work but individual rows are not exposed. Roll back the test inserts via `BEGIN; ...; ROLLBACK;` envelope so live data isn't polluted.

---

## 9. Phase 2 exit criteria (what unlocks Phase 3)

Phase 2 is "manually exercise the chain end-to-end against the live database." All five runs must complete cleanly:

1. **Cold-start orchestration** for 2018 F-250 6.7L PSD + P0087: prompts run sequentially, ~115 rows land across the 12 tables, vetted by Brandon between Prompts 1 and 2.
2. **Reuse on new symptom** for 2018 F-250 + P0088: Prompts 1 and 2 skip (platform/components already exist); Prompt 3 writes ~10 new rows; the rest are reused.
3. **Third symptom** for 2018 F-250 + no-start cranks normally: same skip pattern as #2.
4. **Cross-platform equivalence** for 2019 F-350 + P0087: zero new rows; cached test sequence served via `platform_equivalents` lookup.
5. **Real-tech session**: a tech runs the cached diagnostic, records `tech_outcomes` rows, flips at least one `observable_properties` GAP to FIELD-VERIFIED via the retirement pattern.

When all five pass, Phase 3 (Claude Code skill wrapper) is unblocked.

---

## 10. Parked decisions (defer to Phase 2 or later)

- **`tech_outcomes` SELECT policy details:** for now, allow all authenticated. Revisit once a second shop is in production and we need to lock down what aggregate queries return.
- **Denormalized field-outcome stats on `test_actions`:** the design package's queries compute `avg(measured_value)` and `stdev` on demand. If query performance becomes an issue at scale, add denormalized columns and update via triggers.
- **`provenance_history` audit table:** retirement pattern preserves history via retired rows. Dedicated history table is a future optimization.
- **Application-layer mapping from `vehicles` to `platforms`:** Phase 2 hand-sets `vehicles.platform_id`. A general lookup/inference layer is Phase 3+ work.
- **Per-field provenance on `components`:** a single component row currently carries one `source_provenance` for the whole entity (name, kind, location, function, electrical_contract). If a future requirement needs "location is FIELD-VERIFIED but electrical_contract is still TRAINING-INFERRED" granularity, factor each property into an `observable_properties` row.
- **Structured `source_citation` on `test_actions`:** today it's free-text. A future refactor could make it a FK to the originating `architecture_facts` or `observable_properties` row so "find all tests citing this fact" becomes a normal join.
- **Multi-wire `component_connections` between the same pair:** the current `UNIQUE (from_component_id, to_component_id, connection_kind)` blocks multiple connections of the same kind between the same component pair (e.g., two electrical wires between the FRP sensor and the PCM for different signals). If this becomes a real-world need, add a distinguishing column (e.g., `pin_pair_label`) to the uniqueness key.

---

## 11. Validation references

- All 4 prompts cold-context validated 2026-05-19 across 5+ test cases per prompt covering Ford, GM, and Dodge diesel platforms. See `docs/interactive-diagnostics/validation-2026-05-19-orchestration.md`.
- Two architectural fixes applied during validation are baked into this schema:
  - **Fix 1 (Prompt 1 closing-line count):** affects Prompt 1's output formatting, not the schema. No-op here.
  - **Fix 2 (Prompt 2 opacity-not-stated = GAP):** load-bearing for the schema. `observable_properties.housing_opacity_status = NULL` / `'unknown'` is the row state that triggers OBSERVABILITY HALT in Prompt 3. The halt query filters by `observation_method = 'direct_visual_internal'` (see §4.4) to target only opacity-dependent rows — the opacity requirement is derived from the observation method, not stored as a separate flag.
