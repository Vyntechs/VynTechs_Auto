import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import type { TreeState } from '../ai/tree-engine'
import type { Flow, WizardState } from '../flows/types'

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
  isCurator: boolean('is_curator').default(false).notNull(),
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
  wizardState: jsonb('wizard_state').$type<WizardState | null>(),
  // Added by migration 0023 (interactive electrical topology). Tracks the
  // last scenario the tech picked, so the topology loader can restore it.
  lastScenarioSlug: text('last_scenario_slug'),
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
      'wizard_lock_in',
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
    /** Stashes the pinned flow_version a wizard lock-in handed off from, so
     *  PR-N5's stale-outcomes cron can read ai_response->'wizardLockIn'->>'flowVersionId'. */
    wizardLockIn?: { flowVersionId: string }
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

// Fixed-window rate limit counter. One row per (key, current minute window).
// See lib/rate-limit.ts for the upsert logic and intended usage.
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    key: text('key').primaryKey(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [index('idx_rate_limit_buckets_window_start').on(table.windowStart)],
)

// ===== Curator + flow authoring (PR-N1) =====
//
// Architecture: spec §6 of docs/superpowers/specs/2026-05-26-6.0-psd-cranks-no-start-flow-design.md
// Schema pressure-test: docs/superpowers/research/2026-05-26-curator/agent-01-schema-patterns.md
//
// SLUG REALIGNMENT (2026-05-30): flows + research_runs key on platform_slug /
// symptom_slug TEXT, NOT uuid FKs to platforms(id)/symptoms(id). main has no
// platforms/symptoms tables in this schema; the PGlite test DB applies only the
// main-line migrations, so a FK to platforms would fail the whole suite at
// migrate time. Referential integrity moves to authoring/publish time (PR-N2).
//
// Conventions:
//  - flow_versions is immutable after publish; "edit" creates a new draft row.
//  - Exactly one row per flow_id may have state='published' (partial unique index).
//  - flow_outcomes rows are NEVER deleted (ON DELETE RESTRICT); they are the moat.
//  - body_schema_version lets future Flow-type evolutions live alongside pinned
//    in-flight sessions.

export const flowVersionState = pgEnum('flow_version_state', [
  'draft',
  'published',
  'archived',
])

export const flowOutcomeKind = pgEnum('flow_outcome_kind', [
  'confirmed_fix',
  'returned_comeback',
  'misdiagnosis',
  'inconclusive',
  'abandoned',
])

export const researchRunStatus = pgEnum('research_run_status', [
  'running',
  'completed',
  'failed',
  'partial',
])

export const flows = pgTable(
  'flows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    // SLUG REALIGNMENT: TEXT, not uuid FK. e.g. 'ford-super-duty-3rd-gen-60-psd'
    platformSlug: text('platform_slug').notNull(),
    symptomSlug: text('symptom_slug').notNull(), // e.g. 'cranks-no-start'
    displayTitle: text('display_title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    isRetired: boolean('is_retired').notNull().default(false),
  },
  (t) => ({
    // One active (platform_slug, symptom_slug) pair at a time — retired excluded.
    // Replaces the spec's UNIQUE(platform_id, symptom_id) WHERE is_retired=false.
    activePairUniq: uniqueIndex('flows_active_platform_symptom_uniq')
      .on(t.platformSlug, t.symptomSlug)
      .where(sql`is_retired = false`),
  }),
)

export const flowVersions = pgTable(
  'flow_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flows.id),
    versionNumber: integer('version_number').notNull(),
    state: flowVersionState('state').notNull(),
    // The Flow body (lib/flows/types.ts). Draft bodies are partial but stored
    // in the same column; $type<Flow> documents the published-body shape.
    body: jsonb('body').$type<Flow>().notNull(),
    // Lets the Flow shape evolve without breaking version-pinned in-flight
    // sessions. Bump when lib/flows/types.ts Flow changes non-additively.
    bodySchemaVersion: text('body_schema_version').notNull().default('1.0'),
    authoredBy: uuid('authored_by')
      .notNull()
      .references(() => profiles.id),
    authoredAt: timestamp('authored_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedBy: uuid('published_by').references(() => profiles.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => profiles.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    changeNote: text('change_note').notNull(),
    // Plain uuid — NO .references() here. The FK to research_runs is added by
    // the migration's trailing ALTER (research_runs is declared AFTER this
    // table; a Drizzle reference would force a circular declaration order).
    researchRunId: uuid('research_run_id'),
    // Self-FK — type the callback return as AnyPgColumn for the self-reference.
    forkedFromVersionId: uuid('forked_from_version_id').references(
      (): AnyPgColumn => flowVersions.id,
    ),
  },
  (t) => ({
    versionUniq: uniqueIndex('flow_versions_flow_version_uniq').on(
      t.flowId,
      t.versionNumber,
    ),
    onePublishedPerFlow: uniqueIndex('flow_versions_one_published_per_flow')
      .on(t.flowId)
      .where(sql`state = 'published'`),
  }),
)

export const flowOutcomes = pgTable(
  'flow_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    flowVersionId: uuid('flow_version_id')
      .notNull()
      .references(() => flowVersions.id, { onDelete: 'restrict' }),
    outcome: flowOutcomeKind('outcome').notNull(),
    outcomeNote: text('outcome_note'),
    taggedBy: uuid('tagged_by')
      .notNull()
      .references(() => profiles.id),
    taggedAt: timestamp('tagged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // One outcome per (session, version) — prevents double-counting in metrics.
    sessionVersionUniq: uniqueIndex('flow_outcomes_session_version_uniq').on(
      t.sessionId,
      t.flowVersionId,
    ),
  }),
)

export const researchRuns = pgTable('research_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  flowId: uuid('flow_id').references(() => flows.id), // null for first-time research
  // SLUG REALIGNMENT: TEXT, not uuid FK.
  platformSlug: text('platform_slug').notNull(),
  symptomSlug: text('symptom_slug').notNull(),
  status: researchRunStatus('status').notNull().default('running'),
  errorMessage: text('error_message'),
  agentOutputs: jsonb('agent_outputs').$type<unknown[]>().notNull().default([]),
  synthesisMd: text('synthesis_md').notNull().default(''),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  initiatedBy: uuid('initiated_by')
    .notNull()
    .references(() => profiles.id),
})

// ============================================================================
// DIAGNOSTIC / TOPOLOGY TABLES (PR0 — co-located from feat/6.0-psd-cranks-no-start-seed)
//
// Additive only. These mirror the diagnostic data model that already lives in
// prod (all tables present, with data). They back the auto-draw topology loader
// (lib/diagnostics/load-system-topology.ts) and the cached-lookup gate
// (lib/diagnostics/cached-lookup.ts). The PGlite unit DB builds them from
// migrations 0021–0023; the defs here register them for the Drizzle query API.
//
// Convention note: the curator/research line keys flows + research_runs on
// platform_slug / symptom_slug TEXT (NOT FK). That convention is untouched —
// the curator tables above add NO FKs to platforms/symptoms. These diagnostic
// tables use the seed line's UUID-FK relationships among themselves.
// ============================================================================

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
    systems: text('systems').array().notNull().default([]),
    subtitle: text('subtitle'),
    role: text('role'),
    wireSummary: text('wire_summary'),
    body: text('body'),
    probingTactic: text('probing_tactic'),
    unknownNote: text('unknown_note'),
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
    system: text('system'),
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
    stepKind: text('step_kind'),
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

// diagnostic_sessions + (the migration-created tech_outcomes) back the
// cached-lookup "prior fix count" gate. cached-lookup.ts queries
// diagnostic_sessions directly, so it must be registered here.
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

// Per-check outcome log for the interactive diagnostic loop. Created in
// migration 0021_diagnostic_orchestration.sql; registered here so app code can
// write/query it. One row per confirmed check the tech performs.
export const techOutcomes = pgTable('tech_outcomes', {
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
  verdict: text('verdict').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
})

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
    electricalRole: electricalRoleEnum('electrical_role'),
    fromPinId: uuid('from_pin_id'),
    toPinId: uuid('to_pin_id'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('component_pins_component_id_idx').on(table.componentId),
  ],
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('system_scenarios_lookup_idx').on(table.platformId, table.system),
  ],
)

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
  (t) => [
    primaryKey({ columns: [t.scenarioId, t.pinId] }),
  ],
)

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
    isOutOfRange: boolean('is_out_of_range'),
  },
  (t) => [
    primaryKey({ columns: [t.pinId, t.scenarioId] }),
  ],
)

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
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.platformId, t.system] }),
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
