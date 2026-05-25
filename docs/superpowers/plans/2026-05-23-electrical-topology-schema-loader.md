# Interactive Electrical Topology · PR-C/A · Schema + Seed + Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data foundation for the interactive electrical topology — additive schema, fuel-system seed data on the 6.7L Power Stroke, and an extended `loadSystemTopology` that returns pins + electrical wire roles + scenarios + per-pin per-scenario readings + captured/missing status. No UI changes in this PR.

**Architecture:** Additive Postgres schema (6 new columns on `components`, 3 new columns on `component_connections`, 1 new column on `sessions`, 5 new tables) hand-written as a migration per [[drizzle-kit-broken-since-0011b]]. Seed data extracted verbatim from Brandon's prototype at `mockups/topology-guidance/round-3-opus/topology.html` and applied as Brandon-reviewed SQL. Drizzle schema updated to match. `loadSystemTopology` extended to load + assemble the richer graph in a single pure-read path (no AI, no external calls — per the standing structured-first principle).

**Tech Stack:** Postgres (Supabase), Drizzle ORM, PGlite (for unit tests), Vitest, hand-written SQL migrations, Supabase MCP `apply_migration` tool.

**Spec:** `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
**Prototype (seed source):** `mockups/topology-guidance/round-3-opus/topology.html`
**Branch:** `feat/topology-guided-walk` (branch name predates the framing change; concept underneath is "interactive electrical topology"). Cut from `staging-interactive-diagnostics` post-PR-#89.

---

## File Structure

### Created files
| File | Responsibility |
|---|---|
| `drizzle/migrations/0020_interactive_electrical_topology.sql` | Additive schema migration (6 column additions + 5 new tables + 1 session column) |
| `drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql` | Seed data extracted from prototype: components prose, pins, connection electrical role + pin endpoints, scenarios, wire-state matrix, pin readings, system_data_status row for fuel |

### Modified files
| File | Change |
|---|---|
| `lib/db/schema.ts` | Add Drizzle types for 5 new tables + 6+3+1 column additions + relations |
| `lib/diagnostics/load-system-topology.ts` | Extend `SystemTopology` return type and assembly logic |
| `tests/unit/load-system-topology.test.ts` (if exists; otherwise `lib/diagnostics/__tests__/`) | Extend coverage for pins, electrical role, scenarios, readings, system_data_status |

### Unchanged (explicit)
- `lib/diagnostics/topology-layout.ts` — dagre layout, still pure
- `components/topology/*` — no UI changes in PR-C/A
- `components/screens/topology-diagnostic.tsx` — no UI changes
- The intake / platform resolver / cache-hit routing path

---

## Task 1: Hand-write the migration SQL

**Files:**
- Create: `drizzle/migrations/0020_interactive_electrical_topology.sql`

- [ ] **Step 1: Draft the full migration SQL.**

Create the file with the following exact content:

```sql
-- 0020_interactive_electrical_topology.sql
-- Spec: docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md
-- Additive — no column drops, no type changes on existing columns.

-- ============================================================
-- 1. components — six new prose columns for the panel body
-- ============================================================
ALTER TABLE components ADD COLUMN subtitle text;
ALTER TABLE components ADD COLUMN role text;
ALTER TABLE components ADD COLUMN wire_summary text;
ALTER TABLE components ADD COLUMN body text;
ALTER TABLE components ADD COLUMN probing_tactic text;
ALTER TABLE components ADD COLUMN unknown_note text;

-- ============================================================
-- 2. component_pins — new table; one row per pin per component
-- ============================================================
CREATE TYPE pin_edge AS ENUM ('top', 'right', 'bottom', 'left');

CREATE TABLE component_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  name text NOT NULL,
  role_abbreviation text NOT NULL,
  pin_number text,
  edge pin_edge NOT NULL,
  display_order integer NOT NULL,
  probe_location text NOT NULL,
  expected_reading text NOT NULL,
  missing_logic text NOT NULL,
  label_gap text,
  source_provenance text NOT NULL DEFAULT 'TRAINING-CONFIRMED',
  is_retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (component_id, slug)
);

CREATE INDEX component_pins_component_id_idx ON component_pins(component_id) WHERE is_retired = false;

-- ============================================================
-- 3. component_connections — electrical role + pin endpoints
-- ============================================================
CREATE TYPE electrical_role AS ENUM ('signal', '5v-ref', 'low-ref', 'pwm', '12v', 'ground');

ALTER TABLE component_connections ADD COLUMN electrical_role electrical_role;
ALTER TABLE component_connections ADD COLUMN from_pin_id uuid REFERENCES component_pins(id) ON DELETE SET NULL;
ALTER TABLE component_connections ADD COLUMN to_pin_id uuid REFERENCES component_pins(id) ON DELETE SET NULL;

-- ============================================================
-- 4. system_scenarios — operational + fault scenarios per (platform, system)
-- ============================================================
CREATE TYPE scenario_kind AS ENUM ('operation', 'fault');
CREATE TYPE key_position AS ENUM ('off', 'on');
CREATE TYPE engine_state AS ENUM ('off', 'running');
CREATE TYPE load_level AS ENUM ('idle', 'light', 'medium', 'heavy');

CREATE TABLE system_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  platform_id uuid NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  system text NOT NULL,
  label text NOT NULL,
  sub text NOT NULL,
  kind scenario_kind NOT NULL,
  key_position key_position,
  engine_state engine_state,
  load_level load_level,
  is_default boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  is_retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_id, system, slug)
);

CREATE UNIQUE INDEX system_scenarios_one_default_per_slice_idx
  ON system_scenarios(platform_id, system)
  WHERE is_default = true AND is_retired = false;

CREATE INDEX system_scenarios_lookup_idx
  ON system_scenarios(platform_id, system)
  WHERE is_retired = false;

-- ============================================================
-- 5. scenario_wire_states — per-pin per-scenario wire animation state
-- ============================================================
CREATE TYPE wire_state AS ENUM (
  'off',
  'steady-12v', 'steady-5v', 'steady-gnd',
  'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
  'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max'
);

CREATE TABLE scenario_wire_states (
  scenario_id uuid NOT NULL REFERENCES system_scenarios(id) ON DELETE CASCADE,
  pin_id uuid NOT NULL REFERENCES component_pins(id) ON DELETE CASCADE,
  wire_state wire_state NOT NULL,
  PRIMARY KEY (scenario_id, pin_id)
);

CREATE INDEX scenario_wire_states_scenario_idx ON scenario_wire_states(scenario_id);

-- ============================================================
-- 6. pin_scenario_readings — the "right now" reading per (pin, scenario)
-- ============================================================
CREATE TABLE pin_scenario_readings (
  pin_id uuid NOT NULL REFERENCES component_pins(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES system_scenarios(id) ON DELETE CASCADE,
  reading text NOT NULL,
  PRIMARY KEY (pin_id, scenario_id)
);

CREATE INDEX pin_scenario_readings_pin_idx ON pin_scenario_readings(pin_id);

-- ============================================================
-- 7. system_data_status — captured/missing footer hybrid framing
--    (the framing wrapper; the bullet rows are derived from data)
-- ============================================================
CREATE TABLE system_data_status (
  platform_id uuid NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  system text NOT NULL,
  captured_header text NOT NULL,
  missing_header text NOT NULL,
  closing_note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_id, system)
);

-- ============================================================
-- 8. sessions — persist the last-picked scenario per session
-- ============================================================
ALTER TABLE sessions ADD COLUMN last_scenario_slug text;
```

- [ ] **Step 2: Eyeball-review the SQL against the spec.**

Cross-check the file against spec §7.0–§7.6 and the `system_scenarios` field list in §7.3 (which includes the compositional metadata columns `keyPosition`, `engineState`, `loadLevel`, `kind`). Every spec field should be present with the right type + nullability + default + constraint.

- [ ] **Step 3: Commit.**

```bash
git add drizzle/migrations/0020_interactive_electrical_topology.sql
git commit -m "feat(db): migration for interactive electrical topology schema"
```

---

## Task 2: Rehearse the migration on the local vyntechs_rehearsal database

**Files:** none modified; this is operational.

- [ ] **Step 1: Verify the local rehearsal DB is current with prod schema.**

```bash
psql vyntechs_rehearsal -c "SELECT MAX(name) FROM drizzle.__drizzle_migrations;"
```

Expected: should show `0019_component_systems` as the most recent migration. If it's behind, refresh from a fresh `pg_dump` against the prod pooler URL per `[[reference_local_rehearsal_db]]` before proceeding.

- [ ] **Step 2: Apply 0020 to the rehearsal DB.**

```bash
psql vyntechs_rehearsal -f drizzle/migrations/0020_interactive_electrical_topology.sql
```

Expected: every statement returns `ALTER TABLE` / `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` with no errors.

- [ ] **Step 3: Verify the resulting schema.**

```bash
psql vyntechs_rehearsal -c "\d component_pins"
psql vyntechs_rehearsal -c "\d system_scenarios"
psql vyntechs_rehearsal -c "\d scenario_wire_states"
psql vyntechs_rehearsal -c "\d pin_scenario_readings"
psql vyntechs_rehearsal -c "\d system_data_status"
psql vyntechs_rehearsal -c "\d components" | grep -E "subtitle|role|wire_summary|body|probing_tactic|unknown_note"
psql vyntechs_rehearsal -c "\d component_connections" | grep -E "electrical_role|from_pin_id|to_pin_id"
psql vyntechs_rehearsal -c "\d sessions" | grep last_scenario_slug
```

Expected: every column / table / FK / index shows the expected structure.

- [ ] **Step 4: Verify the one-default-per-slice constraint is enforceable.**

```bash
psql vyntechs_rehearsal <<'SQL'
BEGIN;
INSERT INTO system_scenarios (slug, platform_id, system, label, sub, kind, is_default)
VALUES
  ('test-1', (SELECT id FROM platforms LIMIT 1), 'fuel', 'A', 'a', 'operation', true),
  ('test-2', (SELECT id FROM platforms LIMIT 1), 'fuel', 'B', 'b', 'operation', true);
ROLLBACK;
SQL
```

Expected: the second `INSERT` fails with a unique-index violation on `system_scenarios_one_default_per_slice_idx`. If it succeeds, the partial unique index is wrong — fix the migration and re-rehearse.

- [ ] **Step 5: No commit needed — operational step only.**

---

## Task 3: Apply the migration to live Supabase (Brandon-approved)

**Files:** none modified.

> ⚠ **Live-DB write — requires per-op Brandon approval per [[no-dangerous-prod-ops]].** Do not skip the approval step.

- [ ] **Step 1: Surface the migration to Brandon for approval.**

Show the full content of `drizzle/migrations/0020_interactive_electrical_topology.sql` in chat. Explicitly ask: *"Approve apply to live Supabase via MCP? This adds 5 tables, 9 columns, 5 enums — all additive, no data loss possible."* Wait for explicit "yes."

- [ ] **Step 2: Apply via Supabase MCP `apply_migration` tool.**

```
mcp__plugin_supabase_supabase__apply_migration(
  project_id: "ynmtszuybeenjbigxdyl",
  name: "0020_interactive_electrical_topology",
  query: <full migration SQL>
)
```

Expected: success response.

- [ ] **Step 3: Verify live schema using a quick query.**

```
mcp__plugin_supabase_supabase__execute_sql(
  project_id: "ynmtszuybeenjbigxdyl",
  query: "SELECT column_name FROM information_schema.columns WHERE table_name = 'components' AND column_name IN ('subtitle','role','wire_summary','body','probing_tactic','unknown_note') ORDER BY column_name;"
)
```

Expected: all 6 columns returned.

- [ ] **Step 4: Commit nothing — migration is now both in the repo and live. (No verification commit needed.)**

---

## Task 4: Add Drizzle schema types for the new tables and columns

**Files:**
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Add the enum types at the top of the file (after existing pgEnum imports).**

```ts
import { pgEnum } from 'drizzle-orm/pg-core'

export const pinEdgeEnum = pgEnum('pin_edge', ['top', 'right', 'bottom', 'left'])
export const electricalRoleEnum = pgEnum('electrical_role', [
  'signal', '5v-ref', 'low-ref', 'pwm', '12v', 'ground',
])
export const scenarioKindEnum = pgEnum('scenario_kind', ['operation', 'fault'])
export const keyPositionEnum = pgEnum('key_position', ['off', 'on'])
export const engineStateEnum = pgEnum('engine_state', ['off', 'running'])
export const loadLevelEnum = pgEnum('load_level', ['idle', 'light', 'medium', 'heavy'])
export const wireStateEnum = pgEnum('wire_state', [
  'off',
  'steady-12v', 'steady-5v', 'steady-gnd',
  'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
  'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max',
])
```

(If the file already imports `pgEnum`, don't re-import — add the enum exports only.)

- [ ] **Step 2: Extend the existing `components` table definition.**

Add these column lines to the existing `pgTable('components', { ... })` block (next to the other text columns):

```ts
  subtitle: text('subtitle'),
  role: text('role'),
  wireSummary: text('wire_summary'),
  body: text('body'),
  probingTactic: text('probing_tactic'),
  unknownNote: text('unknown_note'),
```

- [ ] **Step 3: Extend the existing `componentConnections` table definition.**

Add these column lines to the existing `pgTable('component_connections', { ... })` block:

```ts
  electricalRole: electricalRoleEnum('electrical_role'),
  fromPinId: uuid('from_pin_id'),
  toPinId: uuid('to_pin_id'),
```

- [ ] **Step 4: Extend the existing `sessions` table definition.**

Add this column line:

```ts
  lastScenarioSlug: text('last_scenario_slug'),
```

- [ ] **Step 5: Define `componentPins` table.**

Add a new export (place near the other topology tables — after `componentConnections`):

```ts
export const componentPins = pgTable(
  'component_pins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => components.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    roleAbbreviation: text('role_abbreviation').notNull(),
    pinNumber: text('pin_number'),
    edge: pinEdgeEnum('edge').notNull(),
    displayOrder: integer('display_order').notNull(),
    probeLocation: text('probe_location').notNull(),
    expectedReading: text('expected_reading').notNull(),
    missingLogic: text('missing_logic').notNull(),
    labelGap: text('label_gap'),
    sourceProvenance: text('source_provenance').notNull().default('TRAINING-CONFIRMED'),
    isRetired: boolean('is_retired').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueComponentSlug: unique().on(t.componentId, t.slug),
  }),
)
```

- [ ] **Step 6: Define `systemScenarios` table.**

```ts
export const systemScenarios = pgTable(
  'system_scenarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    platformId: uuid('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    system: text('system').notNull(),
    label: text('label').notNull(),
    sub: text('sub').notNull(),
    kind: scenarioKindEnum('kind').notNull(),
    keyPosition: keyPositionEnum('key_position'),
    engineState: engineStateEnum('engine_state'),
    loadLevel: loadLevelEnum('load_level'),
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    isRetired: boolean('is_retired').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueSlug: unique().on(t.platformId, t.system, t.slug),
  }),
)
```

- [ ] **Step 7: Define `scenarioWireStates` table.**

```ts
export const scenarioWireStates = pgTable(
  'scenario_wire_states',
  {
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => systemScenarios.id, { onDelete: 'cascade' }),
    pinId: uuid('pin_id')
      .notNull()
      .references(() => componentPins.id, { onDelete: 'cascade' }),
    wireState: wireStateEnum('wire_state').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scenarioId, t.pinId] }),
  }),
)
```

- [ ] **Step 8: Define `pinScenarioReadings` table.**

```ts
export const pinScenarioReadings = pgTable(
  'pin_scenario_readings',
  {
    pinId: uuid('pin_id')
      .notNull()
      .references(() => componentPins.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => systemScenarios.id, { onDelete: 'cascade' }),
    reading: text('reading').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pinId, t.scenarioId] }),
  }),
)
```

- [ ] **Step 9: Define `systemDataStatus` table.**

```ts
export const systemDataStatus = pgTable(
  'system_data_status',
  {
    platformId: uuid('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    system: text('system').notNull(),
    capturedHeader: text('captured_header').notNull(),
    missingHeader: text('missing_header').notNull(),
    closingNote: text('closing_note').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.platformId, t.system] }),
  }),
)
```

- [ ] **Step 10: Add relations (place near existing relations — after `componentsRelations`).**

```ts
export const componentPinsRelations = relations(componentPins, ({ one }) => ({
  component: one(components, {
    fields: [componentPins.componentId],
    references: [components.id],
  }),
}))

export const systemScenariosRelations = relations(systemScenarios, ({ one, many }) => ({
  platform: one(platforms, {
    fields: [systemScenarios.platformId],
    references: [platforms.id],
  }),
  wireStates: many(scenarioWireStates),
  readings: many(pinScenarioReadings),
}))

export const scenarioWireStatesRelations = relations(scenarioWireStates, ({ one }) => ({
  scenario: one(systemScenarios, {
    fields: [scenarioWireStates.scenarioId],
    references: [systemScenarios.id],
  }),
  pin: one(componentPins, {
    fields: [scenarioWireStates.pinId],
    references: [componentPins.id],
  }),
}))

export const pinScenarioReadingsRelations = relations(pinScenarioReadings, ({ one }) => ({
  pin: one(componentPins, {
    fields: [pinScenarioReadings.pinId],
    references: [componentPins.id],
  }),
  scenario: one(systemScenarios, {
    fields: [pinScenarioReadings.scenarioId],
    references: [systemScenarios.id],
  }),
}))
```

- [ ] **Step 11: Run typecheck to verify the schema is internally consistent.**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 12: Commit.**

```bash
git add lib/db/schema.ts
git commit -m "feat(db): Drizzle schema for interactive electrical topology"
```

---

## Task 5: Extend the loader's public types

**Files:**
- Modify: `lib/diagnostics/load-system-topology.ts`

- [ ] **Step 1: Add new exported types above `TopologyComponent`.**

Place these after the existing `TopologyObservableProperty`, `TopologyBranch`, `TopologyTestAction` exports:

```ts
export type TopologyPin = {
  id: string
  slug: string
  name: string
  roleAbbreviation: string
  pinNumber: string | null
  edge: 'top' | 'right' | 'bottom' | 'left'
  displayOrder: number
  probeLocation: string
  expectedReading: string
  missingLogic: string
  labelGap: string | null
  sourceProvenance: string
}

export type TopologyScenario = {
  id: string
  slug: string
  label: string
  sub: string
  kind: 'operation' | 'fault'
  keyPosition: 'off' | 'on' | null
  engineState: 'off' | 'running' | null
  loadLevel: 'idle' | 'light' | 'medium' | 'heavy' | null
  isDefault: boolean
  displayOrder: number
  /** Map of pinId → wire-state class for this scenario. Missing pin → 'off'. */
  pinStates: Record<string, string>
  /** Map of pinId → "right now" reading text for this scenario. Missing → null. */
  pinReadings: Record<string, string>
}

export type TopologyDataStatus = {
  capturedHeader: string
  missingHeader: string
  closingNote: string
}
```

- [ ] **Step 2: Extend `TopologyComponent` to include pins.**

Add the pins field to the existing `TopologyComponent` type:

```ts
export type TopologyComponent = {
  id: string
  slug: string
  name: string
  kind: string
  location: string | null
  function: string | null
  electricalContract: string | null
  // NEW prose fields (per spec §7.0):
  subtitle: string | null
  role: string | null
  wireSummary: string | null
  body: string | null
  probingTactic: string | null
  unknownNote: string | null
  // existing children + new:
  sourceProvenance: string
  observableProperties: TopologyObservableProperty[]
  testActions: TopologyTestAction[]
  pins: TopologyPin[]
}
```

- [ ] **Step 3: Extend `TopologyConnection` to include electrical role + pin endpoints.**

```ts
export type TopologyConnection = {
  id: string
  fromComponentId: string
  toComponentId: string
  connectionKind: string
  direction: string
  description: string | null
  sourceProvenance: string
  // NEW (per spec §7.2):
  electricalRole: 'signal' | '5v-ref' | 'low-ref' | 'pwm' | '12v' | 'ground' | null
  fromPinId: string | null
  toPinId: string | null
}
```

- [ ] **Step 4: Extend `SystemTopology` with the new top-level fields.**

```ts
export type SystemTopology = {
  platform: { slug: string; name: string }
  symptom: { slug: string; description: string }
  system: string
  components: TopologyComponent[]
  connections: TopologyConnection[]
  // NEW (per spec §7.3 + §7.6):
  scenarios: TopologyScenario[]
  dataStatus: TopologyDataStatus | null
  /** Last-picked scenario slug for the session, if persisted; null otherwise. */
  lastScenarioSlug: string | null
}
```

- [ ] **Step 5: Run typecheck.**

```bash
pnpm tsc --noEmit
```

Expected: errors in `load-system-topology.ts` body (assembly logic doesn't yet build the new fields) and possibly in `topology-detail-panel.tsx` / `topology-diagnostic.tsx` (consumers of `SystemTopology`). The body assembly errors will be fixed in subsequent tasks; consumer errors mean those files use the OLD type. For PR-C/A, consumers shouldn't actually access the new fields (no UI change yet) — but if `tsc` reports errors there, add minimal defaults to keep types passing without behavior change. Fix as needed.

- [ ] **Step 6: Commit.**

```bash
git add lib/diagnostics/load-system-topology.ts
git commit -m "feat(diagnostics): extend SystemTopology types for pins + scenarios"
```

---

## Task 6: Loader implementation — load `component_pins` per component

**Files:**
- Modify: `lib/diagnostics/load-system-topology.ts`

- [ ] **Step 1: Add the import for `componentPins`.**

At the top of the file, extend the import from `@/lib/db/schema`:

```ts
import {
  platforms,
  symptoms,
  components,
  componentConnections,
  observableProperties,
  testActions,
  branchLogic,
  symptomTestImplications,
  componentPins, // NEW
} from '@/lib/db/schema'
```

- [ ] **Step 2: Add the pins query in `loadSystemTopology`, right after the existing observable-properties query (around line 188 after PR-A).**

```ts
  // 6.5. Pins for the in-set components
  const pinRows = await db
    .select({
      id: componentPins.id,
      slug: componentPins.slug,
      componentId: componentPins.componentId,
      name: componentPins.name,
      roleAbbreviation: componentPins.roleAbbreviation,
      pinNumber: componentPins.pinNumber,
      edge: componentPins.edge,
      displayOrder: componentPins.displayOrder,
      probeLocation: componentPins.probeLocation,
      expectedReading: componentPins.expectedReading,
      missingLogic: componentPins.missingLogic,
      labelGap: componentPins.labelGap,
      sourceProvenance: componentPins.sourceProvenance,
    })
    .from(componentPins)
    .where(
      and(
        inArray(componentPins.componentId, componentIds),
        eq(componentPins.isRetired, false),
      ),
    )
```

- [ ] **Step 3: Extend `assembledComponents` to include pins.**

In the `componentRows.map((c) => ({ ... }))` block, add the new prose columns + pins:

```ts
  const assembledComponents: TopologyComponent[] = componentRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    location: c.location,
    function: c.function,
    electricalContract: c.electricalContract,
    // NEW:
    subtitle: c.subtitle,
    role: c.role,
    wireSummary: c.wireSummary,
    body: c.body,
    probingTactic: c.probingTactic,
    unknownNote: c.unknownNote,
    // existing + new:
    sourceProvenance: c.sourceProvenance,
    observableProperties: opRows.filter(/* unchanged */),
    testActions: testActionRows.filter(/* unchanged */).map(/* unchanged */),
    pins: pinRows
      .filter((p) => p.componentId === c.id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        roleAbbreviation: p.roleAbbreviation,
        pinNumber: p.pinNumber,
        edge: p.edge,
        displayOrder: p.displayOrder,
        probeLocation: p.probeLocation,
        expectedReading: p.expectedReading,
        missingLogic: p.missingLogic,
        labelGap: p.labelGap,
        sourceProvenance: p.sourceProvenance,
      })),
  }))
```

- [ ] **Step 4: Update the `componentRows` select to include the new prose columns.**

In the `db.select({ ... }).from(components)` query, add the 6 new column projections:

```ts
  const componentRows = await db
    .select({
      id: components.id,
      slug: components.slug,
      name: components.name,
      kind: components.kind,
      location: components.location,
      function: components.function,
      electricalContract: components.electricalContract,
      sourceProvenance: components.sourceProvenance,
      // NEW:
      subtitle: components.subtitle,
      role: components.role,
      wireSummary: components.wireSummary,
      body: components.body,
      probingTactic: components.probingTactic,
      unknownNote: components.unknownNote,
    })
    .from(components)
    .where(/* unchanged */)
```

- [ ] **Step 5: Run typecheck.**

```bash
pnpm tsc --noEmit
```

Expected: no errors in `load-system-topology.ts`.

- [ ] **Step 6: Commit.**

```bash
git add lib/diagnostics/load-system-topology.ts
git commit -m "feat(diagnostics): load component_pins + new prose columns"
```

---

## Task 7: Loader implementation — load electrical role + pin endpoints on connections

**Files:**
- Modify: `lib/diagnostics/load-system-topology.ts`

- [ ] **Step 1: Extend the connection select to include new fields.**

```ts
  const connectionRows = await db
    .select({
      id: componentConnections.id,
      fromComponentId: componentConnections.fromComponentId,
      toComponentId: componentConnections.toComponentId,
      connectionKind: componentConnections.connectionKind,
      direction: componentConnections.direction,
      description: componentConnections.description,
      sourceProvenance: componentConnections.sourceProvenance,
      // NEW:
      electricalRole: componentConnections.electricalRole,
      fromPinId: componentConnections.fromPinId,
      toPinId: componentConnections.toPinId,
    })
    .from(componentConnections)
    .where(/* unchanged */)
```

The assembly uses `connectionRows` directly into `connections` — no further mapping change needed since the new fields are pass-through.

- [ ] **Step 2: Run typecheck.**

```bash
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add lib/diagnostics/load-system-topology.ts
git commit -m "feat(diagnostics): load electrical role + pin endpoints on connections"
```

---

## Task 8: Loader implementation — load scenarios + wire states + readings

**Files:**
- Modify: `lib/diagnostics/load-system-topology.ts`

- [ ] **Step 1: Extend imports.**

```ts
import {
  // ...existing...
  systemScenarios,
  scenarioWireStates,
  pinScenarioReadings,
  systemDataStatus,
  sessions,
} from '@/lib/db/schema'
```

- [ ] **Step 2: Add the scenarios + wire-states + readings queries (after the test-actions assembly, before the return statement).**

```ts
  // 8. Scenarios for this (platform, system)
  const scenarioRows = await db
    .select({
      id: systemScenarios.id,
      slug: systemScenarios.slug,
      label: systemScenarios.label,
      sub: systemScenarios.sub,
      kind: systemScenarios.kind,
      keyPosition: systemScenarios.keyPosition,
      engineState: systemScenarios.engineState,
      loadLevel: systemScenarios.loadLevel,
      isDefault: systemScenarios.isDefault,
      displayOrder: systemScenarios.displayOrder,
    })
    .from(systemScenarios)
    .where(
      and(
        eq(systemScenarios.platformId, platform.id),
        eq(systemScenarios.system, system),
        eq(systemScenarios.isRetired, false),
      ),
    )
  const scenarioIds = scenarioRows.map((s) => s.id)

  // 9. Wire-state matrix for those scenarios
  const wireStateRows = scenarioIds.length
    ? await db
        .select({
          scenarioId: scenarioWireStates.scenarioId,
          pinId: scenarioWireStates.pinId,
          wireState: scenarioWireStates.wireState,
        })
        .from(scenarioWireStates)
        .where(inArray(scenarioWireStates.scenarioId, scenarioIds))
    : []

  // 10. Pin readings for those scenarios
  const readingRows = scenarioIds.length
    ? await db
        .select({
          pinId: pinScenarioReadings.pinId,
          scenarioId: pinScenarioReadings.scenarioId,
          reading: pinScenarioReadings.reading,
        })
        .from(pinScenarioReadings)
        .where(inArray(pinScenarioReadings.scenarioId, scenarioIds))
    : []
```

- [ ] **Step 3: Assemble the scenarios with their pin-state + reading maps.**

```ts
  const assembledScenarios: TopologyScenario[] = scenarioRows
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => {
      const pinStates: Record<string, string> = {}
      for (const ws of wireStateRows) {
        if (ws.scenarioId === s.id) pinStates[ws.pinId] = ws.wireState
      }
      const pinReadings: Record<string, string> = {}
      for (const r of readingRows) {
        if (r.scenarioId === s.id) pinReadings[r.pinId] = r.reading
      }
      return {
        id: s.id,
        slug: s.slug,
        label: s.label,
        sub: s.sub,
        kind: s.kind,
        keyPosition: s.keyPosition,
        engineState: s.engineState,
        loadLevel: s.loadLevel,
        isDefault: s.isDefault,
        displayOrder: s.displayOrder,
        pinStates,
        pinReadings,
      }
    })
```

- [ ] **Step 4: Run typecheck.**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 5: Commit.**

```bash
git add lib/diagnostics/load-system-topology.ts
git commit -m "feat(diagnostics): load scenarios + wire states + pin readings"
```

---

## Task 9: Loader implementation — load `system_data_status` and `lastScenarioSlug`

**Files:**
- Modify: `lib/diagnostics/load-system-topology.ts`

- [ ] **Step 1: Extend `loadSystemTopology` signature to accept an optional `sessionId`.**

```ts
export async function loadSystemTopology({
  db,
  platformSlug,
  symptomSlug,
  sessionId,
}: {
  db: AppDb
  platformSlug: string
  symptomSlug: string
  sessionId?: string  // NEW — for restoring last-picked scenario
}): Promise<SystemTopology | null> {
```

- [ ] **Step 2: Add the data-status + last-scenario queries before the return statement.**

```ts
  // 11. Captured/missing framing copy for this (platform, system)
  const statusRow = await db.query.systemDataStatus.findFirst({
    where: and(
      eq(systemDataStatus.platformId, platform.id),
      eq(systemDataStatus.system, system),
    ),
    columns: {
      capturedHeader: true,
      missingHeader: true,
      closingNote: true,
    },
  })
  const dataStatus: TopologyDataStatus | null = statusRow
    ? {
        capturedHeader: statusRow.capturedHeader,
        missingHeader: statusRow.missingHeader,
        closingNote: statusRow.closingNote,
      }
    : null

  // 12. Last-picked scenario for this session, if available
  let lastScenarioSlug: string | null = null
  if (sessionId) {
    const sessionRow = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { lastScenarioSlug: true },
    })
    lastScenarioSlug = sessionRow?.lastScenarioSlug ?? null
  }
```

- [ ] **Step 3: Update the return statement to include the new fields.**

```ts
  return {
    platform: { slug: platform.slug, name: buildPlatformName(platform) },
    symptom: { slug: symptom.slug, description: symptom.description },
    system,
    components: assembledComponents,
    connections: connectionRows,
    scenarios: assembledScenarios,
    dataStatus,
    lastScenarioSlug,
  }
```

- [ ] **Step 4: Run typecheck.**

```bash
pnpm tsc --noEmit
```

Expected: no errors in `load-system-topology.ts`.

- [ ] **Step 5: Commit.**

```bash
git add lib/diagnostics/load-system-topology.ts
git commit -m "feat(diagnostics): load system_data_status + per-session lastScenarioSlug"
```

---

## Task 10: Unit tests for the extended loader

**Files:**
- Modify: existing `load-system-topology.test.ts` (path: search for it — `tests/unit/load-system-topology.test.ts` is one possibility; `lib/diagnostics/__tests__/load-system-topology.test.ts` is another)

> **TDD note for this task**: the loader is already implemented (Tasks 6–9). Tests here are added retroactively as a coverage gap-fill — write each test, run it, ensure it passes against the existing impl. If a test fails, the loader has a bug; fix the loader (not the test).

- [ ] **Step 1: Locate the existing test file.**

```bash
find . -name "load-system-topology.test.*" -not -path './node_modules/*' 2>/dev/null
```

Use that path for all subsequent test edits in this task.

- [ ] **Step 2: Add fixture helper for component_pins + scenarios.**

Inside the test file's existing fixture-setup block (usually a `beforeEach` or a helper function that inserts test data into PGlite), add inserts for:
- 2 pins on the existing test component (one with each `edge` value to exercise enum coverage)
- 2 scenarios (one operation, one fault)
- 2 wire-state rows (one per pin for each scenario)
- 2 pin-reading rows
- 1 system_data_status row

Use the existing `db.insert(...)` pattern from the test file. Match the shape of fixtures already in use.

- [ ] **Step 3: Test — components include the new prose columns.**

```ts
test('loadSystemTopology includes new component prose columns', async () => {
  // Set subtitle, role, body on a fixture component before query
  // Then:
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  expect(topology?.components[0].subtitle).toBe('Test subtitle')
  expect(topology?.components[0].role).toBe('Test role')
  expect(topology?.components[0].body).toContain('Test body')
})
```

Run: `pnpm test load-system-topology -- -t "includes new component prose"`
Expected: PASS.

- [ ] **Step 4: Test — pins are loaded and sorted by displayOrder.**

```ts
test('loadSystemTopology loads pins per component, sorted by displayOrder', async () => {
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  const c = topology?.components[0]
  expect(c?.pins).toHaveLength(2)
  expect(c?.pins[0].displayOrder).toBeLessThan(c!.pins[1].displayOrder)
  expect(c?.pins[0].roleAbbreviation).toBeTruthy()
  expect(c?.pins[0].probeLocation).toBeTruthy()
})
```

Run + expect PASS.

- [ ] **Step 5: Test — connections include electricalRole and pin endpoints.**

```ts
test('loadSystemTopology includes electricalRole + pin endpoints on connections', async () => {
  // Set electricalRole + fromPinId on a fixture connection
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  const conn = topology?.connections.find((c) => c.electricalRole !== null)
  expect(conn?.electricalRole).toBe('signal')
  expect(conn?.fromPinId).toBeTruthy()
})
```

Run + expect PASS.

- [ ] **Step 6: Test — scenarios are loaded with pin-state and reading maps.**

```ts
test('loadSystemTopology assembles scenarios with pin-state + reading maps', async () => {
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  expect(topology?.scenarios).toHaveLength(2)
  const opScenario = topology?.scenarios.find((s) => s.kind === 'operation')
  expect(opScenario?.pinStates).toBeTruthy()
  expect(Object.keys(opScenario!.pinStates).length).toBeGreaterThan(0)
  expect(opScenario?.pinReadings).toBeTruthy()
})
```

Run + expect PASS.

- [ ] **Step 7: Test — `dataStatus` loads when row present; null when absent.**

```ts
test('loadSystemTopology returns dataStatus when present', async () => {
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  expect(topology?.dataStatus?.capturedHeader).toBeTruthy()
  expect(topology?.dataStatus?.closingNote).toBeTruthy()
})

test('loadSystemTopology returns dataStatus = null when no row', async () => {
  // Delete the system_data_status row before query
  await db.delete(systemDataStatus).where(/* ... */)
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  expect(topology?.dataStatus).toBeNull()
})
```

Run + expect both PASS.

- [ ] **Step 8: Test — `lastScenarioSlug` round-trips through a sessionId.**

```ts
test('loadSystemTopology returns lastScenarioSlug when sessionId given', async () => {
  // Insert a session with lastScenarioSlug = 'heavy-load'
  const topology = await loadSystemTopology({
    db, platformSlug: 'test', symptomSlug: 'test',
    sessionId: testSessionId,
  })
  expect(topology?.lastScenarioSlug).toBe('heavy-load')
})

test('loadSystemTopology returns lastScenarioSlug = null without sessionId', async () => {
  const topology = await loadSystemTopology({ db, platformSlug: 'test', symptomSlug: 'test' })
  expect(topology?.lastScenarioSlug).toBeNull()
})
```

Run + expect both PASS.

- [ ] **Step 9: Run the full loader test suite.**

```bash
pnpm test load-system-topology
```

Expected: all tests pass.

- [ ] **Step 10: Run the whole test suite to catch regressions.**

```bash
pnpm test
```

Expected: all tests pass. If first run shows flaky PGlite errors, rerun once per [[vitest-pglite-flake]].

- [ ] **Step 11: Commit.**

```bash
git add tests/unit/load-system-topology.test.ts  # adjust path as needed
git commit -m "test(diagnostics): cover pins + scenarios + dataStatus in loader"
```

---

## Task 11: Draft the seed-data SQL

**Files:**
- Create: `drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql`

> **Brandon's standing rule per D16:** Claude re-reads the prototype prose + validates accuracy + spec-fit before apply. Brandon validates the live tool, not the seed SQL line-by-line. So this task is read → format → validate → apply.

- [ ] **Step 1: Re-read the prototype's data constants for the fuel system.**

Read `mockups/topology-guidance/round-3-opus/topology.html` lines ~1017–1374 (the `DATA`, `SCENARIOS`, and `PIN_READINGS` JavaScript objects). These are the seed source.

- [ ] **Step 2: Identify which fuel components already exist in live Supabase.**

The fuel system on 6.7L PSD was seeded in PR-A. Run via Supabase MCP `execute_sql`:

```sql
SELECT id, slug, name
FROM components
WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')
  AND 'fuel' = ANY(systems)
  AND is_retired = false
ORDER BY name;
```

Cross-reference each prototype component (`pcm`, `lift-pump`, `vcv`, `frp-sensor`, `frp-reg`, `hp-pump`, `passenger-rail`, `shared-5v`, `shared-lref`) to the live `components.id` + `components.slug`. Note any naming mismatches — the live DB may use `inlet-metering-valve` instead of `vcv`, etc. (per PR-A/PR-B spec §3 "Honest consequence" note about VCV vs IMV). **Capture the actual live slugs in a mapping table to drive the seed.**

- [ ] **Step 3: Draft Block 1 of the seed — component prose UPDATEs.**

For each of the 7 live fuel components, write an UPDATE setting `subtitle`, `role`, `wire_summary`, `body`, `probing_tactic`, `unknown_note` from the prototype's content. Use the live `slug` from Step 2's mapping. Example:

```sql
-- Block 1: Component prose
UPDATE components SET
  subtitle = 'Powertrain Control Module',
  role = 'Controller — every electrical wire in this system terminates here',
  wire_summary = '9 wires routed into this system (4 of which go to two PWM regulators, 3 go to the FRP sensor, 2 go to the lift pump)',
  body = 'PCM drives the lift pump command, modulates the two PWM regulators (volume control valve on the HP pump, and the FRP pressure regulator at the back of the rail), supplies 5V reference to the sensors, and reads the FRP sensor signal. PCM modulates duty cycle on regulator drivers — duty cycle commanded determines milliamps through each coil.',
  probing_tactic = 'PCM connector itself is rarely the failure. Probe at the COMPONENT end first (sensor or regulator side), and only walk back to PCM if the wire between them tests open.',
  unknown_note = 'PCM connector IDs and cavity numbers for each wire — not yet captured.'
WHERE slug = '<actual-pcm-slug-from-step-2>'
  AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd');

-- ... repeat for each of the other 6 components, using prototype prose verbatim ...
```

Copy prose VERBATIM from prototype. Don't reword. Brandon already wrote it.

- [ ] **Step 4: Draft Block 2 of the seed — component_pins INSERTs.**

For each electrical component (skip mechanical: `hp-pump`, `passenger-rail`) — including PCM, lift-pump, VCV/IMV, FRP sensor, FRP regulator — insert one row per pin. The prototype has ~17 pins total (PCM has 8 outputs, lift pump has 2, VCV has 2, FRP sensor has 3, FRP regulator has 2). Use the prototype's `DATA.pins[...]` block for `probe_location`, `expected_reading`, `missing_logic`, `label_gap`. The `name`, `role_abbreviation`, `edge`, `display_order` come from the SVG positioning in the prototype.

For PCM pins: edge=`bottom`, display_order 0-7 left-to-right.
For lift-pump: pin 0 (12V) edge=`top`, pin 1 (GND) edge=`bottom`.
For VCV/IMV: pins A/B both edge=`top`.
For FRP sensor: 3 pins edge=`top`.
For FRP regulator: pins A/B both edge=`top`.

Each insert needs to look up the `component_id` by slug:

```sql
-- Block 2: Pins
INSERT INTO component_pins (
  slug, component_id, name, role_abbreviation, edge, display_order,
  probe_location, expected_reading, missing_logic, label_gap, source_provenance
) VALUES (
  'lp-12v',
  (SELECT id FROM components WHERE slug = '<lift-pump-slug>' AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-4th-gen-67-psd')),
  '12V Power',
  '12V',
  'top',
  0,
  'Back-probe the power wire at the lift pump connector under the truck near the tank',
  '<b>12V</b> when commanded by PCM (key-on prime, cranking, or running)',
  'Reading <b>0V when commanded</b> → expand the conditional branch and probe upstream: fuel pump relay, fuse, and any fuel pump driver module. Reading <b>12V but pump silent</b> → ground side broken, OR pump motor seized.',
  'Wire color, connector pin number, prime duration, and upstream relay/fuse identifiers — not yet captured.',
  'TRAINING-CONFIRMED'
);
-- ... repeat for all 17 pins, using prototype prose verbatim ...
```

- [ ] **Step 5: Draft Block 3 of the seed — UPDATE existing connections to set `electrical_role` + pin endpoints.**

For each fuel-system connection that exists in `component_connections` (e.g., PCM→lift pump 12V, PCM→VCV pin A, etc.), update the row to set `electrical_role`, `from_pin_id`, `to_pin_id`. Match by `from_component_id` + `to_component_id` + `connection_kind`.

```sql
-- Block 3: Connection electrical role + pin endpoints
UPDATE component_connections SET
  electrical_role = '12v',
  from_pin_id = (SELECT id FROM component_pins WHERE slug = 'pcm-out-lp-12v' AND component_id = (SELECT id FROM components WHERE slug = '<pcm-slug>' AND platform_id = ...)),
  to_pin_id = (SELECT id FROM component_pins WHERE slug = 'lp-12v' AND component_id = (SELECT id FROM components WHERE slug = '<lift-pump-slug>' AND platform_id = ...))
WHERE from_component_id = (SELECT id FROM components WHERE slug = '<pcm-slug>' AND ...)
  AND to_component_id = (SELECT id FROM components WHERE slug = '<lift-pump-slug>' AND ...)
  AND connection_kind = 'electrical-wire';
-- ... repeat for each electrical wire in the system ...
```

- [ ] **Step 6: Draft Block 4 of the seed — system_scenarios INSERTs.**

8 scenarios per the prototype's `SCENARIOS` constant. Use the prototype's `label`, `sub` verbatim. Set `kind`, `keyPosition`, `engineState`, `loadLevel` per §4.8's mapping table.

```sql
-- Block 4: Scenarios
INSERT INTO system_scenarios (
  slug, platform_id, system, label, sub, kind, key_position, engine_state, load_level, is_default, display_order
) VALUES
  ('key-off',     <platform_id>, 'fuel', 'Key Off',                       'Vehicle asleep — no power anywhere in this system',                                            'operation', 'off',  NULL,      NULL,      false, 0),
  ('key-on',      <platform_id>, 'fuel', 'Key On · Engine Off',           'PCM awake, 5V reference hot, sensors reading rest pressure. Lift pump primes briefly then stops.', 'operation', 'on',   'off',     NULL,      false, 1),
  ('idle',        <platform_id>, 'fuel', 'Engine Idle',                   'Lift pump steady, both PWM regulators at moderate duty, FRP reading idle rail pressure',     'operation', 'on',   'running', 'idle',    true,  2),
  ('light-load',  <platform_id>, 'fuel', 'Light Load',                    'Cruising / light throttle — slight bump in PWM duty above idle',                              'operation', 'on',   'running', 'light',   false, 3),
  ('medium-load', <platform_id>, 'fuel', 'Medium Load',                   'Towing or moderate acceleration — higher PWM duty, rising rail pressure',                     'operation', 'on',   'running', 'medium',  false, 4),
  ('heavy-load',  <platform_id>, 'fuel', 'Heavy Load',                    'WOT or heavy tow — peak duty cycles, peak rail pressure',                                     'operation', 'on',   'running', 'heavy',   false, 5),
  ('fault-high',  <platform_id>, 'fuel', 'Fault Sim: Pegged High Pressure', 'FRP signal stuck high — PCM cutting volume control AND opening regulator to bleed pressure off the rail', 'fault', NULL, NULL, NULL, false, 6),
  ('fault-low',   <platform_id>, 'fuel', 'Fault Sim: No Rail Pressure',     'FRP signal flat low — PCM commanding max volume in AND closing return to try to build pressure',          'fault', NULL, NULL, NULL, false, 7);
```

- [ ] **Step 7: Draft Block 5 of the seed — scenario_wire_states INSERTs.**

For each scenario × pin combination, insert one row with the prototype's `pinStates[pin]` value. Use the prototype's `SCENARIOS[scenarioSlug].pinStates` object verbatim. Approximately 8 scenarios × 9 pins = 72 rows. (PCM's 8 pins mirror the corresponding component-side pin's state since they're the same logical wire — for now, only seed the component-side pins; PCM-side pins can be added if/when UI needs them as distinct selectable pins.)

```sql
-- Block 5: Scenario wire states
INSERT INTO scenario_wire_states (scenario_id, pin_id, wire_state) VALUES
  ((SELECT id FROM system_scenarios WHERE slug='key-off' AND platform_id=<pid> AND system='fuel'),
   (SELECT id FROM component_pins WHERE slug='lp-12v' AND component_id=(SELECT id FROM components WHERE slug='<lift-pump-slug>' AND platform_id=<pid>)),
   'off'),
  -- ... ~72 rows total, one per (scenario, pin) per the prototype's pinStates ...
;
```

- [ ] **Step 8: Draft Block 6 of the seed — pin_scenario_readings INSERTs.**

For each scenario × pin combination, insert one row with the prototype's `PIN_READINGS[pin][scenario]` value verbatim. ~72 rows.

```sql
-- Block 6: Pin readings
INSERT INTO pin_scenario_readings (pin_id, scenario_id, reading) VALUES
  ((SELECT id FROM component_pins WHERE slug='lp-12v' AND ...),
   (SELECT id FROM system_scenarios WHERE slug='key-off' AND ...),
   '0V — PCM not commanding pump'),
  -- ... ~72 rows total ...
;
```

- [ ] **Step 9: Draft Block 7 of the seed — system_data_status INSERT.**

```sql
-- Block 7: Captured/missing framing wrapper for fuel
INSERT INTO system_data_status (platform_id, system, captured_header, missing_header, closing_note) VALUES (
  (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd'),
  'fuel',
  'Captured from theory · enough to diagnose',
  'Labels not yet captured · make probing faster, not possible',
  'Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn''t wait for completion to be useful.'
);
```

- [ ] **Step 10: Save the assembled seed file + commit.**

```bash
git add drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql
git commit -m "feat(db): fuel-system seed data for interactive electrical topology"
```

---

## Task 12: Validate the seed on the local rehearsal DB

**Files:** none modified.

- [ ] **Step 1: Apply the seed file to rehearsal.**

```bash
psql vyntechs_rehearsal -f drizzle/data/2026-05-23-electrical-topology-fuel-seed.sql
```

Expected: every statement succeeds. If any UPDATE returns "0 rows" — the slug lookup is wrong; fix and re-run.

- [ ] **Step 2: Verify the seed lands correctly.**

```bash
psql vyntechs_rehearsal <<'SQL'
-- Should be ~7 fuel components with prose now populated
SELECT slug, subtitle IS NOT NULL AS has_subtitle, body IS NOT NULL AS has_body
FROM components
WHERE platform_id = (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd')
  AND 'fuel' = ANY(systems)
ORDER BY slug;

-- Should be ~9 pins on the electrical components
SELECT cp.slug, c.slug AS component_slug, cp.role_abbreviation
FROM component_pins cp
JOIN components c ON c.id = cp.component_id
WHERE c.platform_id = (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd')
  AND 'fuel' = ANY(c.systems)
ORDER BY c.slug, cp.display_order;

-- Should be 8 scenarios
SELECT slug, label, kind, key_position, engine_state, load_level, is_default
FROM system_scenarios
WHERE platform_id = (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd')
  AND system = 'fuel'
ORDER BY display_order;

-- Should be ~72 wire-state rows
SELECT COUNT(*) FROM scenario_wire_states
WHERE scenario_id IN (
  SELECT id FROM system_scenarios
  WHERE platform_id = (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd')
    AND system = 'fuel'
);

-- Should be ~72 pin readings
SELECT COUNT(*) FROM pin_scenario_readings
WHERE scenario_id IN (
  SELECT id FROM system_scenarios
  WHERE platform_id = (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd')
    AND system = 'fuel'
);

-- Should be 1 status row
SELECT captured_header, missing_header, closing_note IS NOT NULL AS has_closing
FROM system_data_status
WHERE platform_id = (SELECT id FROM platforms WHERE slug='ford-super-duty-4th-gen-67-psd')
  AND system = 'fuel';
SQL
```

Expected: counts match (7 components, ~9 pins, 8 scenarios, ~72 wire states, ~72 readings, 1 status row). If any count is wrong, the seed missed something — diff against the prototype and fix.

- [ ] **Step 3: Run the loader against rehearsal in a Node REPL or one-off script to confirm assembled shape.**

This step is sanity-check only — the unit tests in Task 10 use PGlite fixtures, not rehearsal data. Verify the loader returns:
- 7 components with prose fields populated
- ~9 pins distributed across electrical components
- 8 scenarios with `pinStates` and `pinReadings` maps populated
- `dataStatus` populated
- `lastScenarioSlug` = null (no session)

If something's wrong, fix the seed or the loader.

- [ ] **Step 4: No commit — operational step.**

---

## Task 13: Apply the seed to live Supabase (Brandon-approved)

**Files:** none modified.

> ⚠ **Live-DB write — requires per-op Brandon approval per [[no-dangerous-prod-ops]].**

- [ ] **Step 1: Surface the seed file to Brandon for approval.**

Show counts (components, pins, scenarios, wire-states, readings, status row) and offer to show specific blocks. Explicitly ask: *"Approve apply to live Supabase via MCP? Components prose are UPDATEs to existing rows (idempotent-ish — re-apply would overwrite). The rest are INSERTs (re-apply would duplicate)."* Wait for explicit "yes."

- [ ] **Step 2: Apply via Supabase MCP `execute_sql` (in a transaction so it's rollbackable if Brandon spots an issue).**

```
mcp__plugin_supabase_supabase__execute_sql(
  project_id: "ynmtszuybeenjbigxdyl",
  query: "BEGIN; <full seed SQL>; COMMIT;"
)
```

Expected: success.

- [ ] **Step 3: Run the same verification queries from Task 12 Step 2 against live.**

Use `mcp__plugin_supabase_supabase__execute_sql` for each query. Confirm counts match.

- [ ] **Step 4: No commit — seed is in the repo (already committed in Task 11) and now in live DB.**

---

## Task 14: Final end-to-end loader check against live data

**Files:** none modified.

> **Goal:** the loader, run against the live DB on the same session as PR-B's validation case, returns the full extended shape with real fuel data.

- [ ] **Step 1: Use the existing app's dev server or a one-off Node script to call `loadSystemTopology` against live.**

For the fuel-system grounding case (session `681de115-5de9-474e-9721-263f65066e08` — 2017 F-350 / P0087):

```
loadSystemTopology({
  db,
  platformSlug: 'ford-super-duty-4th-gen-67-psd',
  symptomSlug: 'p0087-fuel-rail-pressure-too-low',
  sessionId: '681de115-5de9-474e-9721-263f65066e08',
})
```

Verify:
- `components`: 7 entries, each with `body`, `role`, `subtitle` populated for electrical components
- `connections`: at least 9 entries with `electricalRole` set
- `scenarios`: 8 entries, default = `idle`
- `dataStatus`: populated with the captured/missing headers
- `lastScenarioSlug`: null (no scenario yet picked on this session)

- [ ] **Step 2: Run the full test suite one more time.**

```bash
pnpm test
```

Expected: all tests pass. (PR-C/A introduces no UI; PR-B's tests are not affected.)

- [ ] **Step 3: Run typecheck.**

```bash
pnpm tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: No commit — verification only.**

---

## Task 15: Open the PR

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feat/topology-guided-walk
```

(If `feat/topology-guided-walk` is already pushed, `git push` is enough.)

- [ ] **Step 2: Open PR against `staging-interactive-diagnostics`.**

```bash
gh pr create --base staging-interactive-diagnostics --title "PR-C/A: Interactive electrical topology — schema + seed + loader" --body "$(cat <<'EOF'
## Summary
- Adds 5 new tables (component_pins, system_scenarios, scenario_wire_states, pin_scenario_readings, system_data_status), 6 prose columns on components, 3 columns on component_connections (electrical role + pin endpoints), and last_scenario_slug on sessions
- Seeds fuel-system data for the 6.7L Power Stroke from Brandon's prototype (7 components, ~9 pins, 8 scenarios, ~72 wire-state rows, ~72 pin readings, 1 status row)
- Extends loadSystemTopology to return the richer assembled graph (pins, scenarios with pin-state + reading maps, dataStatus, lastScenarioSlug)
- No UI changes — the existing topology page renders unchanged. PR-C/B follows with the new UI.

Spec: docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md
Plan: docs/superpowers/plans/2026-05-23-electrical-topology-schema-loader.md

## Test plan
- [ ] pnpm test — all loader tests pass, including new pins/scenarios/dataStatus/lastScenarioSlug coverage
- [ ] pnpm tsc --noEmit — clean
- [ ] Verify the live DB has all 5 new tables + 9 column additions
- [ ] Verify the loader, run against the F-350 / P0087 session, returns 7 components with body prose, 8 scenarios, ~9 pins, dataStatus populated
- [ ] Existing topology page (PR-B's browse mode) still renders correctly — no regression
EOF
)"
```

- [ ] **Step 3: Brandon merges the PR via the GitHub UI (per the standing rule — Claude never pushes to or merges main/staging branches).**

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Implementing task |
|---|---|
| §7.0 component prose columns | Tasks 1, 4, 6, 11 |
| §7.1 component_pins | Tasks 1, 2, 4, 6, 11 |
| §7.2 connection electrical role + pin endpoints | Tasks 1, 4, 7, 11 |
| §7.3 system_scenarios (with compositional metadata) | Tasks 1, 4, 8, 11 |
| §7.4 scenario_wire_states | Tasks 1, 4, 8, 11 |
| §7.5 pin_scenario_readings | Tasks 1, 4, 8, 11 |
| §7.6 system_data_status (hybrid footer wrapper) | Tasks 1, 4, 9, 11 |
| §7.7 (rationale for pin-keyed state) | Architectural — no separate task |
| §7.8 `<b>` only inline emphasis | No code change — render-side concern (PR-C/B) |
| §5.1 lastScenarioSlug persistence | Tasks 1, 4, 9 (sessions column + loader read) |
| §10 D11–D18 decisions | All applied throughout |
| §11 unit test coverage | Task 10 |
| §11 live validation | Tasks 12 + 14 |
| §12 build sequence | This plan IS the PR-C/A half |

Gaps: none for PR-C/A scope. (PR-C/B — the UI — is a separate plan written after this merges.)

**2. Placeholder scan:** No "TBD" / "implement later" / "add appropriate error handling" / "similar to Task N" / steps without code. Every step is concrete.

**3. Type consistency:** `componentPins` slug + `component_id` + `role_abbreviation` + `edge` + `display_order` + `probe_location` + `expected_reading` + `missing_logic` + `label_gap` + `source_provenance` + `is_retired` — match across migration SQL, Drizzle schema, loader types, seed inserts. `systemScenarios` field names match across all four. Wire-state enum values match between migration, Drizzle schema, and the prototype's CSS classes (verified against `topology.html` lines 614–633).

---

## Build sequence summary

15 tasks, ~3–5 hours of focused work for a skilled engineer:

1. **Migration SQL** (Task 1) — single file, ~120 lines.
2. **Rehearsal verification** (Task 2) — local DB sanity check.
3. **Live migration apply** (Task 3) — Brandon-approved.
4. **Drizzle schema sync** (Task 4) — TypeScript follows SQL.
5. **Loader types** (Task 5) — public surface.
6. **Loader impl: pins** (Task 6).
7. **Loader impl: electrical role + pin endpoints** (Task 7).
8. **Loader impl: scenarios + wire states + readings** (Task 8).
9. **Loader impl: dataStatus + lastScenarioSlug** (Task 9).
10. **Loader unit tests** (Task 10) — PGlite fixtures.
11. **Seed SQL drafting** (Task 11) — extract from prototype, ~200 SQL statements.
12. **Seed rehearsal** (Task 12).
13. **Seed live apply** (Task 13) — Brandon-approved.
14. **End-to-end loader check** (Task 14) — against live data.
15. **Open PR** (Task 15).
