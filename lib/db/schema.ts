import { relations, sql } from 'drizzle-orm'
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
import type { TreeState } from '../ai/tree-engine'

export type { TreeState }

export type RiskClass = 'zero' | 'low' | 'medium' | 'high' | 'destructive'

export const shops = pgTable('shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique(),
  shopId: uuid('shop_id').references(() => shops.id),
  fullName: text('full_name'),
  role: text('role').default('tech').notNull(),
  isComp: boolean('is_comp').default(false).notNull(),
  lastSeenWhatsNewAt: timestamp('last_seen_whats_new_at', { withTimezone: true }),
  deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'cascade' }).notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('customers_shop_id_phone_idx').on(table.shopId, table.phone)],
)

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

export type AmbientConditions = {
  temperatureF: number
  humidityPct?: number
  windKph?: number
  conditions?: string
  source: 'geolocation' | 'manual'
  capturedAt: string
  approxLat?: number
  approxLon?: number
}

export type IntakePayload = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  mileage?: number
  customerComplaint: string
  ambientConditions?: AmbientConditions
}


export type OutcomePayload = {
  rootCause: string
  actionType: 'part_replacement' | 'repair' | 'adjustment' | 'cleaning' | 'no_fix' | 'referred'
  partInfo?: { name: string; oemNumber?: string; aftermarket?: string; cost?: number }
  verification: { codesCleared: boolean; testDrive: boolean; symptomsResolved: 'yes' | 'no' | 'partial' }
  diagMinutes: number
  repairMinutes: number
  notes?: string
  override?: { at: string; lastFeedback: string }
}

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').references(() => shops.id).notNull(),
  techId: uuid('tech_id').references(() => profiles.id).notNull(),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  status: text('status', { enum: ['open', 'closed', 'declined', 'deferred'] }).notNull().default('open'),
  intake: jsonb('intake').notNull().$type<IntakePayload>(),
  treeState: jsonb('tree_state').notNull().$type<TreeState>(),
  outcome: jsonb('outcome').$type<OutcomePayload>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  curatorNote: text('curator_note'),
  curatorOverrideAction: text('curator_override_action'),
  maxCorpusSimilarity: real('max_corpus_similarity'),
})

export const sessionEvents = pgTable('session_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => sessions.id, { onDelete: 'cascade' })
    .notNull(),
  nodeId: text('node_id').notNull(),
  eventType: text('event_type', {
    enum: [
      'advance',
      'observation',
      'tree_update',
      'close',
      'repair_observation',
      'repair_guidance',
    ],
  }).notNull(),
  observationText: text('observation_text'),
  aiResponse: jsonb('ai_response').$type<{
    nextNodeId?: string
    /** Full text of the AI's `message` field at this turn. Persisted from
     *  `advanceSession` so the curator timeline can reconstruct the
     *  back-and-forth turn-by-turn — `treeState.message` only carries the
     *  latest reply. Optional for back-compat with rows written before
     *  2026-05-09. */
    messageText?: string
    treeUpdate?: unknown
    requestedFollowUp?: string
    abandon?: {
      reason: 'mistake' | 'test' | 'wrong_vehicle' | 'customer_left' | 'other'
      note?: string
    }
    repairGuidance?: {
      text: string
      tangentialConcerns?: string[]
    }
    declineOrDefer?: {
      reason: 'decline' | 'defer'
      gap: string
      riskClass: 'low' | 'medium' | 'high' | 'destructive'
      language: {
        customerMessage: string
        internalNote: string
        recommendedReferral?: string
      }
    }
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const confidenceCalibration = pgTable('confidence_calibration', {
  id: uuid('id').primaryKey().defaultRandom(),
  riskClass: text('risk_class', {
    enum: ['zero', 'low', 'medium', 'high', 'destructive'],
  }).notNull(),
  vehicleFamily: text('vehicle_family').notNull(),
  symptomClass: text('symptom_class').notNull(),
  thresholdPct: real('threshold_pct').notNull(),
  sampleSize: integer('sample_size').notNull().default(0),
  comebackRate: real('comeback_rate').notNull().default(0),
  lastRefitAt: timestamp('last_refit_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const techAssistRequests = pgTable('tech_assist_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => sessions.id, { onDelete: 'cascade' })
    .notNull(),
  nodeId: text('node_id').notNull(),
  gapDescription: text('gap_description').notNull(),
  requestedArtifactKind: text('requested_artifact_kind').notNull(),
  requestPrompt: text('request_prompt').notNull(),
  followUpCount: integer('follow_up_count').notNull().default(0),
  resolved: boolean('resolved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const stripeCustomers = pgTable('stripe_customers', {
  shopId: uuid('shop_id').primaryKey().references(() => shops.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
    nodeId: text('node_id').notNull(),
    kind: text('kind', {
      enum: ['photo', 'video', 'audio', 'scan_screen', 'wiring_diagram'],
    }).notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes').notNull(),
    durationMs: integer('duration_ms'),
    extraction: jsonb('extraction').$type<{
      text?: string
      structured?: Record<string, unknown>
      summary?: string
    }>(),
    extractionStatus: text('extraction_status', {
      enum: ['pending', 'done', 'failed'],
    }).notNull().default('pending'),
    storageTier: text('storage_tier', {
      enum: ['hot', 'warm', 'cold'],
    }).notNull().default('hot'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('artifacts_session_id_idx').on(table.sessionId)],
)

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  session: one(sessions, { fields: [artifacts.sessionId], references: [sessions.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [sessions.techId], references: [profiles.id] }),
  vehicle: one(vehicles, { fields: [sessions.vehicleId], references: [vehicles.id] }),
  events: many(sessionEvents),
  artifacts: many(artifacts),
}))

export const customersRelations = relations(customers, ({ one, many }) => ({
  shop: one(shops, { fields: [customers.shopId], references: [shops.id] }),
  vehicles: many(vehicles),
}))

export const vehiclesRelations = relations(vehicles, ({ one, many }) => ({
  customer: one(customers, { fields: [vehicles.customerId], references: [customers.id] }),
  sessions: many(sessions),
}))

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(sessions, { fields: [sessionEvents.sessionId], references: [sessions.id] }),
}))

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  shop: one(shops, { fields: [profiles.shopId], references: [shops.id] }),
  sessions: many(sessions),
}))

export const shopsRelations = relations(shops, ({ many, one }) => ({
  profiles: many(profiles),
  sessions: many(sessions),
  stripeCustomer: one(stripeCustomers, { fields: [shops.id], references: [stripeCustomers.shopId] }),
}))

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

export type Shop = typeof shops.$inferSelect
export type NewShop = typeof shops.$inferInsert
export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type SessionEvent = typeof sessionEvents.$inferSelect
export type NewSessionEvent = typeof sessionEvents.$inferInsert
export type StripeCustomer = typeof stripeCustomers.$inferSelect
export type NewStripeCustomer = typeof stripeCustomers.$inferInsert
export type ConfidenceCalibration = typeof confidenceCalibration.$inferSelect
export type NewConfidenceCalibration = typeof confidenceCalibration.$inferInsert
export type TechAssistRequest = typeof techAssistRequests.$inferSelect
export type NewTechAssistRequest = typeof techAssistRequests.$inferInsert
export type Artifact = typeof artifacts.$inferSelect
export type NewArtifact = typeof artifacts.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type Vehicle = typeof vehicles.$inferSelect
export type NewVehicle = typeof vehicles.$inferInsert

export const retrievalCache = pgTable('retrieval_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  cacheKey: text('cache_key').notNull().unique(),
  source: text('source').notNull(),
  results: jsonb('results').notNull().$type<unknown[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export type RetrievalCache = typeof retrievalCache.$inferSelect
export type NewRetrievalCache = typeof retrievalCache.$inferInsert

// Drizzle has no first-class vector type — `embedding` is declared jsonb here
// as a bridge. The actual SQL column is `vector(1024)` (Voyage AI voyage-3
// model dim), enforced in `drizzle/migrations/0006_known_maximus.sql`
// (initial 1536) and resized in `0008_voyage_embedding_dims.sql`. HNSW
// cosine index lives alongside.
export const corpusEntries = pgTable('corpus_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  vehicleYear: integer('vehicle_year').notNull(),
  vehicleMake: text('vehicle_make').notNull(),
  vehicleModel: text('vehicle_model').notNull(),
  vehicleEngine: text('vehicle_engine'),
  buildDateStart: text('build_date_start'),
  buildDateEnd: text('build_date_end'),
  symptomTags: text('symptom_tags').array().notNull().default([]),
  dtcs: text('dtcs').array().notNull().default([]),
  freezeFramePattern: jsonb('freeze_frame_pattern').$type<Record<string, string | number>>(),
  rootCause: text('root_cause').notNull(),
  summary: text('summary').notNull(),
  actionType: text('action_type', {
    enum: ['part_replacement', 'repair', 'adjustment', 'cleaning', 'no_fix', 'referred'],
  }).notNull(),
  partInfo: jsonb('part_info').$type<{ name?: string; oemNumber?: string; cost?: number }>(),
  verification: jsonb('verification').$type<{
    codesCleared: boolean
    testDrive: boolean
    symptomsResolved: 'yes' | 'no' | 'partial'
  }>().notNull(),
  sourceShopId: uuid('source_shop_id').references(() => shops.id),
  sourceSessionId: uuid('source_session_id').references(() => sessions.id),
  curatedByUserId: uuid('curated_by_user_id').references(() => profiles.id),
  successConfirmCount: integer('success_confirm_count').notNull().default(0),
  comebackRecordedCount: integer('comeback_recorded_count').notNull().default(0),
  confidenceScore: real('confidence_score').notNull().default(0.5),
  isCuratorEntry: boolean('is_curator_entry').notNull().default(false),
  // Provenance for retrieval ranking + tree-engine prompt tagging.
  // 'founder' rows are surfaced first by retrieveCorpus and tagged as
  // SHOP-OWNER VERIFIED in the prompt. Backfilled in 0013 from the legacy
  // is_curator_entry boolean.
  entrySource: text('entry_source', {
    enum: ['founder', 'curator', 'auto_promoted'],
  }).notNull().default('auto_promoted'),
  isRetired: boolean('is_retired').notNull().default(false),
  embedding: jsonb('embedding').$type<number[] | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const corpusEntriesRelations = relations(corpusEntries, ({ one }) => ({
  shop: one(shops, { fields: [corpusEntries.sourceShopId], references: [shops.id] }),
  session: one(sessions, { fields: [corpusEntries.sourceSessionId], references: [sessions.id] }),
  curator: one(profiles, { fields: [corpusEntries.curatedByUserId], references: [profiles.id] }),
}))

export type CorpusEntry = typeof corpusEntries.$inferSelect
export type NewCorpusEntry = typeof corpusEntries.$inferInsert

// Phase R — Comeback follow-up automation. A close-session writes 7d + 30d
// rows; a daily cron flips surfaced_at when due_at passes; a tech resolution
// flips resolved_at + comeback_recorded. comeback_recorded = true triggers
// recordCorpusComeback() which decays matching corpus entries.
export const followUps = pgTable(
  'follow_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    shopId: uuid('shop_id')
      .references(() => shops.id, { onDelete: 'cascade' })
      .notNull(),
    techId: uuid('tech_id')
      .references(() => profiles.id)
      .notNull(),
    kind: text('kind', { enum: ['7d', '30d'] }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    surfacedAt: timestamp('surfaced_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    comebackRecorded: boolean('comeback_recorded'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('follow_ups_session_id_idx').on(table.sessionId),
    index('follow_ups_shop_id_idx').on(table.shopId),
    index('follow_ups_tech_id_idx').on(table.techId),
    index('follow_ups_due_at_idx').on(table.dueAt),
  ],
)

export const followUpsRelations = relations(followUps, ({ one }) => ({
  session: one(sessions, { fields: [followUps.sessionId], references: [sessions.id] }),
  shop: one(shops, { fields: [followUps.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [followUps.techId], references: [profiles.id] }),
}))

export type FollowUp = typeof followUps.$inferSelect
export type NewFollowUp = typeof followUps.$inferInsert

// Phase Q — Calibration drift alerts. The weekly calibration cron writes a
// row whenever a per-cell threshold moves by ≥5 points and the sample size is
// adequate. The curator drift dashboard reads this table to surface cells
// where the AI's calibration has shifted (corpus quality signal). Append-only.
export const driftAlerts = pgTable('drift_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  riskClass: text('risk_class', {
    enum: ['zero', 'low', 'medium', 'high', 'destructive'],
  }).notNull(),
  vehicleFamily: text('vehicle_family').notNull(),
  symptomClass: text('symptom_class').notNull(),
  oldThreshold: real('old_threshold').notNull(),
  newThreshold: real('new_threshold').notNull(),
  comebackRate: real('comeback_rate').notNull(),
  sampleSize: integer('sample_size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // Phase P lifecycle fields:
  decision: text('decision', { enum: ['applied', 'dismissed'] }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedByUserId: uuid('decided_by_user_id').references(() => profiles.id),
  decisionNote: text('decision_note'),
}, (t) => ({
  pendingIdx: index('drift_alerts_pending_idx').on(t.createdAt.desc()).where(sql`decision IS NULL`),
}))

export type DriftAlert = typeof driftAlerts.$inferSelect
export type NewDriftAlert = typeof driftAlerts.$inferInsert

export const novelPatternQueue = pgTable('novel_pattern_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  maxRetrievalSimilarity: real('max_retrieval_similarity').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedDecision: text('reviewed_decision', { enum: ['corpus', 'dismissed'] }),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => profiles.id),
  reviewedNote: text('reviewed_note'),
}, (t) => ({
  pendingIdx: index('novel_pattern_queue_pending_idx').on(t.createdAt.desc()).where(sql`reviewed_at IS NULL`),
}))

export type NovelPatternQueueRow = typeof novelPatternQueue.$inferSelect
export type NewNovelPatternQueueRow = typeof novelPatternQueue.$inferInsert

// Founder knowledge base — every free-form note from the shop owner lands
// here first. structuredDraft holds whatever the LLM extracted (may be
// partial or null on parse failure); the founder reviews each row at
// /curator/founder-notes/[id] and either promotes (insert into corpus_entries
// with entry_source='founder', confidence_score=0.95) or dismisses.
export const founderNotesQueue = pgTable('founder_notes_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  rawText: text('raw_text').notNull(),
  structuredDraft: jsonb('structured_draft').$type<Record<string, unknown> | null>(),
  parseStatus: text('parse_status', {
    enum: ['parsed', 'partial', 'failed'],
  }).notNull().default('failed'),
  missingFields: text('missing_fields').array().notNull().default([]),
  llmNotes: text('llm_notes'),
  createdByUserId: uuid('created_by_user_id').references(() => profiles.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedDecision: text('reviewed_decision', { enum: ['promoted', 'dismissed'] }),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => profiles.id),
  reviewedNote: text('reviewed_note'),
  resultingCorpusEntryId: uuid('resulting_corpus_entry_id').references(() => corpusEntries.id, {
    onDelete: 'set null',
  }),
}, (t) => ({
  pendingIdx: index('founder_notes_queue_pending_idx').on(t.createdAt.desc()).where(sql`reviewed_at IS NULL`),
}))

export type FounderNotesQueueRow = typeof founderNotesQueue.$inferSelect
export type NewFounderNotesQueueRow = typeof founderNotesQueue.$inferInsert

// What's New — per-deploy changelog entries surfaced to logged-in users.
// Brandon authors rows by hand via Supabase MCP execute_sql. Each user has
// a `last_seen_whats_new_at` timestamp on `profiles`; entries newer than
// that mark the in-nav badge "New" and render with a "new" pill on the
// /whats-new page.
export const whatsNewEntries = pgTable(
  'whats_new_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('whats_new_entries_published_at_idx').on(table.publishedAt.desc())],
)

export type WhatsNewEntry = typeof whatsNewEntries.$inferSelect
export type NewWhatsNewEntry = typeof whatsNewEntries.$inferInsert

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
