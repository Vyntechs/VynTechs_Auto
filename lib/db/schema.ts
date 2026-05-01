import { relations } from 'drizzle-orm'
import { pgTable, uuid, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core'

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

export type TreeState = {
  nodes: Array<{
    id: string
    label: string
    status: 'pending' | 'active' | 'resolved' | 'pruned'
    children?: string[]
  }>
  currentNodeId: string
}

export type OutcomePayload = {
  rootCause: string
  actionType: 'part_replacement' | 'repair' | 'adjustment' | 'cleaning' | 'no_fix' | 'referred'
  partInfo?: { name: string; oemNumber?: string; aftermarket?: string; cost?: number }
  verification: { codesCleared: boolean; testDrive: boolean; symptomsResolved: 'yes' | 'no' | 'partial' }
  diagMinutes: number
  repairMinutes: number
  notes?: string
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
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const stripeCustomers = pgTable('stripe_customers', {
  shopId: uuid('shop_id').primaryKey().references(() => shops.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  subscriptionStatus: text('subscription_status'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
  tech: one(profiles, { fields: [sessions.techId], references: [profiles.id] }),
  events: many(sessionEvents),
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
