import { relations } from 'drizzle-orm'
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type IntakePayload = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  vehicleEngine?: string
  mileage?: number
  customerComplaint: string
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
  status: text('status', { enum: ['open', 'closed', 'declined', 'deferred'] }).notNull().default('open'),
  intake: jsonb('intake').notNull().$type<IntakePayload>(),
  treeState: jsonb('tree_state').notNull().$type<TreeState>(),
  outcome: jsonb('outcome').$type<OutcomePayload>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
})

export const sessionEvents = pgTable('session_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .references(() => sessions.id, { onDelete: 'cascade' })
    .notNull(),
  nodeId: text('node_id').notNull(),
  eventType: text('event_type', { enum: ['advance', 'observation', 'tree_update', 'close'] }).notNull(),
  observationText: text('observation_text'),
  aiResponse: jsonb('ai_response').$type<{
    nextNodeId?: string
    treeUpdate?: unknown
    requestedFollowUp?: string
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
  events: many(sessionEvents),
  artifacts: many(artifacts),
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
})

export type DriftAlert = typeof driftAlerts.$inferSelect
export type NewDriftAlert = typeof driftAlerts.$inferInsert
