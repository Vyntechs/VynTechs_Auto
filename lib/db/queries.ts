import { and, desc, eq, gt, or, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type * as schema from './schema'
import {
  shops,
  profiles,
  sessions,
  sessionEvents,
  confidenceCalibration,
  techAssistRequests,
  artifacts,
  whatsNewEntries,
  type WhatsNewEntry,
  type Shop,
  type NewShop,
  type Profile,
  type NewProfile,
  type Session,
  type NewSession,
  type SessionEvent,
  type NewSessionEvent,
  type TreeState,
  type OutcomePayload,
  type IntakePayload,
  type RiskClass,
  type Artifact,
  type NewArtifact,
} from './schema'

export const TECH_ASSIST_RUNG_2_BUDGET = 3

export const SPEC_8_3_FALLBACK: Record<RiskClass, number> = {
  zero: 0,
  low: 0.7,
  medium: 0.8,
  high: 0.9,
  destructive: 0.95,
}

export type AppDb =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>

export async function createShop(db: AppDb, input: NewShop): Promise<Shop> {
  const [shop] = await db.insert(shops).values(input).returning()
  return shop
}

export async function getShopById(db: AppDb, id: string): Promise<Shop | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, id)).limit(1)
  return shop ?? null
}

export async function createProfile(db: AppDb, input: NewProfile): Promise<Profile> {
  const [profile] = await db.insert(profiles).values(input).returning()
  return profile
}

export async function getProfileByUserId(db: AppDb, userId: string): Promise<Profile | null> {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
  return profile ?? null
}

export async function createSession(db: AppDb, input: NewSession): Promise<Session> {
  const [session] = await db.insert(sessions).values(input).returning()
  return session
}

export async function ensureProfileAndShop(
  db: AppDb,
  userId: string,
  email: string,
): Promise<Profile> {
  const existing = await getProfileByUserId(db, userId)
  if (existing) return existing
  const [shop] = await db.insert(shops).values({ name: `${email}'s Shop` }).returning()
  const [profile] = await db
    .insert(profiles)
    .values({ userId, role: 'owner', shopId: shop.id })
    .returning()
  return profile
}

export async function getSessionById(db: AppDb, id: string) {
  return db.query.sessions.findFirst({
    where: eq(sessions.id, id),
    with: { shop: true, tech: true },
  })
}

export async function listSessionsForShop(
  db: AppDb,
  shopId: string,
): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.shopId, shopId))
    .orderBy(desc(sessions.createdAt))
}

export async function listSessionsForVehicle(
  db: AppDb,
  vehicleId: string,
): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.vehicleId, vehicleId))
    .orderBy(desc(sessions.createdAt))
}

export async function getOpenSessionForTech(
  db: AppDb,
  techId: string,
): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.techId, techId), eq(sessions.status, 'open')))
    .limit(1)
  return session ?? null
}

/**
 * Count open sessions for a tech. Used by /api/sessions to enforce the
 * MAX_OPEN_SESSIONS_PER_TECH cap so a tech can have multiple in-flight
 * jobs (parts wait, customer phone tag, lunch between bays — real shop
 * reality) but not unlimited (avoids accidental queue-explosion).
 */
export async function countOpenSessionsForTech(
  db: AppDb,
  techId: string,
): Promise<number> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.techId, techId), eq(sessions.status, 'open')))
  return rows.length
}

export async function appendSessionEvent(
  db: AppDb,
  input: NewSessionEvent,
): Promise<SessionEvent> {
  const [event] = await db.insert(sessionEvents).values(input).returning()
  return event
}

export async function updateSessionTreeState(
  db: AppDb,
  sessionId: string,
  treeState: TreeState,
): Promise<void> {
  await db.update(sessions).set({ treeState }).where(eq(sessions.id, sessionId))
}

export async function updateSessionIntake(
  db: AppDb,
  sessionId: string,
  intake: IntakePayload,
): Promise<void> {
  await db.update(sessions).set({ intake }).where(eq(sessions.id, sessionId))
}

/**
 * Persists the max corpus similarity score for a session using a GREATEST
 * pattern so concurrent writes (unlikely but possible) are safe. Only updates
 * when the new value exceeds the currently stored value (NULL treated as 0).
 */
export async function updateSessionMaxCorpusSimilarity(
  db: AppDb,
  sessionId: string,
  newMax: number,
): Promise<void> {
  await db.execute(
    sql`UPDATE sessions
        SET max_corpus_similarity = GREATEST(COALESCE(max_corpus_similarity, 0), ${newMax})
        WHERE id = ${sessionId}`,
  )
}

export async function getThreshold(
  db: AppDb,
  input: {
    riskClass: RiskClass
    vehicleFamily?: string
    symptomClass?: string
  },
): Promise<number> {
  const vf = input.vehicleFamily ?? '*'
  const sc = input.symptomClass ?? '*'
  const rows = await db
    .select()
    .from(confidenceCalibration)
    .where(
      and(
        eq(confidenceCalibration.riskClass, input.riskClass),
        or(eq(confidenceCalibration.vehicleFamily, vf), eq(confidenceCalibration.vehicleFamily, '*')),
        or(eq(confidenceCalibration.symptomClass, sc), eq(confidenceCalibration.symptomClass, '*')),
      ),
    )
  if (rows.length === 0) return SPEC_8_3_FALLBACK[input.riskClass]
  const score = (r: (typeof rows)[number]) =>
    (r.vehicleFamily !== '*' ? 2 : 0) + (r.symptomClass !== '*' ? 1 : 0)
  rows.sort((a, b) => score(b) - score(a))
  return Number(rows[0].thresholdPct)
}

export async function closeSession(
  db: AppDb,
  sessionId: string,
  outcome: OutcomePayload,
): Promise<Session> {
  const [updated] = await db
    .update(sessions)
    .set({ outcome, status: 'closed', closedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'open')))
    .returning()
  if (!updated) throw new Error('session is not open or does not exist')
  return updated
}

export async function recordTechAssistRequest(
  db: AppDb,
  input: {
    sessionId: string
    nodeId: string
    artifactKind: string
    requestPrompt: string
    gapDescription: string
  },
): Promise<{ exhausted: boolean; followUpCount: number }> {
  const [existing] = await db
    .select()
    .from(techAssistRequests)
    .where(
      and(
        eq(techAssistRequests.sessionId, input.sessionId),
        eq(techAssistRequests.nodeId, input.nodeId),
        eq(techAssistRequests.resolved, false),
      ),
    )
    .limit(1)

  if (existing) {
    const nextCount = existing.followUpCount + 1
    await db
      .update(techAssistRequests)
      .set({ followUpCount: nextCount })
      .where(eq(techAssistRequests.id, existing.id))
    return {
      exhausted: nextCount >= TECH_ASSIST_RUNG_2_BUDGET,
      followUpCount: nextCount,
    }
  }

  await db.insert(techAssistRequests).values({
    sessionId: input.sessionId,
    nodeId: input.nodeId,
    gapDescription: input.gapDescription,
    requestedArtifactKind: input.artifactKind,
    requestPrompt: input.requestPrompt,
  })
  return { exhausted: false, followUpCount: 0 }
}

export async function setSessionTerminalStatus(
  db: AppDb,
  sessionId: string,
  status: 'declined' | 'deferred',
): Promise<Session> {
  const [updated] = await db
    .update(sessions)
    .set({ status, closedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'open')))
    .returning()
  if (!updated) throw new Error('session is not open or does not exist')
  return updated
}

export async function createArtifact(db: AppDb, input: NewArtifact): Promise<string> {
  const [row] = await db.insert(artifacts).values(input).returning()
  return row.id
}

export async function getArtifactById(db: AppDb, id: string): Promise<Artifact | null> {
  const row = await db.query.artifacts.findFirst({ where: eq(artifacts.id, id) })
  return row ?? null
}

export async function listArtifactsForSession(db: AppDb, sessionId: string): Promise<Artifact[]> {
  return db.query.artifacts.findMany({
    where: eq(artifacts.sessionId, sessionId),
    orderBy: desc(artifacts.createdAt),
  })
}

export async function setArtifactExtraction(
  db: AppDb,
  id: string,
  extraction: Artifact['extraction'],
  status: 'done' | 'failed' = 'done',
): Promise<void> {
  const result = await db
    .update(artifacts)
    .set({ extraction, extractionStatus: status })
    .where(eq(artifacts.id, id))
    .returning()
  if (!result.length) throw new Error(`artifact ${id} not found`)
}

/**
 * Resolve the `whatWouldClose` (structured shape) the AI emitted for a given
 * session+node, used by the extraction worker to steer `extractGenericPhoto`
 * for the `photo` artifact kind.
 *
 * Returns null when:
 *   - the session has no tree state
 *   - the node id doesn't match the session's currentNodeId (tree advanced past)
 *   - whatWouldClose is undefined or a legacy string (no extractFor available)
 */
export async function getWhatWouldCloseForNode(
  db: AppDb,
  input: { sessionId: string; nodeId: string },
): Promise<import('@/lib/ai/tree-engine').WhatWouldClose | null> {
  const rows = await db
    .select({ treeState: sessions.treeState })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1)
  if (rows.length === 0) return null
  const treeState = rows[0]?.treeState as
    | { currentNodeId?: string; proposedAction?: { whatWouldClose?: unknown } }
    | null
  if (!treeState) return null
  if (treeState.currentNodeId !== input.nodeId) return null
  const wwc = treeState.proposedAction?.whatWouldClose
  if (
    wwc &&
    typeof wwc === 'object' &&
    'kind' in wwc &&
    (wwc.kind === 'confirm' || wwc.kind === 'photo')
  ) {
    return wwc as import('@/lib/ai/tree-engine').WhatWouldClose
  }
  return null
}

// What's New — per-deploy changelog. Entries authored manually via Supabase
// `execute_sql` for v1 (no admin UI). Each user's `lastSeenWhatsNewAt` drives
// the in-nav "New" pill and the per-entry "new" marker on the page.

export async function listWhatsNewEntries(db: AppDb): Promise<WhatsNewEntry[]> {
  return db
    .select()
    .from(whatsNewEntries)
    .orderBy(desc(whatsNewEntries.publishedAt))
}

export async function countUnseenWhatsNewForUser(
  db: AppDb,
  userId: string,
): Promise<number> {
  const profile = await getProfileByUserId(db, userId)
  if (!profile) return 0

  if (profile.lastSeenWhatsNewAt) {
    const rows = await db
      .select({ id: whatsNewEntries.id })
      .from(whatsNewEntries)
      .where(gt(whatsNewEntries.publishedAt, profile.lastSeenWhatsNewAt))
    return rows.length
  }

  const rows = await db.select({ id: whatsNewEntries.id }).from(whatsNewEntries)
  return rows.length
}

export async function markWhatsNewSeen(db: AppDb, userId: string): Promise<void> {
  await db
    .update(profiles)
    .set({ lastSeenWhatsNewAt: new Date() })
    .where(eq(profiles.userId, userId))
}
