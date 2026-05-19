# Diagnostic Orchestration — Phase 1 Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 12-table relational schema for the diagnostic orchestration into the existing Supabase Postgres, with RLS policies, partial-unique indexes, CHECK constraints, and FK cascade behaviors fully specified.

**Architecture:** Drizzle TypeScript schema definitions in `lib/db/schema.ts`, drizzle-kit generates the base migration SQL, hand-appended DDL completes RLS / partial uniques / CHECK constraints that drizzle-kit doesn't emit, rehearsed on local `vyntechs_rehearsal` before per-op-approved application to live Supabase via the Supabase MCP `apply_migration` tool.

**Tech Stack:** Drizzle ORM 0.36+, drizzle-kit 0.27+, Postgres 15 (Supabase), pnpm, psql, Supabase MCP

**Spec reference:** `docs/superpowers/specs/2026-05-19-orchestration-schema-design.md`

---

## File Structure

**Modify:**
- `lib/db/schema.ts` (495 → ~900 lines): add 12 new table definitions, the `vehicles.platform_id` column, `relations()` exports, and type exports

**Create:**
- `drizzle/migrations/0017_<auto_name>.sql`: drizzle-kit-generated migration with hand-appended DDL (RLS policies, partial-unique indexes, CHECK constraints)

The existing `lib/db/schema.ts` will grow but stays single-file. Multi-file split is out of scope for this plan; a follow-up cleanup PR can split if line count exceeds ~1000.

---

## Conventions used throughout

- **Drizzle text-with-enum pattern:** `text('column_name', { enum: ['VALUE_A', 'VALUE_B'] as const })` — matches the existing `entry_source` pattern on `corpus_entries` in `lib/db/schema.ts:343`.
- **UUID primary keys:** `uuid('id').primaryKey().defaultRandom()`.
- **Timestamps:** `timestamp('column_name', { withTimezone: true })`, `.defaultNow().notNull()` for `created_at` / `updated_at`.
- **FK cascade specification:** every `references()` call passes an explicit `onDelete` option. No defaults.
- **Self-referential FKs:** use the `AnyPgColumn` type cast pattern (added to imports in Task 1, Step 1).
- **Commit cadence:** one commit per task. Each task is a logical unit.

---

## Task 1: Add all 12 new tables + `vehicles.platform_id` + relations to `lib/db/schema.ts`

**Files:**
- Modify: `lib/db/schema.ts` (495 → ~900 lines)

- [ ] **Step 1: Update imports**

Open `lib/db/schema.ts`. Replace the existing import line for drizzle-orm/pg-core with:

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  boolean,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
```

Two additions: `uniqueIndex` (for full uniques on slugs of non-fact-bearing tables), and the `AnyPgColumn` type import (for self-referential FK type cast).

- [ ] **Step 2: Add `platforms` table**

Add to `lib/db/schema.ts` after the `vehicles` table block:

```typescript
export const platforms = pgTable(
  'platforms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    yearRange: text('year_range').notNull(),
    parentMake: text('parent_make').notNull(),
    parentModelFamily: text('parent_model_family').notNull(),
    generation: text('generation'),
    parentPlatformId: uuid('parent_platform_id').references(
      (): AnyPgColumn => platforms.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('platforms_parent_platform_id_idx').on(table.parentPlatformId),
  ],
)
```

- [ ] **Step 3: Add `architecture_facts` table**

Append:

```typescript
export const architectureFacts = pgTable(
  'architecture_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    platformId: uuid('platform_id')
      .references(() => platforms.id, { onDelete: 'cascade' })
      .notNull(),
    description: text('description').notNull(),
    fieldVerifyRequired: boolean('field_verify_required').notNull().default(false),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => architectureFacts.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('architecture_facts_platform_id_idx').on(table.platformId),
  ],
)
```

Note: the partial unique index on `slug` and the `architecture_facts_active_idx` partial index are added via hand-written DDL in Task 2 (drizzle-kit can't emit partial indexes from this syntax).

- [ ] **Step 4: Add `components` table**

```typescript
export const components = pgTable(
  'components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    platformId: uuid('platform_id')
      .references(() => platforms.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['sensor', 'actuator', 'pump', 'valve', 'module', 'mechanical', 'splice', 'connector'],
    }).notNull(),
    electricalContract: text('electrical_contract'),
    location: text('location'),
    function: text('function'),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => components.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('components_platform_id_idx').on(table.platformId),
  ],
)
```

- [ ] **Step 5: Add `observable_properties` table**

```typescript
export const observableProperties = pgTable(
  'observable_properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    componentId: uuid('component_id')
      .references(() => components.id, { onDelete: 'cascade' })
      .notNull(),
    description: text('description').notNull(),
    observationMethod: text('observation_method', {
      enum: [
        'scan_tool_pid',
        'pressure_test_with_gauge',
        'electrical_measurement_at_pin',
        'waveform_capture',
        'direct_visual_internal',
        'direct_visual_external',
        'audible',
        'touch',
        'smell',
      ],
    }).notNull(),
    housingOpacityStatus: text('housing_opacity_status', {
      enum: ['opaque', 'transparent', 'removable', 'unknown'],
    }),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => observableProperties.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('observable_properties_component_id_idx').on(table.componentId),
  ],
)
```

- [ ] **Step 6: Add `symptoms` table**

```typescript
export const symptoms = pgTable(
  'symptoms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    description: text('description').notNull(),
    category: text('category', {
      enum: ['dtc', 'performance', 'no-start', 'drivability', 'noise-vibration', 'electrical', 'other'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('symptoms_category_idx').on(table.category),
  ],
)
```

- [ ] **Step 7: Add `test_actions` table**

```typescript
export const testActions = pgTable(
  'test_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    componentId: uuid('component_id')
      .references(() => components.id, { onDelete: 'cascade' })
      .notNull(),
    description: text('description').notNull(),
    scenarioRequired: text('scenario_required', {
      enum: ['key-off', 'key-on', 'cranking', 'idle', 'medium-load', 'heavy-load', 'hot-soak', 'none'],
    }).notNull(),
    observationMethod: text('observation_method', {
      enum: [
        'scan_tool_pid',
        'pressure_test_with_gauge',
        'electrical_measurement_at_pin',
        'waveform_capture',
        'direct_visual_internal',
        'direct_visual_external',
        'audible',
        'touch',
        'smell',
      ],
    }).notNull(),
    meterMode: text('meter_mode'),
    expectedValue: real('expected_value'),
    expectedUnit: text('expected_unit'),
    expectedTolerance: real('expected_tolerance'),
    expectedObservation: text('expected_observation'),
    invasiveness: integer('invasiveness').notNull(),
    confidenceBoost: real('confidence_boost').notNull().default(0),
    sourceCitation: text('source_citation'),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => testActions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('test_actions_component_id_idx').on(table.componentId),
  ],
)
```

CHECK constraints on `invasiveness` and `confidence_boost` ranges are hand-written in Task 2.

- [ ] **Step 8: Add `branch_logic` table**

```typescript
export const branchLogic = pgTable(
  'branch_logic',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    testActionId: uuid('test_action_id')
      .references(() => testActions.id, { onDelete: 'cascade' })
      .notNull(),
    condition: text('condition').notNull(),
    verdict: text('verdict', {
      enum: ['ok', 'warn', 'fail', 'impossible'],
    }).notNull(),
    nextAction: text('next_action').notNull(),
    routesToTestActionId: uuid('routes_to_test_action_id').references(
      () => testActions.id,
      { onDelete: 'set null' },
    ),
    reasoning: text('reasoning'),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => branchLogic.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('branch_logic_test_action_id_idx').on(table.testActionId),
    index('branch_logic_routes_to_idx').on(table.routesToTestActionId),
  ],
)
```

- [ ] **Step 9: Add `tech_outcomes` table**

```typescript
export const techOutcomes = pgTable(
  'tech_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    testActionId: uuid('test_action_id')
      .references(() => testActions.id, { onDelete: 'restrict' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => diagnosticSessions.id, { onDelete: 'restrict' })
      .notNull(),
    shopId: uuid('shop_id')
      .references(() => shops.id, { onDelete: 'restrict' })
      .notNull(),
    techId: uuid('tech_id')
      .references(() => profiles.id, { onDelete: 'restrict' })
      .notNull(),
    measuredValue: real('measured_value'),
    measuredUnit: text('measured_unit'),
    measuredObservation: text('measured_observation'),
    verdict: text('verdict', {
      enum: ['ok', 'warn', 'fail', 'impossible'],
    }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('tech_outcomes_test_action_id_idx').on(table.testActionId),
    index('tech_outcomes_session_id_idx').on(table.sessionId),
    index('tech_outcomes_shop_id_idx').on(table.shopId),
    index('tech_outcomes_recorded_at_idx').on(table.recordedAt),
  ],
)
```

Note: `diagnosticSessions` is referenced but defined in the next step. Drizzle's lazy reference resolution handles forward references fine. CHECK constraint on `(measured_value IS NOT NULL OR measured_observation IS NOT NULL)` is hand-written in Task 2. RLS policies are hand-written in Task 2.

- [ ] **Step 10: Add `diagnostic_sessions` table**

```typescript
export const diagnosticSessions = pgTable(
  'diagnostic_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: uuid('vehicle_id')
      .references(() => vehicles.id, { onDelete: 'restrict' })
      .notNull(),
    symptomId: uuid('symptom_id')
      .references(() => symptoms.id, { onDelete: 'restrict' })
      .notNull(),
    shopId: uuid('shop_id')
      .references(() => shops.id, { onDelete: 'cascade' })
      .notNull(),
    techId: uuid('tech_id')
      .references(() => profiles.id, { onDelete: 'restrict' })
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    finalVerdict: text('final_verdict', {
      enum: ['commit-allowed', 'commit-refused', 'incomplete'],
    }),
    resolvedComponentId: uuid('resolved_component_id').references(
      () => components.id,
      { onDelete: 'set null' },
    ),
    cumulativeConfidence: real('cumulative_confidence').notNull().default(0),
  },
  (table) => [
    index('diagnostic_sessions_vehicle_id_idx').on(table.vehicleId),
    index('diagnostic_sessions_symptom_id_idx').on(table.symptomId),
    index('diagnostic_sessions_shop_id_idx').on(table.shopId),
    index('diagnostic_sessions_started_at_idx').on(table.startedAt),
  ],
)
```

CHECK constraint on `cumulative_confidence BETWEEN 0 AND 100` is hand-written in Task 2. RLS policies hand-written in Task 2.

- [ ] **Step 11: Add `component_connections` table**

```typescript
export const componentConnections = pgTable(
  'component_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromComponentId: uuid('from_component_id')
      .references(() => components.id, { onDelete: 'cascade' })
      .notNull(),
    toComponentId: uuid('to_component_id')
      .references(() => components.id, { onDelete: 'cascade' })
      .notNull(),
    connectionKind: text('connection_kind', {
      enum: ['electrical-wire', 'fluid-line', 'mechanical-linkage', 'can-bus', 'lin-bus', 'reports_to', 'controlled_by'],
    }).notNull(),
    direction: text('direction', {
      enum: ['unidirectional', 'bidirectional'],
    }).notNull().default('unidirectional'),
    description: text('description'),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => componentConnections.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('component_connections_from_idx').on(table.fromComponentId),
    index('component_connections_to_idx').on(table.toComponentId),
    index('component_connections_kind_idx').on(table.connectionKind),
  ],
)
```

- [ ] **Step 12: Add `symptom_test_implications` table**

```typescript
export const symptomTestImplications = pgTable(
  'symptom_test_implications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    symptomId: uuid('symptom_id')
      .references(() => symptoms.id, { onDelete: 'cascade' })
      .notNull(),
    testActionId: uuid('test_action_id')
      .references(() => testActions.id, { onDelete: 'cascade' })
      .notNull(),
    priority: integer('priority').notNull(),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    inferenceClass: text('inference_class', {
      enum: ['LAW', 'LOGIC', 'PATTERN'],
    }),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => symptomTestImplications.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('symptom_test_implications_symptom_priority_idx').on(
      table.symptomId,
      table.priority,
    ),
    index('symptom_test_implications_test_action_id_idx').on(table.testActionId),
  ],
)
```

Drizzle doesn't have first-class DESC index syntax in `.on()` for portable use; the `(symptom_id, priority DESC)` ordering is hand-written in Task 2 to replace the auto-generated index if needed. CHECK on `priority BETWEEN 1 AND 10` is also hand-written.

- [ ] **Step 13: Add `platform_equivalents` table**

```typescript
export const platformEquivalents = pgTable(
  'platform_equivalents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platformAId: uuid('platform_a_id')
      .references(() => platforms.id, { onDelete: 'cascade' })
      .notNull(),
    platformBId: uuid('platform_b_id')
      .references(() => platforms.id, { onDelete: 'cascade' })
      .notNull(),
    system: text('system', {
      enum: [
        'fuel',
        'fuel-injection',
        'air-induction',
        'aftertreatment',
        'turbo',
        'egr',
        'cooling',
        'electrical',
        'transmission',
        'driveline',
        'hvac',
        'brakes',
        'steering',
        'engine-mechanical',
      ],
    }).notNull(),
    verdict: text('verdict', {
      enum: ['FULLY', 'PARTIALLY', 'NOT', 'INSUFFICIENT'],
    }).notNull(),
    verdictReasoning: text('verdict_reasoning'),
    sourceProvenance: text('source_provenance', {
      enum: ['TRAINING-CONFIRMED', 'TRAINING-INFERRED', 'FIELD-VERIFIED', 'GAP'],
    }).notNull(),
    isRetired: boolean('is_retired').notNull().default(false),
    replacedById: uuid('replaced_by_id').references(
      (): AnyPgColumn => platformEquivalents.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('platform_equivalents_a_system_idx').on(table.platformAId, table.system),
    index('platform_equivalents_b_system_idx').on(table.platformBId, table.system),
  ],
)
```

CHECK constraints on `platform_a_id < platform_b_id` and the partial unique on `(platform_a_id, platform_b_id, system) WHERE is_retired = false` are hand-written in Task 2.

- [ ] **Step 14: Add `platform_id` column to the existing `vehicles` table**

Find the existing `vehicles` table block in `lib/db/schema.ts`. Currently (around lines 51-70):

```typescript
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }).notNull(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    engine: text('engine'),
    vin: text('vin'),
    mileage: integer('mileage'),
    plate: text('plate'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('vehicles_customer_id_idx').on(table.customerId),
    index('vehicles_customer_id_vin_idx').on(table.customerId, table.vin),
  ],
)
```

Add the `platformId` column right after `plate` and add a matching index:

```typescript
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }).notNull(),
    year: integer('year').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    engine: text('engine'),
    vin: text('vin'),
    mileage: integer('mileage'),
    plate: text('plate'),
    platformId: uuid('platform_id').references(() => platforms.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('vehicles_customer_id_idx').on(table.customerId),
    index('vehicles_customer_id_vin_idx').on(table.customerId, table.vin),
    index('vehicles_platform_id_idx').on(table.platformId),
  ],
)
```

- [ ] **Step 15: Add `relations()` exports for the new tables**

Append (after the existing relations exports near the bottom of the file, but BEFORE the type exports section):

```typescript
export const platformsRelations = relations(platforms, ({ many }) => ({
  architectureFacts: many(architectureFacts),
  components: many(components),
}))

export const architectureFactsRelations = relations(architectureFacts, ({ one }) => ({
  platform: one(platforms, {
    fields: [architectureFacts.platformId],
    references: [platforms.id],
  }),
}))

export const componentsRelations = relations(components, ({ one, many }) => ({
  platform: one(platforms, {
    fields: [components.platformId],
    references: [platforms.id],
  }),
  observableProperties: many(observableProperties),
  testActions: many(testActions),
}))

export const observablePropertiesRelations = relations(observableProperties, ({ one }) => ({
  component: one(components, {
    fields: [observableProperties.componentId],
    references: [components.id],
  }),
}))

export const symptomsRelations = relations(symptoms, ({ many }) => ({
  testImplications: many(symptomTestImplications),
}))

export const testActionsRelations = relations(testActions, ({ one, many }) => ({
  component: one(components, {
    fields: [testActions.componentId],
    references: [components.id],
  }),
  branches: many(branchLogic),
  outcomes: many(techOutcomes),
}))

export const branchLogicRelations = relations(branchLogic, ({ one }) => ({
  testAction: one(testActions, {
    fields: [branchLogic.testActionId],
    references: [testActions.id],
  }),
}))

export const techOutcomesRelations = relations(techOutcomes, ({ one }) => ({
  testAction: one(testActions, {
    fields: [techOutcomes.testActionId],
    references: [testActions.id],
  }),
  session: one(diagnosticSessions, {
    fields: [techOutcomes.sessionId],
    references: [diagnosticSessions.id],
  }),
  shop: one(shops, { fields: [techOutcomes.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [techOutcomes.techId], references: [profiles.id] }),
}))

export const diagnosticSessionsRelations = relations(diagnosticSessions, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [diagnosticSessions.vehicleId],
    references: [vehicles.id],
  }),
  symptom: one(symptoms, {
    fields: [diagnosticSessions.symptomId],
    references: [symptoms.id],
  }),
  shop: one(shops, { fields: [diagnosticSessions.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [diagnosticSessions.techId], references: [profiles.id] }),
  outcomes: many(techOutcomes),
}))
```

Note: `componentConnections`, `symptomTestImplications`, and `platformEquivalents` don't get relations() exports — they're junction tables with no query patterns yet defined. Will be added in Phase 2 if needed.

- [ ] **Step 16: Add type exports for the new tables**

Append at the end of the file (after existing type exports like `WhatsNewEntry`):

```typescript
export type Platform = typeof platforms.$inferSelect
export type NewPlatform = typeof platforms.$inferInsert
export type ArchitectureFact = typeof architectureFacts.$inferSelect
export type NewArchitectureFact = typeof architectureFacts.$inferInsert
export type Component = typeof components.$inferSelect
export type NewComponent = typeof components.$inferInsert
export type ObservableProperty = typeof observableProperties.$inferSelect
export type NewObservableProperty = typeof observableProperties.$inferInsert
export type Symptom = typeof symptoms.$inferSelect
export type NewSymptom = typeof symptoms.$inferInsert
export type TestAction = typeof testActions.$inferSelect
export type NewTestAction = typeof testActions.$inferInsert
export type BranchLogicRow = typeof branchLogic.$inferSelect
export type NewBranchLogicRow = typeof branchLogic.$inferInsert
export type TechOutcome = typeof techOutcomes.$inferSelect
export type NewTechOutcome = typeof techOutcomes.$inferInsert
export type DiagnosticSession = typeof diagnosticSessions.$inferSelect
export type NewDiagnosticSession = typeof diagnosticSessions.$inferInsert
export type ComponentConnection = typeof componentConnections.$inferSelect
export type NewComponentConnection = typeof componentConnections.$inferInsert
export type SymptomTestImplication = typeof symptomTestImplications.$inferSelect
export type NewSymptomTestImplication = typeof symptomTestImplications.$inferInsert
export type PlatformEquivalent = typeof platformEquivalents.$inferSelect
export type NewPlatformEquivalent = typeof platformEquivalents.$inferInsert
```

Note: `BranchLogicRow` (not `BranchLogic`) avoids collision with potential type-narrowing imports.

- [ ] **Step 17: Verify TypeScript compiles**

Run:

```bash
pnpm tsc --noEmit
```

Expected: clean exit, no type errors.

If errors:
- "Cannot find name 'AnyPgColumn'" → check Step 1, the import is needed.
- "Cannot find name 'diagnosticSessions'" in `techOutcomes` definition → ignore if it's a Drizzle internal reference; Drizzle resolves these lazily. If TypeScript complains, reorder so `diagnosticSessions` is defined BEFORE `techOutcomes` in the file (move Step 10's block above Step 9's).
- "Type 'string' is not assignable to type 'never'" inside an enum column → re-check the enum string array has `as const` if needed; Drizzle 0.36+ should handle it without, but older versions need it.

- [ ] **Step 18: Commit**

```bash
git add lib/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(db): add diagnostic orchestration tables to Drizzle schema

Adds 12 new tables (platforms, architecture_facts, components,
observable_properties, symptoms, test_actions, branch_logic,
tech_outcomes, diagnostic_sessions, component_connections,
symptom_test_implications, platform_equivalents) and the
vehicles.platform_id column.

TypeScript schema only — migration SQL generated in next commit.
RLS policies, partial unique indexes, and CHECK constraints
appended in the migration file (drizzle-kit doesn't emit these
from TypeScript).

Spec: docs/superpowers/specs/2026-05-19-orchestration-schema-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Generate migration SQL + append hand-written DDL

**Files:**
- Create: `drizzle/migrations/0017_<auto_name>.sql`

- [ ] **Step 1: Generate the base migration**

Run:

```bash
pnpm drizzle-kit generate
```

Expected output: a new file created at `drizzle/migrations/0017_<random_words>.sql` plus an updated `drizzle/migrations/meta/_journal.json`. The migration file will contain `CREATE TABLE` statements for the 12 new tables, the `ALTER TABLE vehicles ADD COLUMN platform_id...`, and the index definitions from `(table) => [...]` blocks.

- [ ] **Step 2: Inspect the generated migration**

Open `drizzle/migrations/0017_*.sql` and verify:
- 12 `CREATE TABLE` statements (one per new table)
- 1 `ALTER TABLE vehicles ADD COLUMN platform_id` statement
- All `CREATE INDEX` statements from the table extras
- All FK constraints have explicit `ON DELETE` clauses matching the spec

If anything is missing or wrong, fix the TypeScript schema in `lib/db/schema.ts` and regenerate. Do NOT manually edit the auto-generated portion — keep regen as source of truth.

- [ ] **Step 3: Append RLS policies for `tech_outcomes`**

Append to the end of the migration file:

```sql
-- =========================================================================
-- HAND-WRITTEN DDL (not generated by drizzle-kit)
-- =========================================================================

-- RLS: tech_outcomes
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

- [ ] **Step 4: Append RLS policies for `diagnostic_sessions`**

Append:

```sql
-- RLS: diagnostic_sessions
ALTER TABLE diagnostic_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY diagnostic_sessions_insert_own_shop
  ON diagnostic_sessions FOR INSERT
  TO authenticated
  WITH CHECK (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY diagnostic_sessions_update_own_shop
  ON diagnostic_sessions FOR UPDATE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY diagnostic_sessions_delete_own_shop
  ON diagnostic_sessions FOR DELETE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY diagnostic_sessions_select_all
  ON diagnostic_sessions FOR SELECT
  TO authenticated
  USING (true);
```

- [ ] **Step 5: Append partial unique indexes on `slug` for fact-bearing node tables**

Append:

```sql
-- Partial unique indexes on slug (active rows only) for fact-bearing node tables
CREATE UNIQUE INDEX architecture_facts_slug_active_unique
  ON architecture_facts (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX components_slug_active_unique
  ON components (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX observable_properties_slug_active_unique
  ON observable_properties (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX test_actions_slug_active_unique
  ON test_actions (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX branch_logic_slug_active_unique
  ON branch_logic (slug) WHERE is_retired = false;
```

- [ ] **Step 6: Append partial unique indexes for junction tables**

Append:

```sql
-- Partial unique indexes on natural-identity tuples for junction tables
CREATE UNIQUE INDEX component_connections_from_to_kind_active_unique
  ON component_connections (from_component_id, to_component_id, connection_kind)
  WHERE is_retired = false;

CREATE UNIQUE INDEX symptom_test_implications_symptom_test_active_unique
  ON symptom_test_implications (symptom_id, test_action_id)
  WHERE is_retired = false;

CREATE UNIQUE INDEX platform_equivalents_a_b_system_active_unique
  ON platform_equivalents (platform_a_id, platform_b_id, system)
  WHERE is_retired = false;
```

- [ ] **Step 7: Append partial indexes on `is_retired = false` for active-row lookups**

Append:

```sql
-- Partial indexes for fast active-row scans (filtered by is_retired = false)
CREATE INDEX architecture_facts_active_idx
  ON architecture_facts (platform_id) WHERE is_retired = false;

CREATE INDEX components_active_idx
  ON components (platform_id) WHERE is_retired = false;

CREATE INDEX observable_properties_active_idx
  ON observable_properties (component_id) WHERE is_retired = false;

CREATE INDEX test_actions_active_idx
  ON test_actions (component_id) WHERE is_retired = false;

CREATE INDEX branch_logic_active_idx
  ON branch_logic (test_action_id) WHERE is_retired = false;
```

- [ ] **Step 8: Append CHECK constraint for retirement invariant on all fact-bearing tables**

Append:

```sql
-- Retirement invariant: a row with replaced_by_id set must be retired
ALTER TABLE architecture_facts
  ADD CONSTRAINT architecture_facts_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE components
  ADD CONSTRAINT components_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE observable_properties
  ADD CONSTRAINT observable_properties_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE test_actions
  ADD CONSTRAINT test_actions_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE branch_logic
  ADD CONSTRAINT branch_logic_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE component_connections
  ADD CONSTRAINT component_connections_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE symptom_test_implications
  ADD CONSTRAINT symptom_test_implications_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE platform_equivalents
  ADD CONSTRAINT platform_equivalents_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);
```

- [ ] **Step 9: Append numeric range CHECK constraints**

Append:

```sql
-- Numeric range constraints
ALTER TABLE test_actions
  ADD CONSTRAINT test_actions_invasiveness_range
  CHECK (invasiveness BETWEEN 1 AND 5);

ALTER TABLE test_actions
  ADD CONSTRAINT test_actions_confidence_boost_range
  CHECK (confidence_boost BETWEEN 0 AND 100);

ALTER TABLE diagnostic_sessions
  ADD CONSTRAINT diagnostic_sessions_cumulative_confidence_range
  CHECK (cumulative_confidence BETWEEN 0 AND 100);

ALTER TABLE symptom_test_implications
  ADD CONSTRAINT symptom_test_implications_priority_range
  CHECK (priority BETWEEN 1 AND 10);
```

- [ ] **Step 10: Append value-shape CHECK constraints**

Append:

```sql
-- Value-shape constraints
ALTER TABLE tech_outcomes
  ADD CONSTRAINT tech_outcomes_value_or_observation_required
  CHECK (measured_value IS NOT NULL OR measured_observation IS NOT NULL);

ALTER TABLE component_connections
  ADD CONSTRAINT component_connections_no_self_loop
  CHECK (from_component_id <> to_component_id);

ALTER TABLE platform_equivalents
  ADD CONSTRAINT platform_equivalents_canonical_ordering
  CHECK (platform_a_id < platform_b_id);
```

- [ ] **Step 11: Replace the auto-generated `symptom_test_implications` priority index with a DESC-ordered one**

Drizzle's `.on(table.symptomId, table.priority)` generates an ASC index. The spec requires DESC for priority. Append at the very end of the migration file:

```sql
-- Drop the ASC index drizzle-kit generated, replace with DESC for priority
DROP INDEX IF EXISTS symptom_test_implications_symptom_priority_idx;
CREATE INDEX symptom_test_implications_symptom_priority_idx
  ON symptom_test_implications (symptom_id, priority DESC);
```

- [ ] **Step 12: Commit**

```bash
git add drizzle/migrations/0017_*.sql drizzle/migrations/meta/_journal.json
git commit -m "$(cat <<'EOF'
feat(db): generate migration 0017 for diagnostic orchestration schema

drizzle-kit generated CREATE TABLE and ALTER TABLE statements, plus
hand-appended DDL for items drizzle-kit can't emit:
- RLS policies on tech_outcomes and diagnostic_sessions (4 each)
- 8 partial unique indexes (5 slug + 3 junction natural-identity)
- 5 partial active-row lookup indexes
- 8 retirement invariant CHECK constraints
- 4 numeric range CHECK constraints
- 3 value-shape CHECK constraints
- 1 DESC-ordered index replacement

Spec: docs/superpowers/specs/2026-05-19-orchestration-schema-design.md
Migration not yet applied; rehearses on vyntechs_rehearsal next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Rehearse migration on local Postgres

**Goal:** Apply the migration to `vyntechs_rehearsal` local DB, verify schema and every constraint behaves correctly. No changes to repo state during this task (unless rehearsal exposes a migration bug — then fix in Task 2 and re-rehearse).

**Files:**
- No new files. Reads `drizzle/migrations/0017_*.sql`.

- [ ] **Step 1: Confirm `vyntechs_rehearsal` exists and is current**

Run:

```bash
psql -d vyntechs_rehearsal -c '\dt' | head -40
```

Expected: shows existing tables (profiles, sessions, customers, vehicles, corpus_entries, etc.). If the DB doesn't exist or seems stale, recreate it from prod via the pattern in `reference_local_rehearsal_db` memory before proceeding.

- [ ] **Step 2: Apply migration**

Run:

```bash
psql -d vyntechs_rehearsal -v ON_ERROR_STOP=1 -f drizzle/migrations/0017_*.sql
```

Expected: no errors. If any statement fails, the entire migration aborts (`-v ON_ERROR_STOP=1`). Fix and re-rehearse.

- [ ] **Step 3: Verify all 12 tables exist**

Run:

```bash
psql -d vyntechs_rehearsal -c "\dt platforms architecture_facts components observable_properties symptoms test_actions branch_logic tech_outcomes diagnostic_sessions component_connections symptom_test_implications platform_equivalents"
```

Expected: all 12 tables listed.

- [ ] **Step 4: Verify `vehicles.platform_id` column exists**

```bash
psql -d vyntechs_rehearsal -c "\d+ vehicles" | grep platform_id
```

Expected: a line showing `platform_id | uuid | | | |` with a FK reference to platforms.

- [ ] **Step 5: Verify RLS policies on `tech_outcomes` and `diagnostic_sessions`**

```bash
psql -d vyntechs_rehearsal -c "\d+ tech_outcomes" | grep -A 5 'Policies'
psql -d vyntechs_rehearsal -c "\d+ diagnostic_sessions" | grep -A 5 'Policies'
```

Expected: each table lists 4 policies (insert_own_shop, update_own_shop, delete_own_shop, select_all).

Note: functional RLS testing (does auth.uid() actually scope correctly) happens in Task 4 against the live DB.

- [ ] **Step 6: Run FK cascade test — CASCADE behavior**

```bash
psql -d vyntechs_rehearsal <<'EOF'
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('test-platform-cascade', '2020', 'Test', 'TestFamily');

INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
  SELECT 'test-fact-cascade', id, 'test fact', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'test-platform-cascade';

-- Delete the platform; the fact should cascade
DELETE FROM platforms WHERE slug = 'test-platform-cascade';

SELECT count(*) AS remaining_facts FROM architecture_facts WHERE slug = 'test-fact-cascade';
-- Expected: 0
ROLLBACK;
EOF
```

Expected: `remaining_facts = 0`. Rolled back to leave DB clean.

- [ ] **Step 7: Run FK cascade test — RESTRICT behavior on `tech_outcomes.session_id`**

```bash
psql -d vyntechs_rehearsal <<'EOF'
BEGIN;
-- Set up minimal fixtures
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('test-platform-restrict', '2020', 'Test', 'TestFamily');
INSERT INTO components (slug, platform_id, name, kind, source_provenance)
  SELECT 'test-comp-restrict', id, 'Test Comp', 'sensor', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'test-platform-restrict';
INSERT INTO symptoms (slug, description, category)
  VALUES ('test-symptom-restrict', 'test', 'dtc');
INSERT INTO test_actions (slug, component_id, description, scenario_required, observation_method, invasiveness, source_provenance)
  SELECT 'test-action-restrict', id, 'test', 'idle', 'scan_tool_pid', 1, 'TRAINING-CONFIRMED'
  FROM components WHERE slug = 'test-comp-restrict';

-- Create a session and an outcome attached to it
INSERT INTO diagnostic_sessions (vehicle_id, symptom_id, shop_id, tech_id)
  SELECT v.id, s.id, p.shop_id, p.id
  FROM vehicles v, symptoms s, profiles p
  WHERE s.slug = 'test-symptom-restrict'
    AND p.shop_id IS NOT NULL
  LIMIT 1
  RETURNING id;
-- Capture the session id manually for the next insert (or use a CTE)

-- For brevity, assume the test runner adapts this. The critical assertion:
-- DELETE FROM diagnostic_sessions WHERE id = <session_with_outcomes>
-- Expected: ERROR — update or delete on table violates foreign key constraint
ROLLBACK;
EOF
```

Expected: the DELETE of a session with attached outcomes raises a foreign-key violation error.

If you'd rather run this without fixtures, simply confirm the FK definition matches by:

```bash
psql -d vyntechs_rehearsal -c "
  SELECT conname, confdeltype FROM pg_constraint
  WHERE conrelid = 'tech_outcomes'::regclass AND contype = 'f';
"
```

Expected: a row for the `session_id` FK with `confdeltype = 'r'` (RESTRICT).

- [ ] **Step 8: Run CHECK constraint violation tests**

```bash
psql -d vyntechs_rehearsal <<'EOF'
-- Each of these should fail. Run individually inside transactions.

BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('check-test-platform', '2020', 'Test', 'TestFamily');
INSERT INTO components (slug, platform_id, name, kind, source_provenance)
  SELECT 'check-test-comp', id, 'Test', 'sensor', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'check-test-platform';

-- Should fail: invasiveness out of range
INSERT INTO test_actions (slug, component_id, description, scenario_required, observation_method, invasiveness, source_provenance)
  SELECT 'check-bad-invasive', id, 'test', 'idle', 'scan_tool_pid', 7, 'TRAINING-CONFIRMED'
  FROM components WHERE slug = 'check-test-comp';
-- Expected: ERROR — new row for relation "test_actions" violates check constraint "test_actions_invasiveness_range"

ROLLBACK;
EOF
```

Similarly run quick tests for:
- `confidence_boost = -5` on test_actions → ERROR
- `cumulative_confidence = 150` on diagnostic_sessions → ERROR
- `priority = 100` on symptom_test_implications → ERROR

All four should fail their respective CHECK constraints.

- [ ] **Step 9: Run retirement invariant test**

```bash
psql -d vyntechs_rehearsal <<'EOF'
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('retirement-test-platform', '2020', 'Test', 'TestFamily');

-- Insert two facts
INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
  SELECT 'fact-a', id, 'fact A', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'retirement-test-platform';
INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
  SELECT 'fact-b', id, 'fact B', 'FIELD-VERIFIED'
  FROM platforms WHERE slug = 'retirement-test-platform';

-- Try to set fact-a's replaced_by_id WITHOUT marking it retired — should fail
UPDATE architecture_facts
  SET replaced_by_id = (SELECT id FROM architecture_facts WHERE slug = 'fact-b')
  WHERE slug = 'fact-a';
-- Expected: ERROR — new row violates check constraint "architecture_facts_retirement_invariant"

ROLLBACK;
EOF
```

Expected: CHECK constraint violation.

- [ ] **Step 10: Run partial unique index tests**

```bash
psql -d vyntechs_rehearsal <<'EOF'
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('punique-test-platform', '2020', 'Test', 'TestFamily');

-- Insert two facts with same slug, both active — second should fail
INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
  SELECT 'punique-fact', id, 'first', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'punique-test-platform';

INSERT INTO architecture_facts (slug, platform_id, description, source_provenance)
  SELECT 'punique-fact', id, 'second', 'TRAINING-CONFIRMED'
  FROM platforms WHERE slug = 'punique-test-platform';
-- Expected: ERROR — duplicate key value violates unique constraint "architecture_facts_slug_active_unique"

ROLLBACK;
EOF
```

Then verify that the partial constraint correctly ALLOWS the retirement pattern:

```bash
psql -d vyntechs_rehearsal <<'EOF'
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('punique-test-platform-2', '2020', 'Test', 'TestFamily');

INSERT INTO architecture_facts (slug, platform_id, description, source_provenance, is_retired)
  SELECT 'retire-test-fact', id, 'old', 'TRAINING-CONFIRMED', true
  FROM platforms WHERE slug = 'punique-test-platform-2';

INSERT INTO architecture_facts (slug, platform_id, description, source_provenance, is_retired)
  SELECT 'retire-test-fact', id, 'new', 'FIELD-VERIFIED', false
  FROM platforms WHERE slug = 'punique-test-platform-2';
-- Expected: SUCCESS — partial unique only enforces among is_retired = false

SELECT count(*) FROM architecture_facts WHERE slug = 'retire-test-fact';
-- Expected: 2

ROLLBACK;
EOF
```

Expected: two rows with same slug coexist when one is retired.

- [ ] **Step 11: Verify the `platform_equivalents` canonical-ordering CHECK**

```bash
psql -d vyntechs_rehearsal <<'EOF'
BEGIN;
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('eq-platform-a', '2020', 'Test', 'TestA');
INSERT INTO platforms (slug, year_range, parent_make, parent_model_family)
  VALUES ('eq-platform-b', '2020', 'Test', 'TestB');

-- Get the two UUIDs, sort by string comparison
WITH ids AS (
  SELECT
    (SELECT id FROM platforms WHERE slug = 'eq-platform-a') AS a,
    (SELECT id FROM platforms WHERE slug = 'eq-platform-b') AS b
)
SELECT
  CASE WHEN a < b THEN 'a-first' ELSE 'b-first' END AS canonical_order,
  a, b
FROM ids;

-- Insert with WRONG ordering should fail
-- (depends on the actual UUID ordering; this is illustrative)
-- If 'b' < 'a', then INSERT (platform_a_id = a, platform_b_id = b, ...) violates CHECK
INSERT INTO platform_equivalents (platform_a_id, platform_b_id, system, verdict, source_provenance)
  SELECT
    (SELECT id FROM platforms WHERE slug = 'eq-platform-a'),
    (SELECT id FROM platforms WHERE slug = 'eq-platform-b'),
    'fuel',
    'FULLY',
    'TRAINING-CONFIRMED';
-- May fail OR succeed depending on UUID ordering.

-- Insert with CORRECT canonical ordering should succeed.

ROLLBACK;
EOF
```

The point of this test is to verify the CHECK constraint is enforced; exact behavior depends on the random UUIDs generated. Adjust ordering and re-run if needed. Expected: at least one of the two insert directions (a→b or b→a) fails with the canonical_ordering CHECK violation.

- [ ] **Step 12: Document rehearsal results**

Create a brief note (NOT a committed file — just notes for Brandon's approval review):

```
Rehearsal log — 2026-05-19
Migration: drizzle/migrations/0017_<name>.sql
DB: vyntechs_rehearsal

✓ Migration applied without errors
✓ All 12 tables present
✓ vehicles.platform_id added
✓ RLS policies attached to tech_outcomes and diagnostic_sessions (4 each)
✓ Cascade test (platforms → architecture_facts): cascade fired correctly
✓ RESTRICT test (tech_outcomes.session_id): FK definition confirms confdeltype = 'r'
✓ CHECK constraints fired correctly:
  - invasiveness = 7 → blocked
  - confidence_boost = -5 → blocked
  - cumulative_confidence = 150 → blocked
  - priority = 100 → blocked
✓ Retirement invariant: setting replaced_by_id on an active row → blocked
✓ Partial unique on slug: two active rows with same slug → blocked
✓ Partial unique allows retirement pattern: retired row + active row same slug → ok
✓ platform_equivalents canonical-ordering CHECK: wrong ordering → blocked
```

- [ ] **Step 13: No commit at end of Task 3**

Task 3 changes nothing in the repo (only local DB state was exercised). Move to Task 4.

---

## Task 4: Apply to live Supabase + post-apply verification

**HALT for Brandon's per-op approval** before any live-DB write.

**Files:**
- No new files (live DB state only).

- [ ] **Step 1: Surface migration SQL + rehearsal log to Brandon**

Show Brandon:
1. The full migration file `drizzle/migrations/0017_*.sql` (or a summary if very long)
2. The rehearsal log from Task 3 Step 12

Wait for explicit approval before proceeding. Do NOT proceed to Step 2 without it.

- [ ] **Step 2: Apply migration to live Supabase via MCP**

Use the Supabase MCP `apply_migration` tool with:
- `project_id`: `ynmtszuybeenjbigxdyl` (the live Vyntechs project from `project_wiring_tool_diagnostic_complete` memory)
- `name`: `0017_<auto_name>` (matching the local file name without the `.sql`)
- `query`: the full contents of `drizzle/migrations/0017_*.sql`

Expected: migration applies cleanly. If errors, report to Brandon — do NOT attempt manual fixes against live without per-op approval.

- [ ] **Step 3: Run `get_advisors` to catch lints**

Use Supabase MCP `get_advisors` tool with:
- `project_id`: `ynmtszuybeenjbigxdyl`
- `type`: `security`

Then again with `type: 'performance'`.

Expected: no NEW lints beyond what was present pre-migration. If new lints appear:
- **Unindexed FK** → check the spec; add the missing index in a follow-up migration (with Brandon's approval).
- **Missing RLS** → check whether the table is in the "shared graph" set (no RLS expected) or the "shop-scoped" set (RLS required). If RLS is missing on a shop-scoped table, add it in a follow-up.
- **Other** → report to Brandon and adjust.

- [ ] **Step 4: Functional RLS verification (live DB, BEGIN/ROLLBACK envelope)**

Use Supabase MCP `execute_sql` with:
- `project_id`: `ynmtszuybeenjbigxdyl`
- `query`:

```sql
BEGIN;

-- Verify the RLS policies attached
SELECT polname, polcmd, polpermissive
FROM pg_policy
WHERE polrelid IN ('tech_outcomes'::regclass, 'diagnostic_sessions'::regclass)
ORDER BY polrelid, polname;
-- Expected: 8 rows total — 4 policies on each table

-- Verify a sample INSERT into tech_outcomes would respect RLS
-- (this requires being authenticated as a user with a profile pointing at a shop;
-- if running as the service_role, RLS is bypassed — so this test only confirms
-- policies are syntactically valid, not functional under user-session auth)

ROLLBACK;
```

Expected: 8 policy rows returned. If fewer, the policies didn't attach correctly — investigate.

For true functional RLS verification (insert as a real user, verify own-shop succeeds and cross-shop fails), Brandon needs to test from the actual authenticated app session. This is a manual step:
1. Brandon (or the dev environment) signs in as a normal user
2. Runs an INSERT against tech_outcomes with a shop_id matching their profile → expect success
3. Runs an INSERT with a fake shop_id → expect RLS rejection

Confirm with Brandon that this verification step is complete before declaring Phase 1 done.

- [ ] **Step 5: Final commit**

If anything was patched during application (unlikely), commit. Otherwise, the previous Task 2 commit already has the final state.

If a tweak was needed:

```bash
git add drizzle/migrations/0017_*.sql
git commit -m "$(cat <<'EOF'
fix(db): post-apply tweak to diagnostic orchestration migration

[describe what was tweaked and why]

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Phase 1 done**

Verify Phase 1 exit criteria:
- ✓ All 12 new tables present in live Supabase
- ✓ `vehicles.platform_id` column added
- ✓ All RLS policies, partial unique indexes, CHECK constraints applied
- ✓ `get_advisors` clean
- ✓ Rehearsal log shows constraint behavior matches spec
- ✓ Brandon has functionally verified RLS via authenticated app session

Phase 2 (smallest-viable-test against live DB) is now unblocked.

---

## Self-Review Checklist (run before declaring plan complete)

- [ ] All 12 tables from the spec covered in Task 1 (one step each).
- [ ] `vehicles.platform_id` covered (Task 1 Step 14).
- [ ] All relations() exports covered (Task 1 Step 15).
- [ ] All type exports covered (Task 1 Step 16).
- [ ] Migration generation covered (Task 2 Step 1).
- [ ] All hand-written DDL categories covered: RLS, partial unique on slug (5 tables), partial unique on junction tuples (3 tables), partial active-row indexes (5 tables), retirement invariant CHECK (8 tables), range CHECK (4 columns), value-shape CHECK (3 constraints), DESC index replacement (1).
- [ ] All cascade test cases from spec §8 step 5 covered in Task 3.
- [ ] All CHECK constraint test cases from spec §8 step 5 covered in Task 3.
- [ ] Per-op approval gate before live application (Task 4 Step 1).
- [ ] `get_advisors` post-apply check (Task 4 Step 3).
- [ ] Functional RLS verification path documented (Task 4 Step 4).

If any checkbox above is unchecked, add the missing step before handing off.
